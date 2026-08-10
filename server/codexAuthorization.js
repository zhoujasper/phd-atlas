import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

export const CODEX_AUTHORIZATION_SCOPE_VERSION = 2
export const CODEX_CAPABILITIES_SCHEMA_VERSION = 2
export const CODEX_AUTHORIZATION_TOKEN_PREFIX = 'phda_cdx_v1'
export const CODEX_AUTHORIZATION_EXPIRY_DAYS = Object.freeze([30, 90, 180, 365])
export const DEFAULT_CODEX_AUTHORIZATION_EXPIRY_DAYS = 365

const PAT_SELECTOR_BYTES = 12
const PAT_SECRET_BYTES = 32
const DEVICE_CODE_BYTES = 32
const USER_CODE_BYTES = 5
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const CROCKFORD_USER_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{8}$/
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/
const HEX_SHA256_PATTERN = /^[a-f0-9]{64}$/i
const ROUTE_PREFIXES = Object.freeze({
  applications: Object.freeze(['/api/applications']),
  profile: Object.freeze([
    '/api/profile-assets',
    '/api/profile/recommenders',
    '/api/codex/profile-recommenders',
  ]),
  files: Object.freeze([
    '/api/files',
    '/api/applications/:applicationId/materials/:materialId/file',
    '/api/applications/:applicationId/materials/:materialId/files/:fileId',
    '/api/applications/:applicationId/tasks/:taskId/file',
    '/api/applications/:applicationId/tasks/:taskId/files/:fileId',
    '/api/profile-assets/:assetId/files',
  ]),
  communications: Object.freeze([
    '/api/applications/:applicationId/communications',
    '/api/applications/:applicationId/review-comments',
    '/api/applications/:applicationId/request-feedback',
  ]),
  discover: Object.freeze(['/api/discover']),
  notifications: Object.freeze(['/api/notifications']),
  settings: Object.freeze(['/api/codex/settings', '/api/settings']),
  ai: Object.freeze(['/api/ai']),
  exports: Object.freeze(['/api/exports', '/api/profile-assets/:assetId/export']),
  backups: Object.freeze(['/api/backups']),
  analytics: Object.freeze(['/api/analytics']),
  shares: Object.freeze([
    '/api/applications/:applicationId/share',
    '/api/profile-assets/:assetId/share',
  ]),
  mail: Object.freeze([
    '/api/settings/test-email',
    '/api/settings/receive-email-verification',
    '/api/settings/test-incoming-mail',
    '/api/settings/fetch-mail-now',
    '/api/settings/sync-mail-history',
  ]),
  interview: Object.freeze(['/api/interview-prep']),
})

export const CODEX_INTERVIEW_PREP_ROUTE_POLICY = Object.freeze([
  Object.freeze({
    method: 'GET',
    path: '/api/interview-prep/workspace',
    capability: 'interview.read',
    requiredScopes: Object.freeze(['interview:read']),
  }),
  Object.freeze({
    method: 'PUT',
    path: '/api/interview-prep/workspace',
    capability: 'interview.write',
    requiredScopes: Object.freeze(['interview:write']),
  }),
  Object.freeze({
    method: 'POST',
    path: '/api/interview-prep/ai/questions',
    capability: 'interview.ai',
    requiredScopes: Object.freeze(['interview:use', 'ai:use']),
  }),
  Object.freeze({
    method: 'POST',
    path: '/api/interview-prep/ai/mock-turn',
    capability: 'interview.ai',
    requiredScopes: Object.freeze(['interview:use', 'ai:use']),
  }),
  Object.freeze({
    method: 'POST',
    path: '/api/interview-prep/ai/feedback',
    capability: 'interview.ai',
    requiredScopes: Object.freeze(['interview:use', 'ai:use']),
  }),
])

function scopeDefinition(scope, resource, action) {
  return Object.freeze({ scope, resource, action, routePrefixes: ROUTE_PREFIXES[resource] })
}

export const CODEX_AUTHORIZATION_SCOPE_DEFINITIONS = Object.freeze([
  scopeDefinition('applications:read', 'applications', 'read'),
  scopeDefinition('applications:write', 'applications', 'write'),
  scopeDefinition('profile:read', 'profile', 'read'),
  scopeDefinition('profile:write', 'profile', 'write'),
  scopeDefinition('files:read', 'files', 'read'),
  scopeDefinition('files:write', 'files', 'write'),
  scopeDefinition('communications:read', 'communications', 'read'),
  scopeDefinition('communications:send', 'communications', 'send'),
  scopeDefinition('discover:read', 'discover', 'read'),
  scopeDefinition('discover:write', 'discover', 'write'),
  scopeDefinition('notifications:read', 'notifications', 'read'),
  scopeDefinition('notifications:write', 'notifications', 'write'),
  scopeDefinition('settings:read', 'settings', 'read'),
  scopeDefinition('settings:write', 'settings', 'write'),
  scopeDefinition('ai:read', 'ai', 'read'),
  scopeDefinition('ai:use', 'ai', 'use'),
  scopeDefinition('ai:manage', 'ai', 'manage'),
  scopeDefinition('exports:read', 'exports', 'read'),
  scopeDefinition('backups:manage', 'backups', 'manage'),
  scopeDefinition('analytics:read', 'analytics', 'read'),
  scopeDefinition('shares:manage', 'shares', 'manage'),
  scopeDefinition('mail:manage', 'mail', 'manage'),
  scopeDefinition('interview:read', 'interview', 'read'),
  scopeDefinition('interview:write', 'interview', 'write'),
  scopeDefinition('interview:use', 'interview', 'use'),
])

export const CODEX_AUTHORIZATION_SCOPES = Object.freeze(
  CODEX_AUTHORIZATION_SCOPE_DEFINITIONS.map(({ scope }) => scope),
)

