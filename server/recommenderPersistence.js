import { Buffer } from 'node:buffer'

const EMAIL_PATTERN = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/u

export const MAX_RECOMMENDER_CASCADE_APPLICATIONS = 512
export const MAX_RECOMMENDER_CASCADE_WORK_BYTES = 16 * 1024 * 1024
export const MAX_RECOMMENDER_MUTATION_RESPONSE_BYTES = 768 * 1024

export class RecommenderPersistenceError extends Error {
  constructor(code, message, status = 409) {
    super(message)
    this.name = 'RecommenderPersistenceError'
    this.code = code
    this.status = status
  }
}

function clean(value) {
  return typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/gu, ' ') : ''
}

function normalized(value) {
  return clean(value).toLocaleLowerCase('en-US')
}

function normalizedEmail(value) {
  const candidate = normalized(value).replace(/^mailto:/u, '')
  return EMAIL_PATTERN.test(candidate) ? candidate : ''
}

export function materialRecommenderEmail(recommender) {
  return clean(recommender?.email) || normalizedEmail(recommender?.contact)
}

export function materialRecommenderPhone(recommender) {
  const explicit = clean(recommender?.phone)
  if (explicit) return explicit
  const contact = clean(recommender?.contact)
  return contact && !normalizedEmail(contact) ? contact : ''
}

export function canonicalMaterialRecommender(recommender) {
  const email = materialRecommenderEmail(recommender)
  const phone = materialRecommenderPhone(recommender)
  return {
    ...recommender,
    name: clean(recommender?.name),
    email,
    phone,
    // Keep the historical field for old exports/clients. New code treats it
    // only as a compatibility projection of the two explicit contact fields.
    contact: email || phone,
  }
}

function profileContacts(profile) {
  return [profile?.email, profile?.phone]
    .map(normalized)
    .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index)
}

function materialContacts(recommender) {
  return [materialRecommenderEmail(recommender), materialRecommenderPhone(recommender)]
    .map(normalized)
    .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index)
}

export function recommenderIdentityMatchesProfile(recommender, profile) {
  const recommenderEmail = normalizedEmail(materialRecommenderEmail(recommender))
  const profileEmail = normalizedEmail(profile?.email)
  // When both sides carry valid email addresses, that address is the
  // authoritative identity boundary. Falling through to a matching phone in
  // this case could silently merge two different people who share an office
  // number.
  if (recommenderEmail && profileEmail) return recommenderEmail === profileEmail

  const recommenderName = normalized(recommender?.name)
  if (!recommenderName || recommenderName !== normalized(profile?.name)) return false
  const contacts = new Set(profileContacts(profile))
  return materialContacts(recommender).some((contact) => contacts.has(contact))
}

export function sharedIdentityChanged(recommender, profile) {
  return normalized(recommender?.name) !== normalized(profile?.name)
    || normalizedEmail(materialRecommenderEmail(recommender)) !== normalizedEmail(profile?.email)
    || normalized(materialRecommenderPhone(recommender)) !== normalized(profile?.phone)
}

/**
 * A profile only needs a sync decision when the rename would reach somewhere
 * else. If this application is the sole holder of the profile, "sync
 * everywhere" and "keep it here" describe the same single row, so asking is
 * noise — the edit is applied directly.
 */
export function profileLinkedBeyondApplication(applications, profileId, applicationId) {
  if (!profileId) return false
  return applications.some((candidate) => (
    candidate?.id !== applicationId
    && (candidate?.recommenders ?? []).some((row) => row?.profileId === profileId)
  ))
}

