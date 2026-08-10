import type { ProfileRecommender } from './api/phdApi'
import type { ApplicationRecord, MaterialRecommender } from './data/applications'

export type ProfileRecommenderUse = {
  id: string
  applicationId: string
  ownerId?: string
  schoolName: string
  program: string
  deadline: string
  materialId: string
  materialName: string
  recommenderId: string
  profileId?: string
  name: string
  email: string
  phone: string
  contact: string
}

/**
 * One application in which a recommender is used. A person can appear in more
 * than one recommendation slot/material inside the same application; those
 * rows intentionally remain available in `uses` but count as one project.
 */
export type ProfileRecommenderProject = {
  id: string
  applicationId: string
  ownerId?: string
  schoolName: string
  program: string
  deadline: string
  materialId: string
  materialName: string
  recommenderId: string
  primaryUse: ProfileRecommenderUse
  uses: ProfileRecommenderUse[]
  searchFields: string[]
  searchText: string
}

export type ProfileRecommenderDirectoryEntry = {
  key: string
  source: 'profile' | 'application'
  /** Present only when this is a real persisted profile-library record. */
  profileId?: string
  profile: ProfileRecommender | null
  name: string
  email: string
  phone: string
  title: string
  institution: string
  relationship: string
  notes: string
  uses: ProfileRecommenderUse[]
  projects: ProfileRecommenderProject[]
  projectCount: number
  nextProject: ProfileRecommenderProject | null
  nextUse: ProfileRecommenderUse | null
  searchFields: string[]
  searchText: string
}

type ProfileRecommenderSuggestionFields = {
  key: string
  name: string
  email: string
  phone: string
  title: string
  institution: string
  relationship: string
  notes: string
  updatedAt?: string
  projectCount: number
  searchText: string
}

/**
 * A combobox-ready record. Application-derived suggestions deliberately have
 * no `profileId`, so filling a historical snapshot can never manufacture a
 * persistent-library link that does not exist.
 */
export type ProfileRecommenderSuggestion =
  | (ProfileRecommenderSuggestionFields & {
      source: 'profile'
      profileId: string
    })
  | (ProfileRecommenderSuggestionFields & {
      source: 'application'
      profileId?: never
    })

export type SavedProfileRecommenderSummary = {
  profile: ProfileRecommender
  uses: ProfileRecommenderUse[]
  projects: ProfileRecommenderProject[]
  projectCount: number
  usageCount: number
  nextProject: ProfileRecommenderProject | null
  nextUse: ProfileRecommenderUse | null
  searchFields: string[]
  searchText: string
}

export type InferredProfileRecommender = {
  key: string
  name: string
  email: string
  phone: string
  uses: ProfileRecommenderUse[]
  projects: ProfileRecommenderProject[]
  projectCount: number
  usageCount: number
  nextProject: ProfileRecommenderProject | null
  nextUse: ProfileRecommenderUse | null
  searchFields: string[]
  searchText: string
}

export type ProfileRecommenderAggregation = {
  uses: ProfileRecommenderUse[]
  directory: ProfileRecommenderDirectoryEntry[]
  /** Compatibility projections for the existing profile-library surface. */
  saved: SavedProfileRecommenderSummary[]
  inferred: InferredProfileRecommender[]
}

export type ProfileRecommenderAggregationOptions = {
  /** When supplied, records without this exact owner are excluded rather than guessed. */
  ownerId?: string
  now?: Date
}

type RecommenderIdentity = {
  name?: string
  email?: string
  phone?: string
}

const emailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/u

export function normalizeRecommenderText(value: unknown): string {
  return typeof value === 'string'
    ? value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US')
    : ''
}

export function normalizeRecommenderEmail(value: unknown): string {
  const normalized = normalizeRecommenderText(value)
  return normalized.startsWith('mailto:') ? normalized.slice(7).trim() : normalized
}

export function recommenderEmailFromContact(value: unknown): string {
  const normalized = normalizeRecommenderEmail(value)
  return emailPattern.test(normalized) ? normalized : ''
}

export function materialRecommenderEmail(recommender: Pick<MaterialRecommender, 'contact' | 'email'>): string {
  return recommender.email?.trim() || recommenderEmailFromContact(recommender.contact)
}