const CODEX_SCOPE_SET = new Set(CODEX_AUTHORIZATION_SCOPES)
const CODEX_SCOPE_ORDER = new Map(
  CODEX_AUTHORIZATION_SCOPES.map((scope, index) => [scope, index]),
)

const CODEX_SETTINGS_FIELD_SCOPE_ENTRIES = Object.freeze([
  ['language', 'settings:write'],
  ['contentLanguagePrimary', 'settings:write'],
  ['contentLanguageSecondary', 'settings:write'],
  ['highContrast', 'settings:write'],
  ['themeAccent', 'settings:write'],
  ['emailNotificationsEnabled', 'settings:write'],
  ['browserNotificationsEnabled', 'settings:write'],
  ['snippetPhraseLeadZh', 'settings:write'],
  ['snippetPhraseTailZh', 'settings:write'],
  ['snippetPhraseLeadEn', 'settings:write'],
  ['snippetPhraseTailEn', 'settings:write'],
  ['customApplicationStatuses', 'settings:write'],
  ['customChecklistStatuses', 'settings:write'],
  ['customChecklistMaterialFormats', 'settings:write'],
  ['trashRetentionDays', 'settings:write'],
  ['avatarDataUrl', 'profile:write'],
  ['profilePresets', 'profile:write'],
  ['autoBackup', 'backups:manage'],
  ['backupFrequency', 'backups:manage'],
  ['maxBackupsPerApp', 'backups:manage'],
  ['sendFrom', 'mail:manage'],
  ['receiveAt', 'mail:manage'],
  ['receiveEmails', 'mail:manage'],
  ['smtpHost', 'mail:manage'],
  ['smtpPort', 'mail:manage'],
  ['smtpUser', 'mail:manage'],
  ['smtpPass', 'mail:manage'],
  ['clearSmtpPass', 'mail:manage'],
  ['smtpTls', 'mail:manage'],
  ['incomingProtocol', 'mail:manage'],
  ['incomingHost', 'mail:manage'],
  ['incomingPort', 'mail:manage'],
  ['incomingUser', 'mail:manage'],
  ['incomingPass', 'mail:manage'],
  ['clearIncomingPass', 'mail:manage'],
  ['incomingTls', 'mail:manage'],
  ['autoFetchMail', 'mail:manage'],
  ['aiProfile', 'ai:manage'],
])

export const CODEX_SETTINGS_WRITE_FIELDS = Object.freeze(
  CODEX_SETTINGS_FIELD_SCOPE_ENTRIES.map(([field]) => field),
)

const CODEX_SETTINGS_FIELD_SCOPE = new Map(CODEX_SETTINGS_FIELD_SCOPE_ENTRIES)

export const CODEX_AUTHORIZATION_DENIED_PREFIXES = Object.freeze([
  '/api/auth',
  '/api/admin',
  '/api/admin-access',
  '/api/setup',
  '/api/account',
  '/api/share',
  '/api/asset-upload',
  '/api/teams',
  '/api/applications/:applicationId/team-transfer',
  '/api/applications/:applicationId/team-visibility',
  '/api/calendar',
  '/api/events',
  // Browser bootstrap streams can contain several independently scoped
  // resources in one response.  Codex must use the narrower advertised
  // business routes so each resource keeps its own scope boundary.
  '/api/workspace',
  '/api/codex/device',
  '/api/codex/authorizations',
])

function conditionalRequiredScope(source, path, operator, requiredScopes) {
  return Object.freeze({
    source,
    path: Object.freeze([...path]),
    operator,
    requiredScopes: Object.freeze([...requiredScopes]),
  })
}

const EXISTING_COMMUNICATION_ATTACHMENT_SCOPE = conditionalRequiredScope(
  'json-body',
  ['attachments', '*', 'fileId'],
  'non-empty-string',
  ['files:read'],
)

function routePrefix(prefix, methods, requiredScopes, conditionalRequiredScopes = []) {
  return Object.freeze({
    prefix,
    methods: Object.freeze([...methods]),
    requiredScopes: Object.freeze([...requiredScopes]),
    conditionalRequiredScopes: Object.freeze([...conditionalRequiredScopes]),
  })
}

