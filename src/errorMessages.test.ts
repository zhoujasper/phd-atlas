import { describe, expect, it } from 'vitest'
import { ApiError } from './api/phdApi'
import { normalizeErrorMessage } from './errorMessages'

describe('normalizeErrorMessage', () => {
  it('localizes rate-limit API errors instead of showing the server English message', () => {
    const error = new ApiError('Too many requests. Please try again shortly.', 'RATE_LIMITED', 429)

    expect(normalizeErrorMessage(error, 'zh')).toBe('请求过于频繁，请稍后再试。')
  })

  it('tells free users to upgrade when storage quota is exceeded', () => {
    const error = new ApiError(
      'Storage quota exceeded. Upgrade to Pro to unlock more storage.',
      'STORAGE_QUOTA_EXCEEDED',
      413,
    )

    expect(normalizeErrorMessage(error, 'zh')).toBe('存储空间已满。普通用户可升级到 Pro 以解锁更多空间。')
  })

  it('preserves the quota value for localized limit errors', () => {
    const error = new ApiError('Application records cannot exceed 3.', 'APPLICATION_LIMIT_REACHED', 409)

    expect(normalizeErrorMessage(error, 'zh')).toBe('申请记录已达到 3 条上限。请升级到 Pro，或联系管理员提高上限。')
  })

  it('uses the localized fallback for non-API English technical errors in Chinese', () => {
    expect(normalizeErrorMessage(new Error('Unexpected token < in JSON'), 'zh')).toBe('出现问题，请重试。')
  })

  it('localizes AI provider unreachable errors by code and English message', () => {
    const byCode = new ApiError('The AI provider could not be reached.', 'PROVIDER_UNAVAILABLE', 422)
    expect(normalizeErrorMessage(byCode, 'zh')).toBe('无法连接 AI 服务商，请检查网络后重试。')
    expect(normalizeErrorMessage(byCode, 'en')).toBe("Couldn't reach the AI provider. Check your network and try again.")

    expect(normalizeErrorMessage(new Error('The AI provider could not be reached.'), 'zh'))
      .toBe('无法连接 AI 服务商，请检查网络后重试。')
  })

  it('explains that a local gateway failure is the Atlas server, not a slow network', () => {
    const error = new ApiError('The PhD Atlas server is unavailable.', 'SERVER_UNAVAILABLE', 502)

    expect(normalizeErrorMessage(error, 'zh')).toBe('PhD Atlas 服务器当前不可用。请确认完整服务已启动后重试。')
    expect(normalizeErrorMessage(error, 'en')).toBe(
      'The PhD Atlas server is unavailable. Make sure the full service is running, then try again.',
    )
  })

  it('uses specific localized copy for newer quota and mail-sync errors', () => {
    expect(normalizeErrorMessage(
      new ApiError('Team active share links cannot exceed 10000.', 'TEAM_SHARE_LIMIT_REACHED', 409),
      'zh',
    )).toBe('团队活跃分享链接已达到 10000 条上限，请联系系统管理员提高配额。')

    expect(normalizeErrorMessage(
      new ApiError('Incoming mail is not configured.', 'MAIL_FETCH_NOT_CONFIGURED', 400),
      'zh',
    )).toBe('尚未配置收件邮箱。')
  })

  it('has localized mappings for the server error-code catalog', () => {
    const codes = [
      'AI_ENRICHMENT_FAILED', 'AI_ENRICHMENT_INVALID', 'AI_KEY_REQUIRED', 'AI_RESEARCH_FAILED',
      'APPLICATION_REQUIRED', 'ATTACHMENT_NOT_FOUND', 'CORS_ORIGIN_DENIED', 'DISCOVER_CATALOG_EMPTY',
      'DISCOVER_PI_NOT_FOUND', 'DISCOVER_PROGRAM_NOT_FOUND', 'ENRICHMENT_APPLICATION_MISMATCH',
      'ENRICHMENT_PREVIEW_STALE', 'IMPERSONATION_FORBIDDEN', 'IMPERSONATION_TARGET_NOT_FOUND',
      'INVALID_ENCRYPTION_PASSWORD', 'MAIL_FETCH_EMPTY_SCOPE', 'MAIL_FETCH_NOT_CONFIGURED',
      'MAIL_FETCH_UNSUPPORTED_PROTOCOL', 'PRO_REQUIRED', 'SEAT_LIMIT_TOO_LOW', 'STORAGE_QUOTA_EXCEEDED',
      'TEACHER_NOT_FOUND', 'TEAM_ID_REQUIRED', 'TEAM_IMPERSONATION_SCOPE_REQUIRED', 'TEAM_MERGE_CONFLICT',
      'TEAM_REQUIRED', 'TEAM_SHARE_CREATE_LIMIT_REACHED', 'TEAM_SHARE_LIMIT_REACHED',
      'TEAM_STUDENT_FORBIDDEN', 'TEAM_STUDENT_NOT_FOUND', 'TEAM_STUDENT_REQUIRED',
      'TEAM_VISIBILITY_OWNER_REQUIRED', 'UNSAFE_ATTACHMENT', 'UNTRUSTED_HOST',
    ]

    for (const code of codes) {
      const localized = normalizeErrorMessage(
        new ApiError('Server diagnostic message 7.', code, 400),
        'zh',
      )
      expect(localized, `${code} fell back to the generic error-code message`).not.toContain(`错误码：${code}`)
    }
  })
})