export function materialRecommenderPhone(recommender: Pick<MaterialRecommender, 'contact' | 'phone'>): string {
  const explicit = recommender.phone?.trim() ?? ''
  if (explicit) return explicit
  const contact = recommender.contact.trim()
  return contact && !recommenderEmailFromContact(contact) ? contact : ''
}

export function materialRecommenderWithContacts(
  recommender: MaterialRecommender,
  email: string,
  phone: string,
): MaterialRecommender {
  const normalizedEmail = email.trim()
  const normalizedPhone = phone.trim()
  return {
    ...recommender,
    email: normalizedEmail,
    phone: normalizedPhone,
    contact: normalizedEmail || normalizedPhone,
  }
}

function normalizedProfileContacts(profile: RecommenderIdentity): string[] {
  return [profile.email, profile.phone]
    .map(normalizeRecommenderText)
    .filter((value, index, items) => Boolean(value) && items.indexOf(value) === index)
}

/**
 * Conservative identity comparison. Email is authoritative even when a display
 * name changed. Otherwise both a non-empty contact channel and the name must
 * match exactly after Unicode/case/whitespace normalization. A name alone is
 * deliberately never enough to merge two people.
 */
export function profileRecommendersShareIdentity(left: RecommenderIdentity, right: RecommenderIdentity): boolean {
  const leftEmail = recommenderEmailFromContact(left.email)
  const rightEmail = recommenderEmailFromContact(right.email)
  if (leftEmail && rightEmail && leftEmail === rightEmail) return true

  const leftName = normalizeRecommenderText(left.name)
  const rightName = normalizeRecommenderText(right.name)
  if (!leftName || leftName !== rightName) return false

  const leftContacts = normalizedProfileContacts(left)
  const rightContacts = new Set(normalizedProfileContacts(right))
  return leftContacts.some((contact) => rightContacts.has(contact))
}

function recommenderUseMatchesSavedProfile(use: ProfileRecommenderUse, profile: ProfileRecommender): boolean {
  // Once a row has an explicit library link it is authoritative. Falling back
  // to a coincidentally equal email could attach it to a different duplicate
  // profile simply because that profile appears first in settings order.
  if (use.profileId) return use.profileId === profile.id

  const useEmail = recommenderEmailFromContact(use.email || use.contact)
  const profileEmail = recommenderEmailFromContact(profile.email)
  if (useEmail && profileEmail && useEmail === profileEmail) return true

  const useName = normalizeRecommenderText(use.name)
  const useContacts = [use.email, use.phone, use.contact].map(normalizeRecommenderText).filter(Boolean)
  if (!useName || useContacts.length === 0 || useName !== normalizeRecommenderText(profile.name)) return false
  const savedContacts = new Set(normalizedProfileContacts(profile))
  return useContacts.some((contact) => savedContacts.has(contact))
}

function recommenderUseIdentityKey(use: ProfileRecommenderUse): string {
  const profileId = use.profileId?.trim()
  if (profileId) return `profile:${profileId}`

  const email = recommenderEmailFromContact(use.email || use.contact)
  if (email) return `email:${email}`

  const name = normalizeRecommenderText(use.name)
  const contact = normalizeRecommenderText(use.phone || use.contact)
  if (name && contact) return `contact:${name}\u0000${contact}`

  // Empty-contact rows stay distinct. Falling back to `name` here would merge
  // unrelated people who happen to share a common name.
  return `use:${use.id}`
}

function dateOnlyTimestamp(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const timestamp = Date.UTC(year, month - 1, day, 12)
  const parsed = new Date(timestamp)
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
    ? timestamp
    : null
}

function deadlineTimestamp(value: string): number | null {
  const dateOnly = dateOnlyTimestamp(value)
  if (dateOnly !== null) return dateOnly
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

export function nextProfileRecommenderUse(
  uses: readonly ProfileRecommenderUse[],
  now = new Date(),
): ProfileRecommenderUse | null {
  const todayTimestamp = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())

  return (
    uses.reduce<{ use: ProfileRecommenderUse; timestamp: number } | null>((next, use) => {
      const timestamp = deadlineTimestamp(use.deadline)
      if (timestamp === null || timestamp < todayTimestamp) return next
      if (!next || timestamp < next.timestamp) return { use, timestamp }
      return next
    }, null)?.use ?? null
  )
}