export const CODEX_AUTHORIZATION_ROUTE_PREFIXES = Object.freeze([
  routePrefix('/api/codex/whoami', ['GET'], []),
  routePrefix('/api/codex/capabilities', ['GET'], []),
  routePrefix('/api/codex/authorizations/current', ['DELETE'], []),
  routePrefix('/api/codex/settings', ['GET'], ['settings:read']),
  routePrefix('/api/codex/profile-recommenders', ['GET'], ['profile:read']),
  routePrefix('/api/codex/profile-recommenders', ['POST', 'PATCH', 'DELETE'], ['profile:write']),
  routePrefix(
    '/api/applications/:applicationId/communications/send',
    ['POST'],
    ['applications:read', 'communications:send'],
    [EXISTING_COMMUNICATION_ATTACHMENT_SCOPE],
  ),
  routePrefix('/api/applications/:applicationId/communications/classify', ['POST'], ['applications:write', 'communications:read', 'ai:use']),
  routePrefix('/api/applications/:applicationId/communications/categories', ['PATCH'], ['applications:write', 'communications:read']),
  routePrefix('/api/applications/:applicationId/request-feedback', ['POST'], ['applications:read', 'communications:send']),
  routePrefix('/api/applications/:applicationId/communications', ['GET'], ['applications:read', 'communications:read']),
  routePrefix('/api/applications/:applicationId/communications', ['POST', 'PATCH'], ['applications:write', 'communications:send']),
  routePrefix('/api/applications/:applicationId/review-comments', ['GET'], ['applications:read', 'communications:read']),
  routePrefix('/api/applications/:applicationId/review-comments', ['POST'], ['applications:read', 'communications:send']),
  routePrefix(
    '/api/applications/:applicationId/recommenders/:recommenderId/resolve',
    ['POST'],
    ['applications:write', 'profile:write'],
  ),
  routePrefix('/api/applications/:applicationId/share', ['POST', 'PATCH', 'DELETE'], ['applications:write', 'shares:manage']),
  routePrefix('/api/applications/:applicationId/materials', ['POST'], ['applications:write', 'files:write']),
  routePrefix('/api/applications/:applicationId/materials/:materialId/file', ['POST', 'PATCH', 'DELETE'], ['applications:write', 'files:write']),
  routePrefix('/api/applications/:applicationId/materials/:materialId/files/:fileId', ['PATCH', 'DELETE'], ['applications:write', 'files:write']),
  routePrefix('/api/applications/:applicationId/tasks/:taskId/file', ['POST', 'PATCH', 'DELETE'], ['applications:write', 'files:write']),
  routePrefix('/api/applications/:applicationId/tasks/:taskId/files/:fileId', ['PATCH', 'DELETE'], ['applications:write', 'files:write']),
  routePrefix('/api/applications', ['GET'], ['applications:read']),
  routePrefix('/api/applications', ['POST', 'PUT', 'PATCH', 'DELETE'], ['applications:write']),
  routePrefix('/api/profile-assets/:assetId/export', ['GET'], ['profile:read', 'exports:read']),
  routePrefix('/api/profile-assets/:assetId/files', ['POST', 'PATCH', 'DELETE'], ['profile:write', 'files:write']),
  routePrefix('/api/profile-assets/:assetId/share', ['POST', 'PATCH', 'DELETE'], ['profile:write', 'shares:manage']),
  routePrefix('/api/profile-assets', ['GET'], ['profile:read']),
  routePrefix('/api/profile-assets', ['POST', 'PATCH', 'DELETE'], ['profile:write']),
  routePrefix('/api/profile/recommenders', ['GET'], ['profile:read']),
  routePrefix('/api/files', ['GET'], ['files:read']),
  // Advertise each Discover surface at its actual method/scope boundary.  The
  // broad entries below remain for forward-compatible, server-classified
  // Discover subresources, but clients choose these more-specific entries.
  routePrefix('/api/discover/catalog', ['GET'], ['discover:read']),
  routePrefix('/api/discover/state', ['GET'], ['discover:read']),
  routePrefix('/api/discover/state', ['PUT'], ['discover:write']),
  routePrefix('/api/discover/source-index', ['GET'], ['discover:read']),
  routePrefix('/api/discover/programs/delete', ['POST'], ['discover:write']),
  routePrefix('/api/discover/import', ['POST'], ['discover:write', 'applications:write']),
  routePrefix('/api/discover/research/start', ['POST'], ['discover:write', 'ai:use']),
  routePrefix('/api/discover/applications/:applicationId/enrichment/preview', ['POST'], ['applications:read', 'discover:read', 'ai:use']),
  routePrefix('/api/discover/applications/:applicationId/enrichment/apply', ['POST'], ['applications:write', 'discover:write']),
  routePrefix('/api/notifications', ['GET'], ['notifications:read']),
  routePrefix('/api/notifications', ['POST'], ['notifications:write']),
  routePrefix('/api/settings', ['PATCH'], ['settings:write']),
  routePrefix('/api/settings', ['PATCH'], ['profile:write']),
  routePrefix('/api/settings', ['PATCH'], ['backups:manage']),
  routePrefix('/api/settings', ['PATCH'], ['mail:manage']),
  routePrefix('/api/settings', ['PATCH'], ['ai:manage']),
  routePrefix('/api/ai/keys', ['GET'], ['ai:read']),
  routePrefix('/api/ai/keys', ['POST', 'PATCH', 'DELETE'], ['ai:manage']),
  routePrefix('/api/ai/keys/:keyId/test', ['POST'], ['ai:use', 'ai:manage']),
  routePrefix('/api/ai/draft', ['POST'], ['ai:use', 'applications:read']),
  routePrefix('/api/exports', ['GET'], ['exports:read', 'applications:read']),
  routePrefix('/api/backups', ['GET'], ['backups:manage']),
  routePrefix('/api/backups', ['POST'], ['backups:manage', 'applications:read']),
  routePrefix('/api/backups/:fileName/restore', ['POST'], ['backups:manage', 'applications:write']),
  routePrefix('/api/backups/:fileName', ['DELETE'], ['backups:manage']),
  routePrefix('/api/analytics', ['GET'], ['analytics:read']),
  routePrefix('/api/settings/test-email', ['POST'], ['mail:manage']),
  routePrefix('/api/settings/receive-email-verification', ['POST'], ['mail:manage']),
  routePrefix('/api/settings/test-incoming-mail', ['POST'], ['mail:manage']),
  routePrefix('/api/settings/fetch-mail-now', ['POST'], ['mail:manage']),
  routePrefix('/api/settings/sync-mail-history', ['POST'], ['mail:manage']),
  ...CODEX_INTERVIEW_PREP_ROUTE_POLICY.map(({ method, path, requiredScopes }) => (
    routePrefix(path, [method], requiredScopes)
  )),
])

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function validBase64UrlBytes(value, expectedBytes) {
  if (typeof value !== 'string' || !BASE64URL_PATTERN.test(value)) return false
  try {
    const decoded = Buffer.from(value, 'base64url')
    return decoded.length === expectedBytes && decoded.toString('base64url') === value
  } catch {
    return false
  }
}

function suppliedOrRandomBytes(value, expectedBytes, field) {
  if (value === undefined) return randomBytes(expectedBytes)
  const bytes = Buffer.from(value)
  if (bytes.length !== expectedBytes) {
    throw new RangeError(`${field} must contain exactly ${expectedBytes} bytes.`)
  }
  return bytes
}

function constantTimeHexEqual(actualHex, expectedHex) {
  const actualValid = HEX_SHA256_PATTERN.test(String(actualHex ?? ''))
  const expectedValid = HEX_SHA256_PATTERN.test(String(expectedHex ?? ''))
  const actual = actualValid ? Buffer.from(actualHex, 'hex') : Buffer.alloc(32)
  const expected = expectedValid ? Buffer.from(expectedHex, 'hex') : Buffer.alloc(32)
  return timingSafeEqual(actual, expected) && actualValid && expectedValid
}