function uniqueProfileMatch(profiles, recommender, excludedProfileIds = new Set()) {
  const eligible = profiles.filter((profile) => !excludedProfileIds.has(profile.id))
  const email = normalizedEmail(materialRecommenderEmail(recommender))
  const emailMatches = email
    ? eligible.filter((profile) => normalizedEmail(profile.email) === email)
    : []
  if (emailMatches.length > 1) {
    throw new RecommenderPersistenceError(
      'RECOMMENDER_IDENTITY_AMBIGUOUS',
      'More than one saved recommender has this email address. Resolve the duplicate profiles first.',
    )
  }
  if (emailMatches.length === 1) return emailMatches[0]

  const name = normalized(recommender?.name)
  const contacts = materialContacts(recommender)
  if (!name || contacts.length === 0) return null
  const contactMatches = eligible.filter((profile) => {
    if (normalized(profile.name) !== name) return false
    const savedEmail = normalizedEmail(profile.email)
    if (email && savedEmail && savedEmail !== email) return false
    const savedContacts = new Set(profileContacts(profile))
    return contacts.some((contact) => savedContacts.has(contact))
  })
  if (contactMatches.length > 1) {
    throw new RecommenderPersistenceError(
      'RECOMMENDER_IDENTITY_AMBIGUOUS',
      'More than one saved recommender matches this name and contact information.',
    )
  }
  return contactMatches[0] ?? null
}

function sharedSnapshotFromProfile(recommender, profile) {
  const email = clean(profile.email)
  const phone = clean(profile.phone)
  return {
    ...recommender,
    profileId: profile.id,
    name: clean(profile.name),
    email,
    phone,
    contact: email || phone,
  }
}

function jsonBytes(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8')
  } catch {
    throw new RecommenderPersistenceError(
      'RECOMMENDER_CASCADE_TOO_LARGE',
      'The recommender update could not be bounded safely.',
      413,
    )
  }
}

const BOUNDED_JSON_LIMIT_REACHED = Symbol('bounded-json-limit-reached')

function boundedJsonStringBytes(value, addBytes) {
  addBytes(2)
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code === 0x22 || code === 0x5c) {
      addBytes(2)
    } else if (code <= 0x1f) {
      addBytes(code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d ? 2 : 6)
    } else if (code <= 0x7f) {
      addBytes(1)
    } else if (code <= 0x7ff) {
      addBytes(2)
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        addBytes(4)
        index += 1
      } else {
        // Well-formed JSON.stringify escapes lone surrogates as \udxxx.
        addBytes(6)
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      addBytes(6)
    } else {
      addBytes(3)
    }
  }
}

function boundedJsonBytes(value, maximumBytes) {
  const limit = Math.max(0, Number(maximumBytes) || 0)
  let bytes = 0
  const active = new WeakSet()
  const addBytes = (amount) => {
    bytes += amount
    if (bytes > limit) throw BOUNDED_JSON_LIMIT_REACHED
  }
  const visit = (candidate, arrayEntry = false, depth = 0) => {
    if (candidate === null) {
      addBytes(4)
      return true
    }
    switch (typeof candidate) {
      case 'string':
        boundedJsonStringBytes(candidate, addBytes)
        return true
      case 'boolean':
        addBytes(candidate ? 4 : 5)
        return true
      case 'number':
        addBytes(Number.isFinite(candidate) ? String(candidate).length : 4)
        return true
      case 'undefined':
      case 'function':
      case 'symbol':
        if (arrayEntry) addBytes(4)
        return arrayEntry
      case 'bigint':
        throw new TypeError('BigInt cannot be serialized as JSON.')
      default:
        break
    }
    if (depth > 256 || active.has(candidate)) {
      throw new TypeError('The value is cyclic or too deeply nested for bounded JSON sizing.')
    }
    const prototype = Object.getPrototypeOf(candidate)
    if (!Array.isArray(candidate) && prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Only plain persisted JSON values may be sized.')
    }
    active.add(candidate)
    if (Array.isArray(candidate)) {
      addBytes(1)
      for (let index = 0; index < candidate.length; index += 1) {
        if (index > 0) addBytes(1)
        visit(candidate[index], true, depth + 1)
      }
      addBytes(1)
    } else {
      addBytes(1)
      let emitted = 0
      for (const key of Object.keys(candidate)) {
        const nested = candidate[key]
        if (nested === undefined || typeof nested === 'function' || typeof nested === 'symbol') continue
        if (emitted > 0) addBytes(1)
        boundedJsonStringBytes(key, addBytes)
        addBytes(1)
        visit(nested, false, depth + 1)
        emitted += 1
      }
      addBytes(1)
    }
    active.delete(candidate)
    return true
  }
  try {
    visit(value)
    return bytes
  } catch (error) {
    if (error === BOUNDED_JSON_LIMIT_REACHED) return limit + 1
    throw new RecommenderPersistenceError(
      'RECOMMENDER_CASCADE_TOO_LARGE',
      'The recommender update could not be bounded safely.',
      413,
    )
  }
}