function nonEmptySearchFields(values: readonly unknown[]): string[] {
  const fields: string[] = []
  const normalizedFields = new Set<string>()
  for (const value of values) {
    if (typeof value !== 'string') continue
    const field = value.trim()
    const normalized = normalizeRecommenderText(field)
    if (!normalized || normalizedFields.has(normalized)) continue
    normalizedFields.add(normalized)
    fields.push(field)
  }
  return fields
}

function searchTextFromFields(fields: readonly string[]): string {
  return normalizeRecommenderText(fields.join(' '))
}

/** Groups recommendation rows by their distinct application. */
export function profileRecommenderProjectsFromUses(
  uses: readonly ProfileRecommenderUse[],
): ProfileRecommenderProject[] {
  const usesByApplication = new Map<string, ProfileRecommenderUse[]>()
  for (const use of uses) {
    const existing = usesByApplication.get(use.applicationId)
    if (existing) existing.push(use)
    else usesByApplication.set(use.applicationId, [use])
  }

  return Array.from(usesByApplication, ([applicationId, applicationUses]) => {
    const primaryUse = applicationUses[0]
    const firstValue = (select: (use: ProfileRecommenderUse) => string): string =>
      applicationUses.map(select).find((value) => value.trim())?.trim() ?? ''
    const deadline =
      applicationUses.find((use) => deadlineTimestamp(use.deadline) !== null)?.deadline.trim() ??
      firstValue((use) => use.deadline)
    const searchFields = nonEmptySearchFields([
      ...applicationUses.flatMap((use) => [
        use.schoolName,
        use.program,
        use.deadline,
        use.materialName,
        use.name,
        use.email,
        use.phone,
        use.contact,
      ]),
    ])

    return {
      id: applicationId,
      applicationId,
      ownerId: primaryUse.ownerId,
      schoolName: firstValue((use) => use.schoolName),
      program: firstValue((use) => use.program),
      deadline,
      materialId: primaryUse.materialId,
      materialName: firstValue((use) => use.materialName),
      recommenderId: primaryUse.recommenderId,
      primaryUse,
      uses: [...applicationUses],
      searchFields,
      searchText: searchTextFromFields(searchFields),
    }
  })
}

export function nextProfileRecommenderProject(
  projects: readonly ProfileRecommenderProject[],
  now = new Date(),
): ProfileRecommenderProject | null {
  const todayTimestamp = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return (
    projects.reduce<{ project: ProfileRecommenderProject; timestamp: number } | null>((next, project) => {
      const timestamp = deadlineTimestamp(project.deadline)
      if (timestamp === null || timestamp < todayTimestamp) return next
      if (!next || timestamp < next.timestamp) return { project, timestamp }
      return next
    }, null)?.project ?? null
  )
}

function applicationCanContribute(application: ApplicationRecord, ownerId: string | undefined): boolean {
  if (ownerId === undefined) return true
  return application.ownerId === ownerId
}

function legacyRecommendationMaterial(material: ApplicationRecord['materials'][number]) {
  const type = material.type.trim().toLowerCase()
  const group = material.group?.trim().toLowerCase()
  return type === 'recommendation letter'
    || group === 'recommendations'
    || /recommendation|recommender|推荐/i.test(material.name)
}

export function extractProfileRecommenderUses(
  applications: readonly ApplicationRecord[],
  options: Pick<ProfileRecommenderAggregationOptions, 'ownerId'> = {},
): ProfileRecommenderUse[] {
  const uses: ProfileRecommenderUse[] = []

  for (const application of applications) {
    if (!applicationCanContribute(application, options.ownerId)) continue
    const directRecommenders = application.recommenders ?? []
    const recommenderSources = directRecommenders.length > 0
      ? [{ id: 'application-recommenders', name: '', recommenders: directRecommenders }]
      : (application.materials ?? []).filter(legacyRecommendationMaterial)

    for (const source of recommenderSources) {
      for (const recommender of source.recommenders ?? []) {
        const profileId = recommender.profileId?.trim() || undefined
        const name = recommender.name?.trim() ?? ''
        const email = materialRecommenderEmail(recommender)
        const phone = materialRecommenderPhone(recommender)
        const contact = email || phone || recommender.contact?.trim() || ''

        // Recommendation materials commonly carry one or more empty draft
        // slots. A generated row id is not person data, so those slots must not
        // become people in the directory.
        if (!profileId && !name && !email && !phone && !contact) continue

        uses.push({
          id: `${application.id}:${source.id}:${recommender.id}`,
          applicationId: application.id,
          ownerId: application.ownerId,
          schoolName: application.school?.name?.trim() ?? '',
          program: application.program?.trim() ?? '',
          deadline: recommender.deadline?.trim() || application.deadline?.trim() || '',
          materialId: source.id,
          materialName: source.name?.trim() ?? '',
          recommenderId: recommender.id,
          profileId,
          name,
          email,
          phone,
          contact,
        })
      }
    }
  }

  return uses
}