export function parseCodexPersonalAccessToken(value) {
  const token = String(value ?? '').trim()
  const match = token.match(/^phda_cdx_v1_([A-Za-z0-9_-]{16})_([A-Za-z0-9_-]{43})$/)
  if (!match) return null
  if (
    !validBase64UrlBytes(match[1], PAT_SELECTOR_BYTES)
    || !validBase64UrlBytes(match[2], PAT_SECRET_BYTES)
  ) {
    return null
  }
  return { token, selector: match[1], secret: match[2] }
}

export function isCodexPersonalAccessToken(value) {
  return parseCodexPersonalAccessToken(value) !== null
}

export function hashCodexPersonalAccessToken(value) {
  const parsed = parseCodexPersonalAccessToken(value)
  if (!parsed) throw new TypeError('Invalid Codex personal access token.')
  return sha256(parsed.token)
}

export function codexPersonalAccessTokenHint(value) {
  const parsed = parseCodexPersonalAccessToken(value)
  if (!parsed) return null
  return `${CODEX_AUTHORIZATION_TOKEN_PREFIX}_${parsed.selector}_…${parsed.secret.slice(-4)}`
}

export function createCodexPersonalAccessToken(options = {}) {
  const selector = suppliedOrRandomBytes(
    options.selectorBytes,
    PAT_SELECTOR_BYTES,
    'selectorBytes',
  ).toString('base64url')
  const secret = suppliedOrRandomBytes(
    options.secretBytes,
    PAT_SECRET_BYTES,
    'secretBytes',
  ).toString('base64url')
  const token = `${CODEX_AUTHORIZATION_TOKEN_PREFIX}_${selector}_${secret}`
  return {
    token,
    selector,
    tokenHash: hashCodexPersonalAccessToken(token),
    hint: codexPersonalAccessTokenHint(token),
  }
}

export function verifyCodexPersonalAccessToken(value, expected) {
  const parsed = parseCodexPersonalAccessToken(value)
  const expectedHash = typeof expected === 'string' ? expected : expected?.tokenHash
  const expectedSelector = typeof expected === 'object' && expected !== null
    ? expected.selector
    : null
  const actualHash = parsed ? sha256(parsed.token) : sha256(String(value ?? ''))
  const hashMatches = constantTimeHexEqual(actualHash, expectedHash)
  const selectorMatches = expectedSelector === null || expectedSelector === undefined
    ? true
    : parsed?.selector === expectedSelector
  return Boolean(parsed && hashMatches && selectorMatches)
}

function crockfordEncode40Bit(bytes) {
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  let encoded = ''
  for (let shift = 35n; shift >= 0n; shift -= 5n) {
    encoded += CROCKFORD_ALPHABET[Number((value >> shift) & 31n)]
  }
  return encoded
}

export function normalizeCodexUserCode(value) {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '')
    .replaceAll('O', '0')
    .replace(/[IL]/g, '1')
  return CROCKFORD_USER_CODE_PATTERN.test(normalized) ? normalized : null
}

export function formatCodexUserCode(value) {
  const normalized = normalizeCodexUserCode(value)
  return normalized ? `${normalized.slice(0, 4)}-${normalized.slice(4)}` : null
}

export function createCodexUserCode(options = {}) {
  const bytes = suppliedOrRandomBytes(options.bytes, USER_CODE_BYTES, 'bytes')
  return formatCodexUserCode(crockfordEncode40Bit(bytes))
}

export function hashCodexUserCode(value, hmacSecret) {
  const normalized = normalizeCodexUserCode(value)
  if (!normalized) throw new TypeError('Invalid Codex user code.')
  if (hmacSecret === undefined || hmacSecret === null || String(hmacSecret).length === 0) {
    throw new TypeError('A non-empty HMAC secret is required to hash a Codex user code.')
  }
  return createHmac('sha256', hmacSecret).update(normalized).digest('hex')
}

export function createCodexDeviceCode(options = {}) {
  return suppliedOrRandomBytes(options.bytes, DEVICE_CODE_BYTES, 'bytes').toString('base64url')
}

export function hashCodexDeviceCode(value) {
  const deviceCode = String(value ?? '').trim()
  if (!validBase64UrlBytes(deviceCode, DEVICE_CODE_BYTES)) {
    throw new TypeError('Invalid Codex device code.')
  }
  return sha256(deviceCode)
}

export function createCodexDeviceAuthorization(options = {}) {
  const deviceCode = createCodexDeviceCode({ bytes: options.deviceCodeBytes })
  const userCode = createCodexUserCode({ bytes: options.userCodeBytes })
  return {
    deviceCode,
    deviceCodeHash: hashCodexDeviceCode(deviceCode),
    userCode,
    userCodeHash: hashCodexUserCode(userCode, options.userCodeHashSecret),
  }
}

export function normalizeCodexAuthorizationExpiryDays(value) {
  const days = value === undefined || value === null || value === ''
    ? DEFAULT_CODEX_AUTHORIZATION_EXPIRY_DAYS
    : Number(value)
  if (!CODEX_AUTHORIZATION_EXPIRY_DAYS.includes(days)) {
    throw new RangeError(`Codex authorization expiry must be one of: ${CODEX_AUTHORIZATION_EXPIRY_DAYS.join(', ')} days.`)
  }
  return days
}

export function codexAuthorizationExpiresAt(expiryDays, now = Date.now()) {
  const days = normalizeCodexAuthorizationExpiryDays(expiryDays)
  const startedAt = now instanceof Date ? now.getTime() : Number(now)
  if (!Number.isFinite(startedAt)) throw new TypeError('Invalid authorization start time.')
  return new Date(startedAt + days * 24 * 60 * 60_000).toISOString()
}

