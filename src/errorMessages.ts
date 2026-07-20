import { ApiError } from './api/phdApi'
import { t, tpl, type Language } from './i18n'

const LIMIT_PATTERN = /\b(\d[\d,]*)\b/

const ERROR_KEY_BY_CODE: Record<string, string> = {
  ACCOUNT_DISABLED: 'apiErrors.ACCOUNT_DISABLED',
  ADMIN_REQUIRED: 'apiErrors.ADMIN_REQUIRED',
  AI_ENRICHMENT_FAILED: 'apiErrors.AI_ENRICHMENT_FAILED',
  AI_ENRICHMENT_INVALID: 'apiErrors.AI_ENRICHMENT_INVALID',
  AI_KEY_REQUIRED: 'apiErrors.AI_KEY_REQUIRED',
  AI_RESEARCH_FAILED: 'apiErrors.AI_RESEARCH_FAILED',
  AI_STREAM_UNAVAILABLE: 'apiErrors.AI_STREAM_UNAVAILABLE',
  API_HTML_RESPONSE: 'apiErrors.API_HTML_RESPONSE',
  APPLICATION_BACKUP_REQUIRES_CONTEXT: 'apiErrors.APPLICATION_BACKUP_REQUIRES_CONTEXT',
  APPLICATION_CREATE_LIMIT_REACHED: 'apiErrors.APPLICATION_CREATE_LIMIT_REACHED',
  APPLICATION_EXISTS: 'apiErrors.APPLICATION_EXISTS',
  APPLICATION_LIMIT_REACHED: 'apiErrors.APPLICATION_LIMIT_REACHED',
  APPLICATION_REQUIRED: 'apiErrors.APPLICATION_REQUIRED',
  APPLICATION_VERSION_CONFLICT: 'apiErrors.APPLICATION_VERSION_CONFLICT',
  ATTACHMENT_NOT_FOUND: 'apiErrors.ATTACHMENT_NOT_FOUND',
  CORS_ORIGIN_DENIED: 'apiErrors.CORS_ORIGIN_DENIED',
  DISCOVER_CATALOG_EMPTY: 'apiErrors.DISCOVER_CATALOG_EMPTY',
  DISCOVER_PI_NOT_FOUND: 'apiErrors.DISCOVER_PI_NOT_FOUND',
  DISCOVER_PROGRAM_NOT_FOUND: 'apiErrors.DISCOVER_PROGRAM_NOT_FOUND',
  EMAIL_EXISTS: 'apiErrors.EMAIL_EXISTS',
  EMAIL_ALREADY_VERIFIED: 'apiErrors.EMAIL_ALREADY_VERIFIED',
  EMAIL_LIMIT_REACHED: 'apiErrors.EMAIL_LIMIT_REACHED',
  EMAIL_MISMATCH: 'apiErrors.EMAIL_MISMATCH',
  EMAIL_VERIFICATION_COOLDOWN: 'apiErrors.EMAIL_VERIFICATION_COOLDOWN',
  EXPIRED: 'apiErrors.EXPIRED',
  ENRICHMENT_APPLICATION_MISMATCH: 'apiErrors.ENRICHMENT_APPLICATION_MISMATCH',
  ENRICHMENT_PREVIEW_STALE: 'apiErrors.ENRICHMENT_PREVIEW_STALE',
  FILE_REQUIRED: 'apiErrors.FILE_REQUIRED',
  FORBIDDEN: 'apiErrors.FORBIDDEN',
  INVALID_BACKUP_NAME: 'apiErrors.INVALID_BACKUP_NAME',
  INVALID_CAPTCHA: 'apiErrors.INVALID_CAPTCHA',
  INVALID_CREDENTIALS: 'apiErrors.INVALID_CREDENTIALS',
  INVALID_EMAIL_CODE: 'apiErrors.INVALID_EMAIL_CODE',
  INVALID_ENCRYPTION_PASSWORD: 'apiErrors.INVALID_ENCRYPTION_PASSWORD',
  INVALID_UPDATE_PACKAGE: 'apiErrors.INVALID_UPDATE_PACKAGE',
  LAST_ADMIN: 'apiErrors.LAST_ADMIN',
  MAIL_CONNECTION_FAILED: 'apiErrors.MAIL_CONNECTION_FAILED',
  MAIL_FETCH_EMPTY_SCOPE: 'apiErrors.MAIL_FETCH_EMPTY_SCOPE',
  MAIL_FETCH_NOT_CONFIGURED: 'apiErrors.MAIL_FETCH_NOT_CONFIGURED',
  MAIL_FETCH_UNSUPPORTED_PROTOCOL: 'apiErrors.MAIL_FETCH_UNSUPPORTED_PROTOCOL',
  MAIL_NOT_CONFIGURED: 'apiErrors.MAIL_NOT_CONFIGURED',
  MEMBER_ALREADY_INVITED: 'apiErrors.MEMBER_ALREADY_INVITED',
  MISSING_FILE: 'apiErrors.MISSING_FILE',
  NETWORK_ERROR: 'apiErrors.NETWORK_ERROR',
  NOT_FOUND: 'apiErrors.NOT_FOUND',
  IMPERSONATION_FORBIDDEN: 'apiErrors.IMPERSONATION_FORBIDDEN',
  IMPERSONATION_TARGET_NOT_FOUND: 'apiErrors.IMPERSONATION_TARGET_NOT_FOUND',
  PASSKEY_ALREADY_REGISTERED: 'apiErrors.PASSKEY_ALREADY_REGISTERED',
  PASSKEY_NOT_FOUND: 'apiErrors.PASSKEY_NOT_FOUND',
  PASSKEY_VERIFICATION_FAILED: 'apiErrors.PASSKEY_VERIFICATION_FAILED',
  RATE_LIMITED: 'apiErrors.RATE_LIMITED',
  REGISTRATION_CLOSED: 'apiErrors.REGISTRATION_CLOSED',
  REQUEST_FAILED: 'apiErrors.REQUEST_FAILED',
  REQUEST_TIMEOUT: 'apiErrors.REQUEST_TIMEOUT',
  SERVER_UNAVAILABLE: 'apiErrors.SERVER_UNAVAILABLE',
  SEAT_LIMIT_REACHED: 'apiErrors.SEAT_LIMIT_REACHED',
  SEAT_LIMIT_TOO_LOW: 'apiErrors.SEAT_LIMIT_TOO_LOW',
  SERVER_ERROR: 'apiErrors.SERVER_ERROR',
  SETUP_ALREADY_COMPLETED: 'apiErrors.SETUP_ALREADY_COMPLETED',
  SHARE_CREATE_LIMIT_REACHED: 'apiErrors.SHARE_CREATE_LIMIT_REACHED',
  SHARE_LIMIT_REACHED: 'apiErrors.SHARE_LIMIT_REACHED',
  SMTP_NOT_CONFIGURED: 'apiErrors.SMTP_NOT_CONFIGURED',
  TEAM_APPLICATION_LIMIT_REACHED: 'apiErrors.TEAM_APPLICATION_LIMIT_REACHED',
  TEACHER_NOT_FOUND: 'apiErrors.TEACHER_NOT_FOUND',
  TEAM_ID_REQUIRED: 'apiErrors.TEAM_ID_REQUIRED',
  TEAM_IMPERSONATION_SCOPE_REQUIRED: 'apiErrors.TEAM_IMPERSONATION_SCOPE_REQUIRED',
  TEAM_MERGE_CONFLICT: 'apiErrors.TEAM_MERGE_CONFLICT',
  TEAM_NOT_ACCESSIBLE: 'apiErrors.TEAM_NOT_ACCESSIBLE',
  TEAM_REQUIRED: 'apiErrors.TEAM_REQUIRED',
  TEAM_STORAGE_QUOTA_EXCEEDED: 'apiErrors.TEAM_STORAGE_QUOTA_EXCEEDED',
  TEAM_TRANSFER_NOT_AVAILABLE: 'apiErrors.TEAM_TRANSFER_NOT_AVAILABLE',
  TEAM_TRANSFER_NOT_FOUND: 'apiErrors.TEAM_TRANSFER_NOT_FOUND',
  TEAM_TRANSFER_STUDENT_REQUIRED: 'apiErrors.TEAM_TRANSFER_STUDENT_REQUIRED',
  TEAM_ROLE_FORBIDDEN: 'apiErrors.TEAM_ROLE_FORBIDDEN',
  TEAM_SHARE_CREATE_LIMIT_REACHED: 'apiErrors.TEAM_SHARE_CREATE_LIMIT_REACHED',
  TEAM_SHARE_LIMIT_REACHED: 'apiErrors.TEAM_SHARE_LIMIT_REACHED',
  TEAM_STUDENT_FORBIDDEN: 'apiErrors.TEAM_STUDENT_FORBIDDEN',
  TEAM_STUDENT_NOT_FOUND: 'apiErrors.TEAM_STUDENT_NOT_FOUND',
  TEAM_STUDENT_REQUIRED: 'apiErrors.TEAM_STUDENT_REQUIRED',
  TEAM_VISIBILITY_OWNER_REQUIRED: 'apiErrors.TEAM_VISIBILITY_OWNER_REQUIRED',
  TOKEN_EXPIRED: 'apiErrors.TOKEN_EXPIRED',
  UPDATE_APPLY_FAILED: 'apiErrors.UPDATE_APPLY_FAILED',
  UPDATE_INTEGRITY_FAILED: 'apiErrors.UPDATE_INTEGRITY_FAILED',
  UNAUTHORIZED: 'apiErrors.UNAUTHORIZED',
  UNSAFE_ATTACHMENT: 'apiErrors.UNSAFE_ATTACHMENT',
  UNTRUSTED_ORIGIN: 'apiErrors.UNTRUSTED_ORIGIN',
  UNTRUSTED_HOST: 'apiErrors.UNTRUSTED_HOST',
  UNKNOWN_USER: 'apiErrors.UNKNOWN_USER',
  UNSUPPORTED_BACKUP_SCOPE: 'apiErrors.UNSUPPORTED_BACKUP_SCOPE',
  UNSUPPORTED_FILE_TYPE: 'apiErrors.UNSUPPORTED_FILE_TYPE',
  VALIDATION_ERROR: 'apiErrors.VALIDATION_ERROR',
  PUSH_DELIVERY_FAILED: 'apiErrors.PUSH_DELIVERY_FAILED',
  SESSION_IDENTITY_MISMATCH: 'apiErrors.SESSION_IDENTITY_MISMATCH',
  // AI provider / key management
  PROVIDER_UNAVAILABLE: 'apiErrors.PROVIDER_UNAVAILABLE',
  PROVIDER_REJECTED: 'apiErrors.PROVIDER_REJECTED',
  PROVIDER_TIMEOUT: 'apiErrors.PROVIDER_TIMEOUT',
  INVALID_BASE_URL: 'apiErrors.INVALID_BASE_URL',
  EMPTY_STREAM: 'apiErrors.EMPTY_STREAM',
  EMPTY_DRAFT: 'apiErrors.EMPTY_DRAFT',
  KEY_UNAVAILABLE: 'apiErrors.KEY_UNAVAILABLE',
  UNSUPPORTED_PROVIDER: 'apiErrors.UNSUPPORTED_PROVIDER',
  AI_KEY_TEST_FAILED: 'apiErrors.AI_KEY_TEST_FAILED',
  AI_KEY_NOT_FOUND: 'apiErrors.AI_KEY_NOT_FOUND',
  AI_KEY_SCOPE_MISMATCH: 'apiErrors.AI_KEY_SCOPE_MISMATCH',
  AI_ATTACHMENTS_UNSUPPORTED: 'apiErrors.AI_ATTACHMENTS_UNSUPPORTED',
  TEAM_AI_ADMIN_REQUIRED: 'apiErrors.TEAM_AI_ADMIN_REQUIRED',
}