function applicationRecommenderProjectionSignature(application: ApplicationRecord): string {
  return JSON.stringify(
    extractProfileRecommenderUses([application]).map((use) => [
      use.applicationId,
      use.schoolName,
      use.program,
      use.deadline,
      use.materialId,
      use.recommenderId,
      use.profileId ?? '',
      use.name,
      use.email,
      use.phone,
      use.contact,
    ]),
  )
}

/**
 * Keep recommender projections in step with the active editor without making
 * every unrelated application keystroke rebuild the shared directory. New
 * blank rows live outside the application draft, so they are intentionally not
 * exposed here until Save promotes them into the draft.
 */
export function applicationsWithActiveRecommenderDraft(
  applications: readonly ApplicationRecord[],
  activeDraft: ApplicationRecord | null | undefined,
): readonly ApplicationRecord[] {
  if (!activeDraft) return applications
  const activeIndex = applications.findIndex((application) => application.id === activeDraft.id)
  if (activeIndex < 0) return applications
  if (
    applicationRecommenderProjectionSignature(applications[activeIndex])
    === applicationRecommenderProjectionSignature(activeDraft)
  ) {
    return applications
  }

  const projected = [...applications]
  projected[activeIndex] = activeDraft
  return projected
}

function inferredFromUses(uses: readonly ProfileRecommenderUse[], now: Date): InferredProfileRecommender[] {
  const groups = new Map<string, ProfileRecommenderUse[]>()
  for (const use of uses) {
    const key = recommenderUseIdentityKey(use)
    const group = groups.get(key)
    if (group) group.push(use)
    else groups.set(key, [use])
  }

  return Array.from(groups, ([key, groupUses]) => {
    const representative = groupUses.find((use) => use.name.trim()) ?? groupUses[0]
    const email = groupUses.map((use) => use.email || recommenderEmailFromContact(use.contact)).find(Boolean) ?? ''
    const phone =
      groupUses
        .map((use) => use.phone || use.contact.trim())
        .find((contact) => Boolean(contact) && !recommenderEmailFromContact(contact)) ?? ''
    const projects = profileRecommenderProjectsFromUses(groupUses)
    const nextProject = nextProfileRecommenderProject(projects, now)
    const searchFields = nonEmptySearchFields([
      representative.name,
      email,
      phone,
      ...projects.flatMap((project) => project.searchFields),
    ])
    return {
      key,
      name: representative.name,
      email,
      phone,
      uses: [...groupUses],
      projects,
      projectCount: projects.length,
      usageCount: projects.length,
      nextProject,
      nextUse: nextProject?.primaryUse ?? null,
      searchFields,
      searchText: searchTextFromFields(searchFields),
    }
  }).sort((left, right) => {
    return compareProfileRecommenderDirectoryOrder(left, right)
  })
}

type DirectorySortable = {
  key: string
  name: string
  email: string
  phone: string
  projectCount: number
  nextProject: ProfileRecommenderProject | null
}

function compareProfileRecommenderDirectoryOrder(left: DirectorySortable, right: DirectorySortable): number {
  const leftDeadline = left.nextProject ? deadlineTimestamp(left.nextProject.deadline) : null
  const rightDeadline = right.nextProject ? deadlineTimestamp(right.nextProject.deadline) : null
  if (leftDeadline !== null && rightDeadline !== null && leftDeadline !== rightDeadline) {
    return leftDeadline - rightDeadline
  }
  if (leftDeadline !== null) return -1
  if (rightDeadline !== null) return 1
  if (left.projectCount !== right.projectCount) return right.projectCount - left.projectCount

  const leftName = normalizeRecommenderText(left.name || left.email || left.phone || left.key)
  const rightName = normalizeRecommenderText(right.name || right.email || right.phone || right.key)
  const byName = leftName.localeCompare(rightName, 'en-US')
  return byName || left.key.localeCompare(right.key, 'en-US')
}