export function normalizeCodexAuthorizationScopes(value, options = {}) {
  const input = value instanceof Set ? [...value] : value
  if (!Array.isArray(input)) throw new TypeError('Codex authorization scopes must be an array.')
  const normalized = []
  const seen = new Set()
  for (const item of input) {
    const scope = String(item ?? '').trim().toLowerCase()
    if (!CODEX_SCOPE_SET.has(scope)) throw new RangeError(`Unsupported Codex authorization scope: ${scope || '(empty)'}.`)
    if (!seen.has(scope)) {
      seen.add(scope)
      normalized.push(scope)
    }
  }
  if (options.allowEmpty === false && normalized.length === 0) {
    throw new RangeError('Choose at least one Codex authorization scope.')
  }
  return normalized.sort((left, right) => CODEX_SCOPE_ORDER.get(left) - CODEX_SCOPE_ORDER.get(right))
}

export function codexCapabilitiesForScopes(value = [], credential = {}) {
  const valueIsCredential = value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && !(value instanceof Set)
  const metadata = valueIsCredential ? value : credential
  const scopeInput = valueIsCredential
    ? value.grantedScopes ?? value.scopes ?? []
    : value
  const grantedScopes = normalizeCodexAuthorizationScopes(scopeInput)
  const granted = new Set(grantedScopes)
  const routePrefixes = CODEX_AUTHORIZATION_ROUTE_PREFIXES
    .filter(({ requiredScopes }) => requiredScopes.every((scope) => granted.has(scope)))
    .map(({ prefix, methods, requiredScopes, conditionalRequiredScopes }) => ({
      prefix,
      methods: [...methods],
      requiredScopes: [...requiredScopes],
      conditionalRequiredScopes: conditionalRequiredScopes.map((requirement) => ({
        source: requirement.source,
        path: [...requirement.path],
        operator: requirement.operator,
        requiredScopes: [...requirement.requiredScopes],
      })),
    }))
  const deniedPrefixes = [...CODEX_AUTHORIZATION_DENIED_PREFIXES]
  return {
    schemaVersion: CODEX_CAPABILITIES_SCHEMA_VERSION,
    scopeVersion: CODEX_AUTHORIZATION_SCOPE_VERSION,
    credential: {
      id: metadata?.id ?? null,
      name: metadata?.name ?? '',
      grantedScopes,
      createdAt: metadata?.createdAt ?? null,
      lastUsedAt: metadata?.lastUsedAt ?? null,
      expiresAt: metadata?.expiresAt ?? null,
    },
    routePrefixes,
    deniedPrefixes,
  }
}

function normalizedMethod(value) {
  const method = String(value ?? '').trim().toUpperCase()
  if (method === 'HEAD') return 'GET'
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? method : null
}

function normalizedPath(value) {
  let path = String(value ?? '').trim()
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.includes('\0')) return null
  path = path.split('#', 1)[0].split('?', 1)[0]
  if (/%(?:2f|5c|00)/i.test(path)) return null
  try {
    path = decodeURIComponent(path)
  } catch {
    return null
  }
  if (/%[0-9a-f]{2}/i.test(path) || path.includes('\\') || path.includes('\0')) return null
  const segments = path.split('/').filter(Boolean)
  if (segments.some((segment) => segment === '.' || segment === '..')) return null
  path = `/${segments.join('/')}`.toLowerCase()
  return path === '/' ? path : path.replace(/\/+$/, '')
}

function denied(method, path, code, reason, extra = {}) {
  return {
    kind: 'deny',
    allowed: false,
    method,
    path,
    code,
    reason,
    capability: null,
    requiredScopes: [],
    ...extra,
  }
}

function classified(method, path, capability, requiredScopes, extra = {}) {
  return {
    kind: 'allow',
    allowed: true,
    method,
    path,
    code: 'CODEX_ROUTE_CLASSIFIED',
    reason: null,
    capability,
    requiredScopes: [...requiredScopes],
    ...extra,
  }
}

function settingsPatchClassification(method, path, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return denied(method, path, 'CODEX_SETTINGS_BODY_INVALID', 'Settings updates require a JSON object.')
  }
  const fields = Object.keys(body).sort()
  if (fields.length === 0) {
    return denied(method, path, 'CODEX_SETTINGS_BODY_INVALID', 'Settings updates cannot be empty.')
  }
  const forbiddenFields = fields.filter((field) => !CODEX_SETTINGS_FIELD_SCOPE.has(field))
  if (forbiddenFields.length > 0) {
    return denied(
      method,
      path,
      'CODEX_SETTINGS_FIELD_FORBIDDEN',
      'One or more settings fields are unavailable to Codex authorizations.',
      { forbiddenFields },
    )
  }
  const requiredScopes = normalizeCodexAuthorizationScopes(
    [...new Set(fields.map((field) => CODEX_SETTINGS_FIELD_SCOPE.get(field)))],
  )
  return classified(method, path, 'settings.write', requiredScopes, {
    fields,
    responsePolicy: 'codex-safe-user',
  })
}

function requestParts(input, path, body) {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return { method: input.method, path: input.path ?? input.pathname ?? input.originalUrl, body: input.body }
  }
  return { method: input, path, body }
}