/** Known English server messages → i18n keys (for non-ApiError or unmapped codes). */
const ERROR_KEY_BY_MESSAGE: Record<string, string> = {
  'the ai provider could not be reached.': 'apiErrors.PROVIDER_UNAVAILABLE',
  'the ai provider rejected this request. check the model, key, and provider url.': 'apiErrors.PROVIDER_REJECTED',
  'the ai provider took too long to respond.': 'apiErrors.PROVIDER_TIMEOUT',
  'the provider url is invalid.': 'apiErrors.INVALID_BASE_URL',
  'the provider url must be a public https endpoint.': 'apiErrors.INVALID_BASE_URL_HTTPS',
  'the provider url must not point to a local network address.': 'apiErrors.INVALID_BASE_URL_LOCAL',
  'the ai provider did not return a stream.': 'apiErrors.EMPTY_STREAM',
  'the ai provider did not return a draft.': 'apiErrors.EMPTY_DRAFT',
  'the saved ai key is unavailable.': 'apiErrors.KEY_UNAVAILABLE',
  'this ai provider is not supported.': 'apiErrors.UNSUPPORTED_PROVIDER',
  'could not verify this ai key. check the provider, model, and network.': 'apiErrors.AI_KEY_TEST_FAILED',
  'ai drafting failed. please try again.': 'apiErrors.AI_DRAFT_FAILED',
  'ai key not found.': 'apiErrors.AI_KEY_NOT_FOUND',
}