function useEmailMatchesSavedIdentity(
  use: ProfileRecommenderUse,
  profile: ProfileRecommender,
  aliases: readonly ProfileRecommenderUse[],
): boolean {
  const email = recommenderEmailFromContact(use.email || use.contact)
  if (!email) return false
  if (email === recommenderEmailFromContact(profile.email)) return true
  return aliases.some((alias) => email === recommenderEmailFromContact(alias.email || alias.contact))
}

function usesShareNameAndContact(left: ProfileRecommenderUse, right: ProfileRecommenderUse): boolean {
  const leftName = normalizeRecommenderText(left.name)
  const rightName = normalizeRecommenderText(right.name)
  const leftContacts = [left.email, left.phone, left.contact].map(normalizeRecommenderText).filter(Boolean)
  const rightContacts = new Set([right.email, right.phone, right.contact].map(normalizeRecommenderText).filter(Boolean))
  return Boolean(leftName && leftName === rightName && leftContacts.some((contact) => rightContacts.has(contact)))
}

function useNameAndContactMatchesSavedIdentity(
  use: ProfileRecommenderUse,
  profile: ProfileRecommender,
  aliases: readonly ProfileRecommenderUse[],
): boolean {
  const useName = normalizeRecommenderText(use.name)
  const useContacts = [use.email, use.phone, use.contact].map(normalizeRecommenderText).filter(Boolean)
  if (!useName || useContacts.length === 0) return false

  if (
    useName === normalizeRecommenderText(profile.name) &&
    useContacts.some((contact) => normalizedProfileContacts(profile).includes(contact))
  ) {
    return true
  }
  return aliases.some((alias) => usesShareNameAndContact(use, alias))
}