const KNOWN_CODEX_BUSINESS_ROUTES = Object.freeze({
  GET: Object.freeze([
    /^\/api\/discover\/(?:catalog|state|source-index)$/,
    /^\/api\/applications$/,
    /^\/api\/applications\/trash$/,
    /^\/api\/applications\/[^/]+$/,
    /^\/api\/applications\/[^/]+\/review-comments\/threaded$/,
    /^\/api\/ai\/keys$/,
    /^\/api\/files\/[^/]+\/download$/,
    /^\/api\/profile-assets$/,
    /^\/api\/profile-assets\/[^/]+\/export$/,
    /^\/api\/profile\/recommenders(?:\/[^/]+)?$/,
    /^\/api\/notifications$/,
    /^\/api\/notifications\/unread-count$/,
    /^\/api\/analytics$/,
    /^\/api\/exports$/,
    /^\/api\/backups$/,
  ]),
  POST: Object.freeze([
    /^\/api\/discover\/(?:programs\/delete|research\/start|research|import)$/,
    /^\/api\/discover\/applications\/[^/]+\/enrichment\/(?:preview|apply)$/,
    /^\/api\/applications$/,
    /^\/api\/applications\/trash\/[^/]+\/restore$/,
    /^\/api\/applications\/[^/]+\/school-logo\/resolve$/,
    /^\/api\/applications\/[^/]+\/recommenders\/[^/]+\/resolve$/,
    /^\/api\/applications\/[^/]+\/(?:materials|communications|communications\/(?:send|classify)|scholarships|fees|tasks|share|review-comments|request-feedback)$/,
    /^\/api\/applications\/[^/]+\/materials\/[^/]+\/file$/,
    /^\/api\/applications\/[^/]+\/tasks\/[^/]+\/file$/,
    /^\/api\/ai\/keys$/,
    /^\/api\/ai\/keys\/[^/]+\/(?:test|usage\/reset)$/,
    /^\/api\/ai\/draft$/,
    /^\/api\/profile-assets$/,
    /^\/api\/profile-assets\/[^/]+\/(?:files|share)$/,
    /^\/api\/settings\/(?:test-email|receive-email-verification|test-incoming-mail|fetch-mail-now|sync-mail-history)$/,
    /^\/api\/notifications\/(?:[^/]+\/(?:read|unread|archive)|read-all|bulk)$/,
    /^\/api\/backups$/,
    /^\/api\/backups\/[^/]+\/restore$/,
  ]),
  PUT: Object.freeze([
    /^\/api\/discover\/state$/,
    /^\/api\/applications\/[^/]+$/,
  ]),
  PATCH: Object.freeze([
    /^\/api\/applications\/[^/]+\/school-logo$/,
    /^\/api\/applications\/[^/]+\/communications\/categories$/,
    /^\/api\/applications\/[^/]+\/materials\/[^/]+\/files\/[^/]+$/,
    /^\/api\/applications\/[^/]+\/communications\/[^/]+$/,
    /^\/api\/applications\/[^/]+\/fees\/[^/]+$/,
    /^\/api\/applications\/[^/]+\/tasks\/[^/]+$/,
    /^\/api\/applications\/[^/]+\/tasks\/[^/]+\/files\/[^/]+$/,
    /^\/api\/applications\/[^/]+\/share\/[^/]+$/,
    /^\/api\/ai\/keys\/[^/]+$/,
    /^\/api\/profile-assets\/[^/]+$/,
    /^\/api\/profile-assets\/[^/]+\/files\/[^/]+$/,
    /^\/api\/profile-assets\/[^/]+\/share\/[^/]+$/,
    /^\/api\/settings$/,
  ]),
  DELETE: Object.freeze([
    /^\/api\/applications\/trash(?:\/[^/]+)?$/,
    /^\/api\/applications\/[^/]+$/,
    /^\/api\/applications\/[^/]+\/materials\/[^/]+\/files\/[^/]+$/,
    /^\/api\/applications\/[^/]+\/fees\/[^/]+$/,
    /^\/api\/applications\/[^/]+\/tasks\/[^/]+\/files\/[^/]+$/,
    /^\/api\/applications\/[^/]+\/share\/[^/]+$/,
    /^\/api\/ai\/keys\/[^/]+$/,
    /^\/api\/profile-assets\/[^/]+$/,
    /^\/api\/profile-assets\/[^/]+\/files\/[^/]+$/,
    /^\/api\/profile-assets\/[^/]+\/share\/[^/]+$/,
    /^\/api\/backups\/[^/]+$/,
  ]),
})

function isKnownCodexBusinessRoute(method, pathname) {
  return KNOWN_CODEX_BUSINESS_ROUTES[method]?.some((pattern) => pattern.test(pathname)) ?? false
}

