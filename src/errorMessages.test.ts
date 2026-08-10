import { describe, expect, it } from 'vitest'
import { ApiError } from './api/phdApi'
import { apiErrorKeyForCode, normalizeErrorMessage } from './errorMessages'
import { loadLanguage } from './i18n'

const supportedLanguages = ['en', 'zh', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'vi', 'th']
const phase18ErrorCodes = [
  'APPLICATION_DELTA_CANONICAL_MISMATCH',
  'APPLICATION_DURABILITY_UNVERIFIED',
  'APPLICATION_MUTATION_BASELINE_MISMATCH',
  'APPLICATION_VERSION_REQUIRED',
  'CODEX_DEVICE_AUTHORIZATION_CHANGED',
  'DATABASE_EXTERNAL_REVISION_STALE',
  'INTERVIEW_AI_ARTIFACT_SUPERSEDED',
  'INTERVIEW_AI_STALE_RESULT',
  'INTERVIEW_IDEMPOTENCY_CONFLICT',
  'INTERVIEW_IDEMPOTENCY_REPLAY_STALE',
  'INTERVIEW_REVISION_CONFLICT',
  'INTERVIEW_SAVE_NOT_ACKNOWLEDGED',
  'INVITE_STATE_CONFLICT',
  'STORE_WRITE_CONFLICT',
  'PUBLIC_GRANT_CONFLICT',
] as const
const phase18UnconfirmedSaveCodes = [
  'APPLICATION_DURABILITY_UNVERIFIED',
  'INTERVIEW_SAVE_NOT_ACKNOWLEDGED',
] as const