function createCascadeBudget() {
  return { applicationCount: 0, responseBytes: 0, workBytes: 0 }
}

function addCascadeBudgetApplication(budget, application, recommenders) {
  budget.applicationCount += 1
  if (budget.applicationCount > MAX_RECOMMENDER_CASCADE_APPLICATIONS) {
    throw new RecommenderPersistenceError(
      'RECOMMENDER_CASCADE_TOO_LARGE',
      `One recommender update may change at most ${MAX_RECOMMENDER_CASCADE_APPLICATIONS} applications.`,
      413,
    )
  }

  const slice = {
    id: application.id,
    updatedAt: application.updatedAt,
    recommenders,
  }
  budget.responseBytes += jsonBytes(slice)
  if (budget.responseBytes > MAX_RECOMMENDER_MUTATION_RESPONSE_BYTES) {
    throw new RecommenderPersistenceError(
      'RECOMMENDER_CASCADE_TOO_LARGE',
      'The canonical recommender response would exceed its bounded size.',
      413,
    )
  }

  // A durability acknowledgement hashes both the authored baseline and the
  // canonical next application. Bound that work before the cascade allocates
  // complete application copies or starts the per-application hash loop.
  const baselineBytes = boundedJsonBytes(application, MAX_RECOMMENDER_CASCADE_WORK_BYTES)
  const currentRecommenderBytes = boundedJsonBytes(
    application.recommenders ?? [],
    MAX_RECOMMENDER_CASCADE_WORK_BYTES,
  )
  const nextRecommenderBytes = boundedJsonBytes(recommenders, MAX_RECOMMENDER_CASCADE_WORK_BYTES)
  const projectedApplicationBytes = Math.max(
    0,
    baselineBytes - currentRecommenderBytes + nextRecommenderBytes + 128,
  )
  budget.workBytes += baselineBytes + projectedApplicationBytes
  if (budget.workBytes > MAX_RECOMMENDER_CASCADE_WORK_BYTES) {
    throw new RecommenderPersistenceError(
      'RECOMMENDER_CASCADE_TOO_LARGE',
      'The recommender cascade would exceed its bounded durability-work budget.',
      413,
    )
  }
}

export function compactApplicationRecommenderSlice(application) {
  return {
    id: String(application?.id ?? ''),
    updatedAt: String(application?.updatedAt ?? ''),
    recommenders: Array.isArray(application?.recommenders)
      ? application.recommenders.map((recommender) => ({ ...recommender }))
      : [],
  }
}

export function assertRecommenderMutationResponseBudget(payload) {
  if (jsonBytes(payload) > MAX_RECOMMENDER_MUTATION_RESPONSE_BYTES) {
    throw new RecommenderPersistenceError(
      'RECOMMENDER_CASCADE_TOO_LARGE',
      'The canonical recommender response would exceed its bounded size.',
      413,
    )
  }
}