function extractLimit(message: string, lang: Language) {
  const match = message.match(LIMIT_PATTERN)
  return match?.[1]?.replace(/,/g, '') ?? t(lang, 'apiErrors.currentLimit')
}

function resolveApiErrorKey(error: ApiError) {
  const code = error.code
  const message = error.message.toLowerCase()

  if (code === 'STORAGE_QUOTA_EXCEEDED') {
    return message.includes('contact an administrator')
      ? 'apiErrors.STORAGE_QUOTA_EXCEEDED_ADMIN'
      : 'apiErrors.STORAGE_QUOTA_EXCEEDED_FREE'
  }

  if (code === 'PRO_REQUIRED') {
    if (message.includes('draft mailbox')) return 'apiErrors.PRO_REQUIRED_DRAFTS'
    if (message.includes('trash')) return 'apiErrors.PRO_REQUIRED_TRASH'
    if (message.includes('backup')) return 'apiErrors.PRO_REQUIRED_BACKUP'
    return 'apiErrors.PRO_REQUIRED'
  }

  if (code === 'VALIDATION_ERROR' && error.field) {
    return 'apiErrors.VALIDATION_ERROR_FIELD'
  }

  const mapped = ERROR_KEY_BY_CODE[code]
  if (mapped) return mapped
  if (code.startsWith('SMTP_')) return 'apiErrors.SMTP_ERROR'
  if (code.startsWith('MAIL_FETCH_')) return 'apiErrors.MAIL_FETCH_ERROR'

  return null
}