describe('normalizeErrorMessage', () => {
  it('localizes rate-limit API errors instead of showing the server English message', () => {
    const error = new ApiError('Too many requests. Please try again shortly.', 'RATE_LIMITED', 429)

    expect(normalizeErrorMessage(error, 'zh')).toBe('请求过于频繁，请稍后再试。')
  })

  it('localizes profile export safety limits without surfacing the server English text', () => {
    const error = new ApiError(
      'This profile document is too large or complex to export safely as one file.',
      'PROFILE_ASSET_EXPORT_TOO_LARGE',
      413,
    )

    expect(normalizeErrorMessage(error, 'zh')).toBe(
      '文档内容过大或结构过于复杂，无法安全导出为单个文件。请精简内容或结构后重试。',
    )
  })

  it('localizes proxy request-size rejections without suggesting a server restart', async () => {
    await Promise.all(supportedLanguages.map((language) => loadLanguage(language, ['shared'])))
    for (const language of supportedLanguages) {
      const localized = normalizeErrorMessage(
        new ApiError('The request body is too large.', 'REQUEST_TOO_LARGE', 413),
        language,
      )
      expect(localized, language).not.toContain('REQUEST_TOO_LARGE')
      expect(localized, language).not.toContain('Restart the PhD Atlas server')
      expect(localized.trim(), language).not.toBe('')
    }
    expect(normalizeErrorMessage(
      new ApiError('The request body is too large.', 'REQUEST_TOO_LARGE', 413),
      'zh',
    )).toBe('请求内容过大。请减小上传文件或请求内容后重试。')
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

  it('keeps provider throttling and corrupt streams out of the generic error fallback', () => {
    expect(normalizeErrorMessage(
      new ApiError('Provider rate limited.', 'PROVIDER_RATE_LIMITED', 429),
      'zh',
    )).toBe('请求过于频繁，请稍后再试。')
    expect(normalizeErrorMessage(
      new ApiError('Invalid provider stream.', 'PROVIDER_STREAM_INVALID', 502),
      'zh',
    )).toBe('AI 服务商未返回内容，请重试或更换模型。')
    expect(normalizeErrorMessage(
      new ApiError('Provider response too large.', 'PROVIDER_RESPONSE_TOO_LARGE', 502),
      'zh',
    )).toBe('AI 服务商未返回内容，请重试或更换模型。')
  })

  it('explains that a local gateway failure is the Atlas server, not a slow network', () => {
    const error = new ApiError('The PhD Atlas server is unavailable.', 'SERVER_UNAVAILABLE', 502)

    expect(normalizeErrorMessage(error, 'zh')).toBe('服务暂时不可用，或正在切换版本。请稍后重试；如果问题持续出现，请联系管理员，并在界面显示请求编号时一并提供。')
    expect(normalizeErrorMessage(error, 'en')).toBe(
      'The service is temporarily unavailable or switching versions. Please try again shortly. If the problem continues, contact your administrator and include the request ID if one is shown.',
    )
    expect(normalizeErrorMessage(
      new ApiError('Service unavailable.', 'SERVICE_UNAVAILABLE', 503),
      'zh',
    )).toBe('服务暂时不可用，或正在切换版本。请稍后重试；如果问题持续出现，请联系管理员，并在界面显示请求编号时一并提供。')
  })

  it('keeps concurrent-write conflicts actionable without claiming that the server is offline', () => {
    expect(normalizeErrorMessage(
      new ApiError('The stored data changed while this request was being saved.', 'STORE_WRITE_CONFLICT', 409),
      'zh',
    )).toBe('保存期间数据已发生变化。你的草稿仍然保留，请加载最新内容并合并改动后重试。')
    expect(normalizeErrorMessage(
      new ApiError('The stored data changed while this request was being saved.', 'STORE_WRITE_CONFLICT', 409),
      'en',
    )).toBe('This data changed while it was being saved. Your draft is still here; load the latest version, merge your changes, and try again.')

    expect(normalizeErrorMessage(
      new ApiError('The external database advanced while this request was being saved.', 'DATABASE_EXTERNAL_REVISION_STALE', 409),
      'zh',
    )).toBe('保存时外部数据库已有更新，本次写入未生效。请加载最新数据并合并改动后重试。')
    expect(normalizeErrorMessage(
      new ApiError('The external database advanced while this request was being saved.', 'DATABASE_EXTERNAL_REVISION_STALE', 409),
      'en',
    )).toBe('The external database advanced while this update was being saved, so this write was not applied. Load the latest data, merge your changes, and try again.')
  })

  it('localizes every durable application acknowledgement failure in all 12 languages', async () => {
    await Promise.all(supportedLanguages.map((language) => loadLanguage(language, ['shared'])))
    const cases = [
      ['APPLICATION_MUTATION_BASELINE_MISMATCH', 409],
      ['APPLICATION_MUTATION_PROJECTION_UNSUPPORTED', 409],
      ['APPLICATION_DURABILITY_UNVERIFIED', 409],
      ['APPLICATION_MUTATION_ACK_INVALID', 409],
      ['APPLICATION_MUTATION_ACK_TOO_LARGE', 413],
    ] as const

    for (const language of supportedLanguages) {
      for (const [code, status] of cases) {
        const localized = normalizeErrorMessage(
          new ApiError('Sensitive durable-write diagnostic.', code, status),
          language,
        )
        expect(localized, `${language}:${code}`).not.toContain('Sensitive durable-write diagnostic')
        expect(localized, `${language}:${code}`).not.toContain(code)
        expect(localized.trim(), `${language}:${code}`).not.toBe('')
      }
    }
  })

  it('localizes Discover capability and settings acknowledgement failures in all 12 languages', async () => {
    await Promise.all(supportedLanguages.map((language) => loadLanguage(language, ['shared'])))
    const cases = [
      ['DISCOVER_RESEARCH_UNSUPPORTED', 422],
      ['MEMORY_PRESSURE_HARD', 503],
      ['SETTINGS_ACKNOWLEDGEMENT_INVALID', 400],
      ['SETTINGS_PERSISTENCE_NOT_ACKNOWLEDGED', 500],
      ['UPDATE_GRACEFUL_SHUTDOWN_UNAVAILABLE', 503],
      ['UPDATE_HELPER_ALREADY_CLAIMED', 409],
      ['UPDATE_SAFE_SHUTDOWN_INVALID', 500],
      ['UPDATE_SAFE_SHUTDOWN_MISSING', 500],
    ] as const

    for (const language of supportedLanguages) {
      for (const [code, status] of cases) {
        const localized = normalizeErrorMessage(
          new ApiError('Sensitive persistence diagnostic.', code, status),
          language,
        )
        expect(localized, `${language}:${code}`).not.toContain('Sensitive persistence diagnostic')
        expect(localized, `${language}:${code}`).not.toContain(code)
        expect(localized.trim(), `${language}:${code}`).not.toBe('')
      }
    }
  })

  it('localizes structured capacity responses as retryable busy states', () => {
    for (const [code, status] of [
      ['SERVER_BUSY', 503],
      ['MEMORY_PRESSURE_HARD', 503],
      ['AUTH_CAPACITY_EXCEEDED', 429],
      ['AI_CAPACITY_EXCEEDED', 503],
      ['UPLOAD_VAULT_BUSY', 503],
      ['DATABASE_EXTERNAL_SYNC_QUARANTINED', 503],
      ['DATABASE_MAINTENANCE', 503],
      ['TEAM_PROFILE_RECOMMENDER_READ_BUSY', 503],
      ['TEAM_PROFILE_RECOMMENDER_VERSION_CHANGED', 409],
      ['TEAM_PROFILE_RECOMMENDER_VERSION_CONFLICT', 503],
    ] as const) {
      expect(normalizeErrorMessage(new ApiError('Capacity reached.', code, status), 'zh')).toBe(
        'PhD Atlas 正在处理较多更新。你的内容仍已保留，请稍候再试。',
      )
    }
  })

  it('keeps focused Team recommender storage diagnostics localized and private in all 12 languages', async () => {
    await Promise.all(supportedLanguages.map((language) => loadLanguage(language, ['shared'])))
    const cases = [
      ['TEAM_PROFILE_RECOMMENDER_DIRECTORY_INVALID', 500],
      ['TEAM_PROFILE_RECOMMENDER_DIRECTORY_OVERSIZED', 413],
      ['TEAM_PROFILE_RECOMMENDER_SETTINGS_INVALID', 500],
      ['TEAM_PROFILE_RECOMMENDER_TARGET_INVALID', 400],
      ['TEAM_PROFILE_RECOMMENDER_READ_BUSY', 503],
      ['TEAM_PROFILE_RECOMMENDER_VERSION_CHANGED', 409],
      ['TEAM_PROFILE_RECOMMENDER_VERSION_CONFLICT', 503],
    ] as const

    for (const language of supportedLanguages) {
      for (const [code, status] of cases) {
        const localized = normalizeErrorMessage(
          new ApiError('Sensitive focused-storage diagnostic.', code, status),
          language,
        )
        expect(localized, `${language}:${code}`).not.toContain('Sensitive focused-storage diagnostic')
        expect(localized, `${language}:${code}`).not.toContain(code)
        expect(localized.trim(), `${language}:${code}`).not.toBe('')
      }
    }
  })

  it('reports an AI deadline as a request timeout instead of a server outage', () => {
    expect(normalizeErrorMessage(
      new ApiError('The AI request exceeded its deadline.', 'AI_REQUEST_TIMEOUT', 504),
      'zh',
    )).toBe('请求等待时间过长，请重试。')
    expect(normalizeErrorMessage(
      new ApiError('The request body arrived too slowly.', 'REQUEST_BODY_TIMEOUT', 408),
      'zh',
    )).toBe('请求等待时间过长，请重试。')
  })

  it('localizes setup claims, version preconditions, and mail usage diagnostics', () => {
    for (const code of ['BOOTSTRAP_CLAIM_REQUIRED', 'BOOTSTRAP_CLAIM_INVALID']) {
      expect(normalizeErrorMessage(new ApiError('Bootstrap claim rejected.', code, 401), 'zh')).toBe(
        '初始化访问权限无效或已过期。已保留全部填写内容，请重新认领。',
      )
    }

    expect(normalizeErrorMessage(
      new ApiError('Application version is required.', 'APPLICATION_VERSION_REQUIRED', 428),
      'zh',
    )).toBe('本次保存缺少必要的申请版本信息，无法安全写入。你的草稿仍然保留，请重新保存；如果持续失败，请重新打开该申请。')
    expect(normalizeErrorMessage(
      new ApiError('Usage accounting failed.', 'MAIL_CLASSIFICATION_USAGE_RECORD_FAILED', 500),
      'zh',
    )).toBe('请求失败，请重试。')
  })

  it('does not collapse the 15 Phase 18 error codes into one i18n key', () => {
    const keys = phase18ErrorCodes.map(apiErrorKeyForCode)

    expect(keys.every(Boolean)).toBe(true)
    expect(new Set(keys).size).toBe(phase18ErrorCodes.length)
    for (const code of phase18ErrorCodes) {
      expect(apiErrorKeyForCode(code), code).toBe(`apiErrors.${code}`)
    }
  })

  it('provides Phase 18 error keys in all 12 languages and never suggests refresh for unconfirmed saves', async () => {
    for (const language of supportedLanguages) {
      const dict = await loadLanguage(language, ['shared'])
      const apiErrors = (dict as { apiErrors?: Record<string, unknown> }).apiErrors

      for (const code of phase18ErrorCodes) {
        expect(apiErrors?.[code], `${language}:${code}`).toBeTypeOf('string')
        const localized = normalizeErrorMessage(
          new ApiError('Sensitive Phase 18 diagnostic.', code, 409),
          language,
        )
        expect(localized, `${language}:${code}`).not.toContain('apiErrors.')
        expect(localized.trim(), `${language}:${code}`).not.toBe('')
      }

      for (const code of phase18UnconfirmedSaveCodes) {
        const localized = normalizeErrorMessage(
          new ApiError('Sensitive Phase 18 save diagnostic.', code, code === 'INTERVIEW_SAVE_NOT_ACKNOWLEDGED' ? 503 : 409),
          language,
        )
        expect(localized.toLowerCase(), `${language}:${code}`).not.toContain('refresh')
        expect(localized, `${language}:${code}`).not.toContain('刷新')
      }
    }
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

  it('explains read-only temporary access and Team-context selection errors', () => {
    expect(normalizeErrorMessage(
      new ApiError('Temporary account access is read-only.', 'IMPERSONATION_READ_ONLY', 403),
      'zh',
    )).toBe('当前临时账号视角为只读。请返回自己的账号后再修改。')
    expect(normalizeErrorMessage(
      new ApiError('Temporary account access is read-only.', 'IMPERSONATION_READ_ONLY', 403),
      'en',
    )).toBe('This temporary account view is read-only. Return to your own account to make changes.')

    expect(normalizeErrorMessage(
      new ApiError('Select a Team for this application.', 'TEAM_CONTEXT_AMBIGUOUS', 409),
      'zh',
    )).toBe('有多个可用的团队工作区，请选择团队后重试。')
    expect(normalizeErrorMessage(
      new ApiError('The Team context is invalid.', 'TEAM_CONTEXT_INVALID', 400),
      'zh',
    )).toBe('所选团队工作区无法用于此操作。')
  })

  it('has localized mappings for the server error-code catalog', () => {
    const codes = [
      'ABORT_ERR', 'AI_ENRICHMENT_FAILED', 'AI_ENRICHMENT_INVALID', 'AI_KEY_REQUIRED', 'AI_RESEARCH_FAILED',
      'APPLICATION_REQUIRED', 'ATTACHMENT_NOT_FOUND', 'CORS_ORIGIN_DENIED', 'DISCOVER_CATALOG_EMPTY',
      'DISCOVER_PI_NOT_FOUND', 'DISCOVER_PROGRAM_NOT_FOUND', 'ENRICHMENT_APPLICATION_MISMATCH',
      'ENRICHMENT_PREVIEW_STALE', 'IMPERSONATION_FORBIDDEN', 'IMPERSONATION_READ_ONLY',
      'IMPERSONATION_TARGET_NOT_FOUND',
      'INVALID_ENCRYPTION_PASSWORD', 'MAIL_FETCH_EMPTY_SCOPE', 'MAIL_FETCH_NOT_CONFIGURED',
      'MAIL_FETCH_UNSUPPORTED_PROTOCOL', 'PRO_REQUIRED', 'SEAT_LIMIT_TOO_LOW', 'STORAGE_QUOTA_EXCEEDED',
      'TEACHER_NOT_FOUND', 'TEAM_CONTEXT_AMBIGUOUS', 'TEAM_CONTEXT_INVALID', 'TEAM_ID_REQUIRED',
      'TEAM_IMPERSONATION_SCOPE_REQUIRED', 'TEAM_MERGE_CONFLICT',
      'TEAM_REQUIRED', 'TEAM_SHARE_CREATE_LIMIT_REACHED', 'TEAM_SHARE_LIMIT_REACHED',
      'TEAM_STUDENT_FORBIDDEN', 'TEAM_STUDENT_NOT_FOUND', 'TEAM_STUDENT_REQUIRED',
      'TEAM_VISIBILITY_OWNER_REQUIRED', 'UNSAFE_ATTACHMENT', 'UNTRUSTED_HOST',
      'UPDATE_GRACEFUL_SHUTDOWN_UNAVAILABLE', 'UPDATE_SAFE_SHUTDOWN_INVALID',
      'UPDATE_SAFE_SHUTDOWN_MISSING', 'UPDATE_LOCK_EXPECTED_REQUIRED',
    ]

    for (const code of codes) {
      const localized = normalizeErrorMessage(
        new ApiError('Server diagnostic message 7.', code, 400),
        'zh',
      )
      expect(localized, `${code} fell back to the generic error-code message`).not.toContain(`错误码：${code}`)
    }
  })

  it('keeps Codex authorization failures localized without exposing server diagnostics', () => {
    const codes = [
      'CODEX_ALLOWED', 'CODEX_AUTHORIZATION_INVALID', 'CODEX_AUTHORIZATION_REQUIRED',
      'CODEX_AUTHORIZATION_AUTH_VERSION_CHANGED', 'CODEX_AUTHORIZATION_LIMIT',
      'CODEX_AUTHORIZATION_DURATION_EXPANSION_REQUIRES_APPROVAL',
      'CODEX_AUTHORIZATION_EXTENSION_REQUIRES_APPROVAL',
      'CODEX_AUTHORIZATION_USER_DISABLED', 'CODEX_AUTHORIZATION_USER_NOT_FOUND',
      'CODEX_DEVICE_AUTHORIZATION_CAPACITY', 'CODEX_DEVICE_AUTHORIZATION_CHANGED',
      'CODEX_DEVICE_AUTHORIZATION_DENIAL_FORBIDDEN', 'CODEX_DEVICE_AUTHORIZATION_OWNER_MISMATCH',
      'CODEX_REQUEST_INVALID', 'CODEX_ROUTE_CLASSIFIED', 'CODEX_ROUTE_FORBIDDEN', 'CODEX_ROUTE_UNMAPPED',
      'CODEX_AUTHORIZATION_REAUTHORIZATION_REQUIRED',
      'CODEX_SCOPE_EXPANSION_REQUIRES_APPROVAL', 'CODEX_SCOPE_INVALID', 'CODEX_SCOPE_REQUIRED',
      'CODEX_SCOPE_VERSION_UNSUPPORTED', 'CODEX_SETTINGS_BODY_INVALID',
      'CODEX_SETTINGS_FIELD_FORBIDDEN', 'CODEX_TEAM_INVITE_FORBIDDEN',
      'INTERACTIVE_SESSION_REQUIRED', 'INVALID_CODEX_AUTHORIZATION_EXPIRY',
      'INVALID_CODEX_AUTHORIZATION_MATERIAL', 'INVALID_CODEX_AUTHORIZATION_SCOPES',
      'INVALID_CODEX_AUTHORIZATION_TIME', 'INVALID_CODEX_AUTHORIZATION_USER',
      'INVALID_CODEX_AUTH_VERSION', 'INVALID_CODEX_DEVICE_POLL_INTERVAL',
      'INVALID_CODEX_SCOPE_VERSION',
    ]

    for (const code of codes) {
      const localized = normalizeErrorMessage(
        new ApiError('Sensitive Codex server diagnostic.', code, 400),
        'zh',
      )
      expect(localized, `${code} fell back to the generic error-code message`).not.toContain(`错误码：${code}`)
      expect(localized).not.toContain('Sensitive Codex server diagnostic')
    }
  })
})

describe('validation field names', () => {
  it('names a nested application field in every language instead of echoing the path', async () => {
    for (const lang of supportedLanguages) {
      await loadLanguage(lang as 'en')
      const localized = normalizeErrorMessage(
        new ApiError('Invalid url', 'VALIDATION_ERROR', 400, 'professor.labUrl'),
        lang as 'en',
      )
      expect(localized, `${lang} leaked the raw field path`).not.toContain('labUrl')
      expect(localized, `${lang} leaked the raw field path`).not.toContain('professor / ')
    }
  })

  it('localizes camel-case create fields instead of exposing the API property name', async () => {
    await loadLanguage('zh', ['shared'])
    expect(normalizeErrorMessage(
      new ApiError('Invalid url', 'VALIDATION_ERROR', 400, 'professorHomepage'),
      'zh',
    )).toBe('请检查导师主页后再试。')

    for (const lang of supportedLanguages) {
      await loadLanguage(lang, ['shared'])
      const localized = normalizeErrorMessage(
        new ApiError('Invalid url', 'VALIDATION_ERROR', 400, 'professorHomepage'),
        lang as 'en',
      )
      expect(localized, `${lang} leaked the raw create field name`).not.toContain('professorHomepage')
      expect(localized, `${lang} leaked the split field path`).not.toContain('professor / ')
    }
  })

  it('falls back to the most specific translated segment of an unmapped path', async () => {
    await loadLanguage('zh')
    const localized = normalizeErrorMessage(
      new ApiError('Invalid url', 'VALIDATION_ERROR', 400, 'materials.3.notes'),
      'zh',
    )
    expect(localized).toContain('备注')
    expect(localized).not.toContain('materials')
  })
})