export function preflightProfileRecommenderCascade({
  applications,
  currentProfiles,
  nextProfiles,
  ownerId,
}) {
  const nextById = new Map()
  for (const profile of nextProfiles) {
    if (nextById.has(profile.id)) {
      throw new RecommenderPersistenceError(
        'PROFILE_RECOMMENDER_DUPLICATE_ID',
        'Recommender ids must be unique.',
        400,
      )
    }
    nextById.set(profile.id, profile)
  }
  const changedProfileIds = new Set()
  for (const currentProfile of currentProfiles) {
    const nextProfile = nextById.get(currentProfile.id)
    if (
      !nextProfile
      || sharedIdentityChanged({
        name: nextProfile.name,
        email: nextProfile.email,
        phone: nextProfile.phone,
      }, currentProfile)
    ) {
      changedProfileIds.add(currentProfile.id)
    }
  }

  const budget = createCascadeBudget()
  for (const application of applications) {
    const current = Array.isArray(application.recommenders) ? application.recommenders : []
    if (
      application.ownerId !== ownerId
      || !current.some((recommender) => changedProfileIds.has(recommender.profileId))
    ) {
      continue
    }
    const recommenders = current.map((recommender) => {
      if (!changedProfileIds.has(recommender.profileId)) return recommender
      const nextProfile = nextById.get(recommender.profileId)
      if (nextProfile) return sharedSnapshotFromProfile(recommender, nextProfile)
      const detached = { ...recommender }
      delete detached.profileId
      return detached
    })
    addCascadeBudgetApplication(budget, application, recommenders)
  }
  return budget
}

/**
 * One person may not hold two recommender rows on the same application. The
 * email address is the identity boundary the rest of this module already trusts
 * (see recommenderIdentityMatchesProfile), so a second row carrying an address
 * another row already uses is refused rather than persisted as a near-duplicate
 * the editor cannot tell apart. Rows without an address are left alone: they are
 * still being filled in and have no identity to collide on yet.
 */
export function findDuplicateApplicationRecommenderEmail(application, recommenderId, submitted) {
  const email = normalizedEmail(materialRecommenderEmail(submitted))
  if (!email) return null
  return (application?.recommenders ?? []).find((candidate) => (
    candidate?.id !== recommenderId
    && normalizedEmail(materialRecommenderEmail(candidate)) === email
  )) ?? null
}

function assertRecommenderEmailUnusedInApplication(application, recommenderId, submitted) {
  const duplicate = findDuplicateApplicationRecommenderEmail(application, recommenderId, submitted)
  if (!duplicate) return
  throw new RecommenderPersistenceError(
    'RECOMMENDER_DUPLICATE_EMAIL',
    `${clean(duplicate.name) || 'Another recommender'} on this application already uses ${materialRecommenderEmail(submitted)}.`,
    409,
  )
}