export function classifyCodexAuthorizationRequest(input, path, body) {
  const request = requestParts(input, path, body)
  const method = normalizedMethod(request.method)
  const pathname = normalizedPath(request.path)
  if (!method || !pathname) {
    return denied(method, pathname, 'CODEX_REQUEST_INVALID', 'The request method or path is invalid.')
  }

  if (method === 'GET' && pathname === '/api/codex/whoami') {
    return classified(method, pathname, 'codex.self.read', [], { responsePolicy: 'codex-safe-user' })
  }
  if (method === 'GET' && pathname === '/api/codex/capabilities') {
    return classified(method, pathname, 'codex.capabilities.read', [])
  }
  if (method === 'DELETE' && pathname === '/api/codex/authorizations/current') {
    return classified(method, pathname, 'codex.authorization.revoke_current', [])
  }
  if (method === 'GET' && pathname === '/api/codex/settings') {
    return classified(method, pathname, 'settings.read', ['settings:read'], {
      responsePolicy: 'codex-safe-settings',
    })
  }
  if (
    method === 'GET'
    && pathname === '/api/codex/profile-recommenders'
  ) {
    return classified(method, pathname, 'profile.recommenders.read', ['profile:read'])
  }
  if (
    method === 'POST'
    && pathname === '/api/codex/profile-recommenders'
  ) {
    return classified(method, pathname, 'profile.recommenders.write', ['profile:write'])
  }
  if (
    ['PATCH', 'DELETE'].includes(method)
    && /^\/api\/codex\/profile-recommenders\/[^/]+$/.test(pathname)
  ) {
    return classified(method, pathname, 'profile.recommenders.write', ['profile:write'])
  }

  const permanentlyForbidden = [
    /^\/api\/auth(?:\/|$)/,
    /^\/api\/admin(?:\/|$)/,
    /^\/api\/admin-access(?:\/|$)/,
    /^\/api\/setup(?:\/|$)/,
    /^\/api\/account(?:\/|$)/,
    /^\/api\/share(?:\/|$)/,
    /^\/api\/asset-upload(?:\/|$)/,
    /^\/api\/teams(?:\/|$)/,
    /^\/api\/applications\/[^/]+\/team-transfer(?:\/|$)/,
    /^\/api\/applications\/[^/]+\/team-visibility(?:\/|$)/,
    /^\/api\/calendar(?:\/|$)/,
    /^\/api\/events(?:\/|$)/,
    /^\/api\/codex(?:\/|$)/,
  ]
  if (permanentlyForbidden.some((pattern) => pattern.test(pathname))) {
    return denied(method, pathname, 'CODEX_ROUTE_FORBIDDEN', 'This route is not available to Codex authorizations.')
  }

  if (pathname === '/api/settings/verify-receive-email') {
    return denied(method, pathname, 'CODEX_ROUTE_FORBIDDEN', 'Email verification requires an interactive session.')
  }
  if (method === 'PATCH' && pathname === '/api/settings') {
    return settingsPatchClassification(method, pathname, request.body)
  }
  if (
    method === 'POST'
    && [
      '/api/settings/test-email',
      '/api/settings/receive-email-verification',
      '/api/settings/test-incoming-mail',
    ].includes(pathname)
  ) {
    return classified(method, pathname, 'mail.manage', ['mail:manage'])
  }
  if (
    method === 'POST'
    && ['/api/settings/fetch-mail-now', '/api/settings/sync-mail-history'].includes(pathname)
  ) {
    return classified(method, pathname, 'mail.manage', ['mail:manage'])
  }

  if (pathname.startsWith('/api/interview-prep')) {
    const interviewRoute = CODEX_INTERVIEW_PREP_ROUTE_POLICY.find((candidate) => (
      candidate.method === method && candidate.path === pathname
    ))
    if (!interviewRoute) {
      return denied(method, pathname, 'CODEX_ROUTE_UNMAPPED', 'This route is not in the Codex authorization allowlist.')
    }
    return classified(
      method,
      pathname,
      interviewRoute.capability,
      interviewRoute.requiredScopes,
    )
  }

  if (pathname.startsWith('/api/workspace')) {
    return denied(
      method,
      pathname,
      'CODEX_WORKSPACE_BOOTSTRAP_FORBIDDEN',
      'Workspace bootstrap routes are browser-only; use the narrower capability-advertised business routes.',
    )
  }

  if (pathname.startsWith('/api/push')) {
    return denied(method, pathname, 'CODEX_ROUTE_FORBIDDEN', 'This browser-only route is not available to Codex authorizations.')
  }

  if (!isKnownCodexBusinessRoute(method, pathname)) {
    return denied(method, pathname, 'CODEX_ROUTE_UNMAPPED', 'This route is not in the Codex authorization allowlist.')
  }

  if (/^\/api\/discover(?:\/|$)/.test(pathname)) {
    if (/^\/api\/discover\/applications\/[^/]+\/enrichment\/apply$/.test(pathname)) {
      return classified(method, pathname, 'discover.enrichment.apply', ['discover:write', 'applications:write'])
    }
    if (/^\/api\/discover\/applications\/[^/]+\/enrichment\/preview$/.test(pathname)) {
      return classified(
        method,
        pathname,
        'discover.enrichment.preview',
        ['applications:read', 'discover:read', 'ai:use'],
      )
    }
    if (pathname === '/api/discover/import') {
      return classified(method, pathname, 'discover.import', ['discover:write', 'applications:write'])
    }
    if (/^\/api\/discover\/research(?:\/start)?$/.test(pathname)) {
      return classified(method, pathname, 'discover.run', ['discover:write', 'ai:use'])
    }
    if (method === 'GET') return classified(method, pathname, 'discover.read', ['discover:read'])
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return classified(method, pathname, 'discover.write', ['discover:write'])
    }
  }

  if (/^\/api\/ai\/keys(?:\/|$)/.test(pathname)) {
    if (method === 'POST' && /^\/api\/ai\/keys\/[^/]+\/test$/.test(pathname)) {
      return classified(method, pathname, 'ai.test', ['ai:use', 'ai:manage'])
    }
    return method === 'GET' && pathname === '/api/ai/keys'
      ? classified(method, pathname, 'ai.read', ['ai:read'])
      : classified(method, pathname, 'ai.manage', ['ai:manage'])
  }
  if (method === 'POST' && pathname === '/api/ai/draft') {
    const grants = request.body?.grants && typeof request.body.grants === 'object'
      ? request.body.grants
      : {}
    const requiredScopes = new Set(['ai:use', 'applications:read'])
    if (grants.userProfile) requiredScopes.add('profile:read')
    if (grants.correspondence || request.body?.mode === 'reply' || request.body?.replyToId) {
      requiredScopes.add('communications:read')
    }
    if (grants.userProfile || grants.checklist || grants.tasks || grants.correspondence) {
      requiredScopes.add('files:read')
    }
    return classified(method, pathname, 'ai.use', [...requiredScopes])
  }

  if (/^\/api\/applications(?:\/|$)/.test(pathname)) {
    if (method === 'POST' && /\/recommenders\/[^/]+\/resolve$/.test(pathname)) {
      return classified(
        method,
        pathname,
        'applications.recommenders.resolve',
        ['applications:write', 'profile:write'],
      )
    }
    if (/\/share(?:\/|$)/.test(pathname)) {
      return classified(method, pathname, 'shares.manage', ['applications:write', 'shares:manage'])
    }
    if (/\/communications\/send$/.test(pathname)) {
      return classified(
        method,
        pathname,
        'communications.send',
        ['applications:read', 'communications:send'],
      )
    }
    if (/\/communications\/classify$/.test(pathname)) {
      return classified(
        method,
        pathname,
        'communications.classify',
        ['applications:write', 'communications:read', 'ai:use'],
      )
    }
    if (/\/communications\/categories$/.test(pathname)) {
      return classified(
        method,
        pathname,
        'communications.categories.write',
        ['applications:write', 'communications:read'],
      )
    }
    if (
      /\/communications(?:\/[^/]+)?$/.test(pathname)
      && ['POST', 'PATCH'].includes(method)
      && request.body
      && typeof request.body === 'object'
      && !Array.isArray(request.body)
      && ['mailCategoryOverride', 'mailClassification'].some((field) => (
        Object.prototype.hasOwnProperty.call(request.body, field)
      ))
    ) {
      return denied(
        method,
        pathname,
        'CODEX_COMMUNICATION_CLASSIFICATION_ROUTE_REQUIRED',
        'Mail categories and AI classifications may change only through their dedicated communication routes.',
      )
    }
    if (/\/request-feedback$/.test(pathname)) {
      return classified(
        method,
        pathname,
        'communications.send',
        ['applications:read', 'communications:send'],
      )
    }
    if (/\/review-comments(?:\/|$)/.test(pathname)) {
      return method === 'GET'
        ? classified(method, pathname, 'communications.read', ['applications:read', 'communications:read'])
        : classified(method, pathname, 'communications.send', ['applications:read', 'communications:send'])
    }
    if (/\/communications(?:\/|$)/.test(pathname)) {
      return method === 'GET'
        ? classified(method, pathname, 'communications.read', ['applications:read', 'communications:read'])
        : classified(method, pathname, 'communications.write', ['applications:write', 'communications:send'])
    }
    const fileMutation = /\/(?:materials|tasks)\/[^/]+\/(?:file|files\/[^/]+)$/.test(pathname)
    if (fileMutation) {
      return classified(method, pathname, 'files.write', ['applications:write', 'files:write'])
    }
    if (method === 'POST' && /^\/api\/applications\/[^/]+\/materials$/.test(pathname)) {
      return classified(method, pathname, 'files.write', ['applications:write', 'files:write'])
    }
    return method === 'GET'
      ? classified(method, pathname, 'applications.read', ['applications:read'])
      : classified(method, pathname, 'applications.write', ['applications:write'])
  }

  if (/^\/api\/profile-assets(?:\/|$)/.test(pathname)) {
    if (method === 'GET' && /\/export$/.test(pathname)) {
      return classified(method, pathname, 'profile.export', ['profile:read', 'exports:read'])
    }
    if (/\/share(?:\/|$)/.test(pathname)) {
      return classified(method, pathname, 'shares.manage', ['profile:write', 'shares:manage'])
    }
    if (/\/files(?:\/|$)/.test(pathname)) {
      return classified(method, pathname, 'files.write', ['profile:write', 'files:write'])
    }
    return method === 'GET'
      ? classified(method, pathname, 'profile.read', ['profile:read'])
      : classified(method, pathname, 'profile.write', ['profile:write'])
  }

  if (method === 'GET' && /^\/api\/files\/[^/]+\/download$/.test(pathname)) {
    return classified(method, pathname, 'files.read', ['files:read'])
  }

  if (/^\/api\/notifications(?:\/|$)/.test(pathname)) {
    return method === 'GET'
      ? classified(method, pathname, 'notifications.read', ['notifications:read'])
      : classified(method, pathname, 'notifications.write', ['notifications:write'])
  }

  if (method === 'GET' && pathname === '/api/analytics') {
    return classified(method, pathname, 'analytics.read', ['analytics:read'])
  }
  if (method === 'GET' && pathname === '/api/exports') {
    return classified(method, pathname, 'exports.read', ['exports:read', 'applications:read'])
  }
  if (/^\/api\/backups(?:\/|$)/.test(pathname)) {
    if (method === 'POST' && /^\/api\/backups\/[^/]+\/restore$/.test(pathname)) {
      return classified(method, pathname, 'backups.restore', ['backups:manage', 'applications:write'], {
        responsePolicy: 'codex-backup-restore',
      })
    }
    if (method === 'POST' && pathname === '/api/backups') {
      return classified(method, pathname, 'backups.create', ['backups:manage', 'applications:read'])
    }
    return classified(method, pathname, 'backups.manage', ['backups:manage'])
  }

  return denied(method, pathname, 'CODEX_ROUTE_UNMAPPED', 'This route is not in the Codex authorization allowlist.')
}