export function aggregateProfileRecommenders(
  profiles: readonly ProfileRecommender[],
  applications: readonly ApplicationRecord[],
  options: ProfileRecommenderAggregationOptions = {},
): ProfileRecommenderAggregation {
  const now = options.now ?? new Date()
  const uses = extractProfileRecommenderUses(applications, options)
  const assignedUses = new Map<string, ProfileRecommenderUse[]>()
  const unmatchedUses: ProfileRecommenderUse[] = []
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]))

  for (const profile of profiles) assignedUses.set(profile.id, [])

  const unlinkedUses: ProfileRecommenderUse[] = []
  for (const use of uses) {
    const linkedProfile = use.profileId ? profilesById.get(use.profileId) : undefined
    if (!linkedProfile) {
      unlinkedUses.push(use)
      continue
    }
    assignedUses.get(linkedProfile.id)?.push(use)
  }

  // Only real explicit links become historical aliases. This keeps fallback
  // matching deterministic and prevents an order-dependent chain of guesses.
  const linkedIdentityAliases = new Map(
    Array.from(assignedUses, ([profileId, profileUses]) => [profileId, [...profileUses]]),
  )

  for (const use of unlinkedUses) {
    const emailMatches = profiles.filter((candidate) =>
      useEmailMatchesSavedIdentity(use, candidate, linkedIdentityAliases.get(candidate.id) ?? []),
    )
    const contactMatches = emailMatches.length
      ? []
      : profiles.filter((candidate) =>
          useNameAndContactMatchesSavedIdentity(use, candidate, linkedIdentityAliases.get(candidate.id) ?? []),
        )
    // Ambiguous equal emails/contacts are not resolved by array order. They
    // stay application-derived until a user establishes a stable profile link.
    const profile =
      emailMatches.length === 1
        ? emailMatches[0]
        : emailMatches.length === 0 && contactMatches.length === 1
          ? contactMatches[0]
          : undefined
    if (!profile) {
      unmatchedUses.push(use)
      continue
    }
    assignedUses.get(profile.id)?.push(use)
  }

  const saved = profiles.map((profile) => {
    const profileUses = assignedUses.get(profile.id) ?? []
    const projects = profileRecommenderProjectsFromUses(profileUses)
    const nextProject = nextProfileRecommenderProject(projects, now)
    const searchFields = nonEmptySearchFields([
      profile.name,
      profile.email,
      profile.phone,
      profile.title,
      profile.institution,
      profile.relationship,
      profile.notes,
      ...projects.flatMap((project) => project.searchFields),
    ])
    return {
      profile,
      uses: profileUses,
      projects,
      projectCount: projects.length,
      usageCount: projects.length,
      nextProject,
      nextUse: nextProject?.primaryUse ?? null,
      searchFields,
      searchText: searchTextFromFields(searchFields),
    }
  })

  const inferred = inferredFromUses(unmatchedUses, now)
  const directory: ProfileRecommenderDirectoryEntry[] = [
    ...saved.map(
      (summary): ProfileRecommenderDirectoryEntry => ({
        key: `profile:${summary.profile.id}`,
        source: 'profile',
        profileId: summary.profile.id,
        profile: summary.profile,
        name: summary.profile.name.trim(),
        email: summary.profile.email.trim(),
        phone: summary.profile.phone?.trim() ?? '',
        title: summary.profile.title?.trim() ?? '',
        institution: summary.profile.institution?.trim() ?? '',
        relationship: summary.profile.relationship?.trim() ?? '',
        notes: summary.profile.notes?.trim() ?? '',
        uses: summary.uses,
        projects: summary.projects,
        projectCount: summary.projectCount,
        nextProject: summary.nextProject,
        nextUse: summary.nextUse,
        searchFields: summary.searchFields,
        searchText: summary.searchText,
      }),
    ),
    ...inferred.map(
      (candidate): ProfileRecommenderDirectoryEntry => ({
        key: `application:${candidate.key}`,
        source: 'application',
        profile: null,
        name: candidate.name.trim(),
        email: candidate.email.trim(),
        phone: candidate.phone.trim(),
        title: '',
        institution: '',
        relationship: '',
        notes: '',
        uses: candidate.uses,
        projects: candidate.projects,
        projectCount: candidate.projectCount,
        nextProject: candidate.nextProject,
        nextUse: candidate.nextUse,
        searchFields: candidate.searchFields,
        searchText: candidate.searchText,
      }),
    ),
  ].sort(compareProfileRecommenderDirectoryOrder)

  return {
    uses,
    directory,
    saved,
    inferred,
  }
}

export function profileRecommenderSuggestions(
  directory: readonly ProfileRecommenderDirectoryEntry[],
): ProfileRecommenderSuggestion[] {
  return directory.map((entry) => {
    const fields: ProfileRecommenderSuggestionFields = {
      key: entry.key,
      name: entry.name,
      email: entry.email,
      phone: entry.phone,
      title: entry.title,
      institution: entry.institution,
      relationship: entry.relationship,
      notes: entry.notes,
      updatedAt: entry.profile?.updatedAt,
      projectCount: entry.projectCount,
      searchText: entry.searchText,
    }
    const profileId = entry.profile?.id
    return entry.source === 'profile' && profileId
      ? { ...fields, source: 'profile', profileId }
      : { ...fields, source: 'application' }
  })
}

export function newProfileRecommenderId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `recommender-${globalThis.crypto.randomUUID()}`
  }
  return `recommender-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function profileRecommenderFromInferred(
  candidate: InferredProfileRecommender,
  now = new Date(),
): ProfileRecommender {
  const timestamp = now.toISOString()
  return {
    id: newProfileRecommenderId(),
    name: candidate.name.trim(),
    email: candidate.email.trim(),
    phone: candidate.phone.trim(),
    title: '',
    institution: '',
    relationship: '',
    notes: '',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function materialRecommenderMatchesProfile(
  recommender: MaterialRecommender,
  profile: ProfileRecommender,
): boolean {
  return recommenderUseMatchesSavedProfile(
    {
      id: recommender.id,
      applicationId: '',
      schoolName: '',
      program: '',
      deadline: '',
      materialId: '',
      materialName: '',
      recommenderId: recommender.id,
      profileId: recommender.profileId,
      name: recommender.name,
      email: materialRecommenderEmail(recommender),
      phone: materialRecommenderPhone(recommender),
      contact: recommender.contact,
    },
    profile,
  )
}