export function preflightApplicationRecommenderResolution({
  applications,
  profiles,
  applicationId,
  recommenderId,
  submittedRecommender,
  decision = 'auto',
  ownerId,
}) {
  const application = applications.find((candidate) => candidate.id === applicationId)
  if (!application || application.ownerId !== ownerId) {
    throw new RecommenderPersistenceError('NOT_FOUND', 'Application not found.', 404)
  }
  if (!['auto', 'sync', 'independent'].includes(decision)) {
    throw new RecommenderPersistenceError('VALIDATION_ERROR', 'Unknown recommender save decision.', 400)
  }
  const submitted = canonicalMaterialRecommender({ ...submittedRecommender, id: recommenderId })
  if (!submitted.name) {
    throw new RecommenderPersistenceError('VALIDATION_ERROR', 'A recommender name is required.', 400)
  }
  assertRecommenderEmailUnusedInApplication(application, recommenderId, submitted)

  const existingRow = (application.recommenders ?? [])
    .find((candidate) => candidate.id === recommenderId) ?? null
  const originalProfileId = existingRow?.profileId || submitted.profileId || null
  const originalProfile = originalProfileId
    ? profiles.find((profile) => profile.id === originalProfileId) ?? null
    : null
  const selectedProfile = submitted.profileId
    ? profiles.find((profile) => profile.id === submitted.profileId) ?? null
    : null
  const explicitlySelectedProfile = Boolean(
    selectedProfile && submitted.profileId !== existingRow?.profileId,
  )

  const effectiveDecision = decision === 'auto'
    && originalProfile
    && !profileLinkedBeyondApplication(applications, originalProfile.id, applicationId)
    ? 'sync'
    : decision

  let targetProfile = selectedProfile
  let cascadeSourceProfileId = null
  if (explicitlySelectedProfile) {
    targetProfile = selectedProfile
  } else if (effectiveDecision === 'auto' && originalProfile && sharedIdentityChanged(submitted, originalProfile)) {
    throw new RecommenderPersistenceError(
      'RECOMMENDER_SYNC_DECISION_REQUIRED',
      'Choose whether this identity change should update every linked application or become independent.',
    )
  } else if (effectiveDecision === 'sync' && originalProfile) {
    targetProfile = uniqueProfileMatch(profiles, submitted, new Set([originalProfile.id])) ?? {
      ...originalProfile,
      name: submitted.name,
      email: submitted.email,
      phone: submitted.phone,
    }
    cascadeSourceProfileId = originalProfile.id
  } else if (effectiveDecision === 'independent' && originalProfile && sharedIdentityChanged(submitted, originalProfile)) {
    targetProfile = uniqueProfileMatch(profiles, submitted, new Set([originalProfile.id]))
  } else if (originalProfile) {
    targetProfile = originalProfile
  } else {
    targetProfile = uniqueProfileMatch(profiles, submitted)
  }
  targetProfile ??= {
    id: 'preflight-profile-recommender',
    name: submitted.name,
    email: submitted.email,
    phone: submitted.phone,
  }

  const savedRecommender = sharedSnapshotFromProfile(submitted, targetProfile)
  const budget = createCascadeBudget()
  for (const candidate of applications) {
    if (candidate.ownerId !== ownerId) continue
    const current = Array.isArray(candidate.recommenders) ? candidate.recommenders : []
    const cascades = Boolean(
      cascadeSourceProfileId
      && current.some((recommender) => recommender.profileId === cascadeSourceProfileId),
    )
    if (!cascades && candidate.id !== applicationId) continue
    let recommenders = cascades
      ? current.map((recommender) => (
          recommender.profileId === cascadeSourceProfileId
            ? sharedSnapshotFromProfile(recommender, targetProfile)
            : recommender
        ))
      : current
    if (candidate.id === applicationId) {
      recommenders = replaceApplicationRecommender(
        { ...candidate, recommenders },
        recommenderId,
        savedRecommender,
      )
    }
    addCascadeBudgetApplication(budget, candidate, recommenders)
  }
  return budget
}

function replaceApplicationRecommender(application, recommenderId, recommender) {
  const current = Array.isArray(application.recommenders) ? application.recommenders : []
  const exists = current.some((candidate) => candidate.id === recommenderId)
  if (!exists && current.length >= 12) {
    throw new RecommenderPersistenceError(
      'RECOMMENDER_LIMIT',
      'No more than 12 recommenders can be assigned to one application.',
    )
  }
  return exists
    ? current.map((candidate) => candidate.id === recommenderId ? recommender : candidate)
    : [...current, recommender]
}

function cascadeProfileSnapshot(applications, ownerId, sourceProfileIds, targetProfile, affectedIds, versionStamp) {
  const sourceIds = new Set(sourceProfileIds)
  return applications.map((application) => {
    if (application.ownerId !== ownerId || !Array.isArray(application.recommenders)) return application
    let changed = false
    const recommenders = application.recommenders.map((recommender) => {
      if (!recommender.profileId || !sourceIds.has(recommender.profileId)) return recommender
      changed = true
      return sharedSnapshotFromProfile(recommender, targetProfile)
    })
    if (!changed) return application
    const alreadyAffected = affectedIds.has(application.id)
    affectedIds.add(application.id)
    return {
      ...application,
      recommenders,
      updatedAt: alreadyAffected ? application.updatedAt : versionStamp(application.updatedAt),
    }
  })
}