export function authorizeCodexRequest(input) {
  const classification = classifyCodexAuthorizationRequest(input)
  if (classification.kind === 'deny') return classification
  if (
    input?.scopeVersion !== undefined
    && Number(input.scopeVersion) !== CODEX_AUTHORIZATION_SCOPE_VERSION
  ) {
    return denied(
      classification.method,
      classification.path,
      'CODEX_AUTHORIZATION_REAUTHORIZATION_REQUIRED',
      `Codex authorization scope version ${CODEX_AUTHORIZATION_SCOPE_VERSION} is required; create a new authorization to continue.`,
      { capability: classification.capability, requiredScopes: classification.requiredScopes },
    )
  }
  let grantedScopes
  try {
    grantedScopes = normalizeCodexAuthorizationScopes(input?.scopes ?? [])
  } catch {
    return denied(
      classification.method,
      classification.path,
      'CODEX_SCOPE_INVALID',
      'The authorization contains an invalid scope set.',
      { capability: classification.capability, requiredScopes: classification.requiredScopes },
    )
  }
  const granted = new Set(grantedScopes)
  const missingScopes = classification.requiredScopes.filter((scope) => !granted.has(scope))
  if (missingScopes.length > 0) {
    return {
      ...classification,
      allowed: false,
      code: 'CODEX_SCOPE_REQUIRED',
      reason: 'The authorization does not include every scope required for this operation.',
      grantedScopes,
      missingScopes,
    }
  }
  return {
    ...classification,
    allowed: true,
    code: 'CODEX_ALLOWED',
    grantedScopes,
    missingScopes: [],
  }
}