function localizeField(field: string | undefined, lang: Language) {
  if (!field) return ''
  const direct = t(lang, `apiErrorFields.${field}`, '')
  if (direct) return direct
  return field
    .split('.')
    .filter(Boolean)
    .map((part) => t(lang, `apiErrorFields.${part}`, part))
    .join(' / ')
}

function isNetworkError(message: string) {
  return /failed to fetch|networkerror|load failed|network request failed/i.test(message)
}

function isAsciiTechnicalMessage(message: string) {
  return message.length > 0 && Array.from(message).every((char) => {
    const code = char.charCodeAt(0)
    return code >= 32 && code <= 126
  })
}

function resolveKnownMessageKey(message: string) {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, ' ')
  return ERROR_KEY_BY_MESSAGE[normalized] ?? null
}

export function normalizeErrorMessage(error: unknown, lang: Language = 'en', fallback?: string) {
  if (error instanceof ApiError) {
    const key = resolveApiErrorKey(error) ?? resolveKnownMessageKey(error.message)
    if (!key) {
      if (lang === 'en') {
        return error.field ? `${error.message} (${localizeField(error.field, lang)})` : error.message
      }
      return tpl(t(lang, 'apiErrors.genericWithCode'), { code: error.code })
    }

    const message = tpl(t(lang, key), {
      code: error.code,
      field: localizeField(error.field, lang),
      limit: extractLimit(error.message, lang),
    })
    return message
  }

  if (error instanceof Error) {
    if (isNetworkError(error.message)) return t(lang, 'apiErrors.NETWORK_ERROR')
    const knownKey = resolveKnownMessageKey(error.message)
    if (knownKey) return t(lang, knownKey)
    if (lang !== 'en' && isAsciiTechnicalMessage(error.message)) {
      return fallback || t(lang, 'toast.unexpectedError')
    }
    return error.message || fallback || t(lang, 'toast.unexpectedError')
  }

  if (typeof error === 'string' && error.trim()) {
    const knownKey = resolveKnownMessageKey(error)
    if (knownKey) return t(lang, knownKey)
    if (lang !== 'en' && isAsciiTechnicalMessage(error)) {
      return fallback || t(lang, 'toast.unexpectedError')
    }
    return error
  }

  return fallback || t(lang, 'toast.unexpectedError')
}