function createProfileFromRecommender(recommender, timestamp, createProfileId, profiles) {
  const id = clean(typeof createProfileId === 'function' ? createProfileId() : '')
  if (!id || profiles.some((profile) => profile.id === id)) {
    throw new RecommenderPersistenceError(
      'PROFILE_RECOMMENDER_ID_CONFLICT',
      'Could not allocate a unique recommender profile id.',
    )
  }
  return {
    id,
    name: clean(recommender.name),
    email: materialRecommenderEmail(recommender),
    phone: materialRecommenderPhone(recommender),
    title: '',
    institution: '',
    relationship: '',
    notes: '',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

/**
 * Resolves one application row against the owner's shared recommender library.
 * The returned collections are complete immutable replacements, allowing the
 * caller to persist the profile and every affected application in one lock.
 */
export function resolveApplicationRecommender({
  applications,
  profiles,
  applicationId,
  recommenderId,
  submittedRecommender,
  decision = 'auto',
  ownerId,
  timestamp,
  createProfileId,
  versionStamp = () => timestamp,
}) {
  const application = applications.find((candidate) => candidate.id === applicationId)
  if (!application || application.ownerId !== ownerId) {
    throw new RecommenderPersistenceError('NOT_FOUND', 'Application not found.', 404)
  }
  if (!['auto', 'sync', 'independent'].includes(decision)) {
    throw new RecommenderPersistenceError('VALIDATION_ERROR', 'Unknown recommender save decision.', 400)
  }

  const submitted = canonicalMaterialRecommender({
    ...submittedRecommender,
    id: recommenderId,
  })
  if (!submitted.name) {
    throw new RecommenderPersistenceError('VALIDATION_ERROR', 'A recommender name is required.', 400)
  }

  const existingRow = (application.recommenders ?? []).find((candidate) => candidate.id === recommenderId) ?? null
  const originalProfileId = existingRow?.profileId || submitted.profileId || null
  const originalProfile = originalProfileId
    ? profiles.find((profile) => profile.id === originalProfileId) ?? null
    : null
  const explicitlySelectedProfile = Boolean(
    submitted.profileId
    && profiles.some((profile) => profile.id === submitted.profileId)
    && submitted.profileId !== existingRow?.profileId,
  )

  let nextProfiles = [...profiles]
  let nextApplications = [...applications]
  const affectedIds = new Set()
  let targetProfile = null
  let resolution = 'linked'

  // Must mirror preflightApplicationRecommenderResolution: a profile only this
  // application holds has nothing to sync elsewhere, so the rename is applied
  // without stopping to ask.
  const effectiveDecision = decision === 'auto'
    && originalProfile
    && !profileLinkedBeyondApplication(applications, originalProfile.id, applicationId)
    ? 'sync'
    : decision

  if (explicitlySelectedProfile) {
    targetProfile = profiles.find((profile) => profile.id === submitted.profileId)
  } else if (effectiveDecision === 'auto' && originalProfile && sharedIdentityChanged(submitted, originalProfile)) {
    throw new RecommenderPersistenceError(
      'RECOMMENDER_SYNC_DECISION_REQUIRED',
      'Choose whether this identity change should update every linked application or become independent.',
    )
  } else if (effectiveDecision === 'sync' && originalProfile) {
    const matchingOtherProfile = uniqueProfileMatch(profiles, submitted, new Set([originalProfile.id]))
    if (matchingOtherProfile) {
      targetProfile = matchingOtherProfile
      nextProfiles = profiles.filter((profile) => profile.id !== originalProfile.id)
      nextApplications = cascadeProfileSnapshot(
        nextApplications,
        ownerId,
        [originalProfile.id],
        targetProfile,
        affectedIds,
        versionStamp,
      )
      resolution = 'merged'
    } else {
      targetProfile = {
        ...originalProfile,
        name: submitted.name,
        email: submitted.email,
        phone: submitted.phone,
        updatedAt: versionStamp(originalProfile.updatedAt),
      }
      nextProfiles = profiles.map((profile) => profile.id === targetProfile.id ? targetProfile : profile)
      nextApplications = cascadeProfileSnapshot(
        nextApplications,
        ownerId,
        [targetProfile.id],
        targetProfile,
        affectedIds,
        versionStamp,
      )
      resolution = 'synced'
    }
  } else if (effectiveDecision === 'independent' && originalProfile && sharedIdentityChanged(submitted, originalProfile)) {
    targetProfile = uniqueProfileMatch(profiles, submitted, new Set([originalProfile.id]))
    if (!targetProfile) {
      if (profiles.length >= 100) {
        throw new RecommenderPersistenceError(
          'PROFILE_RECOMMENDER_LIMIT',
          'No more than 100 profile recommenders are allowed.',
        )
      }
      targetProfile = createProfileFromRecommender(submitted, timestamp, createProfileId, profiles)
      nextProfiles = [...profiles, targetProfile]
      resolution = 'created'
    }
  } else if (originalProfile) {
    targetProfile = originalProfile
  } else {
    targetProfile = uniqueProfileMatch(profiles, submitted)
    if (!targetProfile) {
      if (profiles.length >= 100) {
        throw new RecommenderPersistenceError(
          'PROFILE_RECOMMENDER_LIMIT',
          'No more than 100 profile recommenders are allowed.',
        )
      }
      targetProfile = createProfileFromRecommender(submitted, timestamp, createProfileId, profiles)
      nextProfiles = [...profiles, targetProfile]
      resolution = 'created'
    }
  }

  const savedRecommender = sharedSnapshotFromProfile(submitted, targetProfile)
  nextApplications = nextApplications.map((candidate) => {
    if (candidate.id !== applicationId) return candidate
    const alreadyAffected = affectedIds.has(candidate.id)
    affectedIds.add(candidate.id)
    return {
      ...candidate,
      recommenders: replaceApplicationRecommender(candidate, recommenderId, savedRecommender),
      updatedAt: alreadyAffected ? candidate.updatedAt : versionStamp(candidate.updatedAt),
    }
  })

  return {
    applications: nextApplications,
    profiles: nextProfiles,
    application: nextApplications.find((candidate) => candidate.id === applicationId),
    profile: targetProfile,
    recommender: savedRecommender,
    affectedApplicationIds: [...affectedIds],
    resolution,
  }
}

/** Profile-page edits are authoritative and always rewrite linked snapshots. */
export function replaceProfileRecommendersAndCascade({
  applications,
  currentProfiles,
  nextProfiles,
  ownerId,
  timestamp,
  versionStamp = () => timestamp,
}) {
  const profileIds = new Set()
  for (const profile of nextProfiles) {
    if (profileIds.has(profile.id)) {
      throw new RecommenderPersistenceError('PROFILE_RECOMMENDER_DUPLICATE_ID', 'Recommender ids must be unique.', 400)
    }
    profileIds.add(profile.id)
  }

  const nextById = new Map(nextProfiles.map((profile) => [profile.id, profile]))
  const affectedIds = new Set()
  let nextApplications = [...applications]

  for (const currentProfile of currentProfiles) {
    const nextProfile = nextById.get(currentProfile.id)
    if (!nextProfile) {
      nextApplications = nextApplications.map((application) => {
        if (application.ownerId !== ownerId || !Array.isArray(application.recommenders)) return application
        let changed = false
        const recommenders = application.recommenders.map((recommender) => {
          if (recommender.profileId !== currentProfile.id) return recommender
          changed = true
          const detached = { ...recommender }
          delete detached.profileId
          return detached
        })
        if (!changed) return application
        const alreadyAffected = affectedIds.has(application.id)
        affectedIds.add(application.id)
        return {
          ...application,
          recommenders,
          updatedAt: alreadyAffected ? application.updatedAt : versionStamp(application.updatedAt),
        }
      })
      continue
    }

    if (!sharedIdentityChanged({
      name: nextProfile.name,
      email: nextProfile.email,
      phone: nextProfile.phone,
    }, currentProfile)) continue

    nextApplications = cascadeProfileSnapshot(
      nextApplications,
      ownerId,
      [currentProfile.id],
      nextProfile,
      affectedIds,
      versionStamp,
    )
  }

  return {
    applications: nextApplications,
    profiles: nextProfiles,
    affectedApplicationIds: [...affectedIds],
  }
}
