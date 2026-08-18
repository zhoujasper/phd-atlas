import {
  canonicalApplicationProjectionChunks,
  canonicalJsonChunks,
} from './applicationCanonical.js'
import {
  APPLICATION_AUTHORED_PROJECTION_VERSION,
  APPLICATION_SERVER_AUTHORITY_FIELDS,
  COMMUNICATION_SERVER_AUTHORITY_FIELDS,
  SCHOOL_SERVER_AUTHORITY_FIELDS,
  VAULT_REFERENCE_FIELDS,
} from './applicationAuthorityFields.js'

export { COMMUNICATION_SERVER_AUTHORITY_FIELDS } from './applicationAuthorityFields.js'

export {
  APPLICATION_AUTHORED_PROJECTION_VERSION,
}
export const APPLICATION_AUTHORITY_PROJECTION_VERSION = 1
export const APPLICATION_MUTATION_MAX_PATCH_OPERATIONS = 2_048
export const APPLICATION_MUTATION_AUTHORITY_PATHS = Object.freeze({
  none: Object.freeze([]),
  create: Object.freeze(['/createdAt', '/id', '/ownerId', '/teamId', '/teamTransferRequest']),
  'school-logo': Object.freeze(['/school/logo']),
  'team-transfer': Object.freeze(['/teamId', '/teamTransferRequest']),
  'trash-restore': Object.freeze(['/deletedAt']),
})

const createText = (value, fallback = '') => (typeof value === 'string' ? value : fallback)

/**
 * Sparse deterministic baseline for POST /api/applications. Every authored
 * leaf copied from the request is placed at its canonical application path,
 * including the three references to notes. Large request strings are reused by
 * reference and therefore never need to be echoed by the acknowledgement.
 */
export function applicationCreateAcknowledgementCandidate(input) {
  const source = isRecord(input) ? input : {}
  const notes = createText(source.notes)
  const deadline = createText(source.deadline)
  return {
    professor: {
      english: createText(source.professor),
      chinese: createText(source.professorChinese),
      email: createText(source.professorEmail),
      homepage: createText(source.professorHomepage),
      research: notes || 'Research fit notes to be added.',
    },
    school: {
      name: createText(source.university),
      country: createText(source.country),
      website: createText(source.website),
    },
    program: createText(source.program),
    deadline,
    nextReminder: deadline,
    result: notes || 'Draft created.',
    timeline: [{ note: notes || 'Application workspace initialized.' }],
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function withoutFields(value, excluded) {
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !excluded.has(key)))
}

function projectedArray(value, excluded) {
  return Array.isArray(value) ? value.map((item) => withoutFields(item, excluded)) : value
}

/**
 * The sole browser/server definition of application content authored through
 * the resident editor. The protocol intentionally omits capability handles,
 * vault references, delivery state, cache assets, and server timestamps — the
 * sets it excludes are declared once in `applicationAuthorityFields.js`.
 */
export function applicationUserEditablePersistenceProjection(application) {
  const projection = withoutFields(application, APPLICATION_SERVER_AUTHORITY_FIELDS)
  if (!isRecord(projection)) return {}
  projection.materials = projectedArray(projection.materials, VAULT_REFERENCE_FIELDS)
  projection.tasks = projectedArray(projection.tasks, VAULT_REFERENCE_FIELDS)
  projection.communications = projectedArray(
    projection.communications,
    COMMUNICATION_SERVER_AUTHORITY_FIELDS,
  )
  if (isRecord(projection.school)) {
    projection.school = withoutFields(projection.school, SCHOOL_SERVER_AUTHORITY_FIELDS)
  }
  return projection
}

/** Deterministic bounded chunks for a Node incremental SHA-256 writer. */
export function * canonicalApplicationUserEditableChunks(application) {
  // Stable key order for { application, projectionVersion }. Walk the
  // projection in place so large dossier strings and arrays are not copied.
  yield '{"application":'
  yield * canonicalApplicationProjectionChunks(application)
  yield `,"projectionVersion":${APPLICATION_AUTHORED_PROJECTION_VERSION}}`
}

/**
 * Constant-shape server-authority receipt committed beside payload_json.
 * Missing optional authority is normalized to null so a newly created client
 * can independently reproduce the receipt without receiving hidden defaults.
 * The logo is walked in bounded chunks; no base64-sized intermediate string is
 * allocated while hashing.
 */
export function * canonicalApplicationAuthorityReceiptChunks(application, authorityPurpose = 'none') {
  if (!Object.hasOwn(APPLICATION_MUTATION_AUTHORITY_PATHS, authorityPurpose)) {
    throw new TypeError('Unknown application mutation authority purpose.')
  }
  const source = isRecord(application) ? application : {}
  const school = isRecord(source.school) ? source.school : {}
  const values = [
    ['createdAt', typeof source.createdAt === 'string' ? source.createdAt : null],
    ['id', typeof source.id === 'string' ? source.id : null],
    ['ownerId', typeof source.ownerId === 'string' ? source.ownerId : null],
    ['teamId', typeof source.teamId === 'string' ? source.teamId : null],
  ]
  if (authorityPurpose === 'school-logo') {
    values.push(['schoolLogo', isRecord(school.logo) ? school.logo : null])
  }
  if (authorityPurpose === 'create' || authorityPurpose === 'team-transfer') {
    values.push([
      'teamTransferRequest',
      isRecord(source.teamTransferRequest) ? source.teamTransferRequest : null,
    ])
  }
  if (authorityPurpose === 'trash-restore') {
    values.push(['deletedAt', typeof source.deletedAt === 'string' ? source.deletedAt : null])
  }
  values.sort(([left], [right]) => left.localeCompare(right))
  yield '{'
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0) yield ','
    const [key, value] = values[index]
    yield `"${key}":`
    yield * canonicalJsonChunks(value)
  }
  yield '}'
}

/** Stable UTF-8 input for browser WebCrypto SHA-256. */
export function canonicalApplicationUserEditableJson(application) {
  return [...canonicalApplicationUserEditableChunks(application)].join('')
}
