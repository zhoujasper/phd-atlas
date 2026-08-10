import { createHash, createHmac } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import {
  CODEX_AUTHORIZATION_DENIED_PREFIXES,
  CODEX_AUTHORIZATION_EXPIRY_DAYS,
  CODEX_AUTHORIZATION_SCOPES,
  CODEX_AUTHORIZATION_SCOPE_VERSION,
  CODEX_AUTHORIZATION_TOKEN_PREFIX,
  CODEX_CAPABILITIES_SCHEMA_VERSION,
  CODEX_INTERVIEW_PREP_ROUTE_POLICY,
  CODEX_SETTINGS_WRITE_FIELDS,
  authorizeCodexRequest,
  classifyCodexAuthorizationRequest,
  codexAuthorizationExpiresAt,
  codexCapabilitiesForScopes,
  codexPersonalAccessTokenHint,
  createCodexDeviceAuthorization,
  createCodexDeviceCode,
  createCodexPersonalAccessToken,
  createCodexUserCode,
  formatCodexUserCode,
  hashCodexDeviceCode,
  hashCodexPersonalAccessToken,
  hashCodexUserCode,
  isCodexPersonalAccessToken,
  normalizeCodexAuthorizationExpiryDays,
  normalizeCodexAuthorizationScopes,
  normalizeCodexUserCode,
  parseCodexPersonalAccessToken,
  verifyCodexPersonalAccessToken,
} from './codexAuthorization.js'
import { installInterviewPrepApiRoutes } from './interviewPrepApi.js'

describe('Codex personal access tokens', () => {
  it('creates the exact versioned PAT shape and stores only a SHA-256 digest', () => {
    const selectorBytes = Buffer.from([...Array(12).keys()])
    const secretBytes = Buffer.from([...Array(32).keys()])
    const created = createCodexPersonalAccessToken({ selectorBytes, secretBytes })
    const parsed = parseCodexPersonalAccessToken(created.token)

    expect(created.token).toBe(
      `${CODEX_AUTHORIZATION_TOKEN_PREFIX}_${selectorBytes.toString('base64url')}_${secretBytes.toString('base64url')}`,
    )
    expect(parsed).toEqual({
      token: created.token,
      selector: selectorBytes.toString('base64url'),
      secret: secretBytes.toString('base64url'),
    })
    expect(created.tokenHash).toBe(createHash('sha256').update(created.token).digest('hex'))
    expect(created).toMatchObject({
      selector: parsed.selector,
      hint: `${CODEX_AUTHORIZATION_TOKEN_PREFIX}_${parsed.selector}_…${parsed.secret.slice(-4)}`,
    })
    expect(created.hint).not.toContain(parsed.secret)
    expect(codexPersonalAccessTokenHint(created.token)).toBe(created.hint)
    expect(hashCodexPersonalAccessToken(created.token)).toBe(created.tokenHash)
    expect(isCodexPersonalAccessToken(created.token)).toBe(true)
  })

  it('uses 256 bits of random secret material and produces independent tokens', () => {
    const first = createCodexPersonalAccessToken()
    const second = createCodexPersonalAccessToken()
    expect(first.token).not.toBe(second.token)
    expect(Buffer.from(parseCodexPersonalAccessToken(first.token).secret, 'base64url')).toHaveLength(32)
    expect(Buffer.from(parseCodexPersonalAccessToken(first.token).selector, 'base64url')).toHaveLength(12)
  })

  it('verifies the hash and selector without accepting malformed material', () => {
    const created = createCodexPersonalAccessToken()
    const other = createCodexPersonalAccessToken()

    expect(verifyCodexPersonalAccessToken(created.token, created)).toBe(true)
    expect(verifyCodexPersonalAccessToken(created.token, created.tokenHash)).toBe(true)
    expect(verifyCodexPersonalAccessToken(other.token, created)).toBe(false)
    expect(verifyCodexPersonalAccessToken(created.token, { ...created, selector: other.selector })).toBe(false)
    expect(verifyCodexPersonalAccessToken(created.token, { ...created, tokenHash: 'not-a-digest' })).toBe(false)
    expect(verifyCodexPersonalAccessToken('phda_cdx_v1_bad', created)).toBe(false)
    expect(parseCodexPersonalAccessToken(`${created.token}x`)).toBeNull()
    expect(codexPersonalAccessTokenHint('not-a-token')).toBeNull()
    expect(() => hashCodexPersonalAccessToken('not-a-token')).toThrow(/invalid/i)
  })

  it('rejects injected entropy with the wrong length', () => {
    expect(() => createCodexPersonalAccessToken({ selectorBytes: Buffer.alloc(11) })).toThrow(/12 bytes/)
    expect(() => createCodexPersonalAccessToken({ secretBytes: Buffer.alloc(31) })).toThrow(/32 bytes/)
  })
})

describe('Codex device authorization codes', () => {
  it('encodes exactly 40 bits as an eight-character Crockford code', () => {
    expect(createCodexUserCode({ bytes: Buffer.alloc(5) })).toBe('0000-0000')
    expect(createCodexUserCode({ bytes: Buffer.alloc(5, 0xff) })).toBe('ZZZZ-ZZZZ')
    expect(normalizeCodexUserCode(' oooo-il1l ')).toBe('00001111')
    expect(formatCodexUserCode('oooo il1l')).toBe('0000-1111')
    expect(normalizeCodexUserCode('ABCU-EFGH')).toBeNull()
    expect(normalizeCodexUserCode('TOO-SHOR')).toBeNull()
  })

  it('requires a server secret and hashes normalized user codes with HMAC-SHA-256', () => {
    const normalized = '00001111'
    expect(hashCodexUserCode('OOOO-IL1L', 'server-secret')).toBe(
      createHmac('sha256', 'server-secret').update(normalized).digest('hex'),
    )
    expect(() => hashCodexUserCode('OOOO-IL1L')).toThrow(/hmac secret/i)
    expect(() => hashCodexUserCode('OOOO-IL1L', '')).toThrow(/hmac secret/i)
    expect(() => hashCodexUserCode('bad', 'server-secret')).toThrow(/invalid/i)
  })

  it('creates and hashes a 256-bit opaque device code', () => {
    const bytes = Buffer.from([...Array(32).keys()])
    const deviceCode = createCodexDeviceCode({ bytes })
    expect(deviceCode).toBe(bytes.toString('base64url'))
    expect(Buffer.from(deviceCode, 'base64url')).toHaveLength(32)
    expect(hashCodexDeviceCode(deviceCode)).toBe(
      createHash('sha256').update(deviceCode).digest('hex'),
    )
    expect(() => hashCodexDeviceCode('short')).toThrow(/invalid/i)
  })

  it('builds the complete hash-only persistence envelope', () => {
    const created = createCodexDeviceAuthorization({
      deviceCodeBytes: Buffer.alloc(32, 7),
      userCodeBytes: Buffer.alloc(5, 9),
      userCodeHashSecret: 'server-secret',
    })
    expect(created.deviceCodeHash).toBe(hashCodexDeviceCode(created.deviceCode))
    expect(created.userCodeHash).toBe(hashCodexUserCode(created.userCode, 'server-secret'))
    expect(created.deviceCodeHash).not.toContain(created.deviceCode)
    expect(created.userCodeHash).not.toContain(normalizeCodexUserCode(created.userCode))
    expect(() => createCodexDeviceAuthorization({
      deviceCodeBytes: Buffer.alloc(32, 7),
      userCodeBytes: Buffer.alloc(5, 9),
    })).toThrow(/hmac secret/i)
  })
})

describe('Codex scope and expiry contracts', () => {
  it('accepts only the four finite authorization lifetimes', () => {
    expect(CODEX_AUTHORIZATION_EXPIRY_DAYS).toEqual([30, 90, 180, 365])
    expect(normalizeCodexAuthorizationExpiryDays()).toBe(365)
    for (const days of CODEX_AUTHORIZATION_EXPIRY_DAYS) {
      expect(normalizeCodexAuthorizationExpiryDays(days)).toBe(days)
    }
    expect(() => normalizeCodexAuthorizationExpiryDays(0)).toThrow(/one of/i)
    expect(() => normalizeCodexAuthorizationExpiryDays(366)).toThrow(/one of/i)
  })

  it('calculates a deterministic absolute expiry', () => {
    expect(codexAuthorizationExpiresAt(30, new Date('2026-08-02T00:00:00.000Z')))
      .toBe('2026-09-01T00:00:00.000Z')
    expect(() => codexAuthorizationExpiresAt(30, Number.NaN)).toThrow(/start time/i)
  })

  it('deduplicates and canonically orders only known version-two scopes', () => {
    expect(CODEX_AUTHORIZATION_SCOPE_VERSION).toBe(2)
    expect(CODEX_AUTHORIZATION_SCOPES).toEqual([
      'applications:read',
      'applications:write',
      'profile:read',
      'profile:write',
      'files:read',
      'files:write',
      'communications:read',
      'communications:send',
      'discover:read',
      'discover:write',
      'notifications:read',
      'notifications:write',
      'settings:read',
      'settings:write',
      'ai:read',
      'ai:use',
      'ai:manage',
      'exports:read',
      'backups:manage',
      'analytics:read',
      'shares:manage',
      'mail:manage',
      'interview:read',
      'interview:write',
      'interview:use',
    ])
    expect(normalizeCodexAuthorizationScopes([
      'AI:MANAGE',
      ' applications:read ',
      'ai:manage',
      'profile:write',
    ])).toEqual(['applications:read', 'profile:write', 'ai:manage'])
    expect(() => normalizeCodexAuthorizationScopes(['*'])).toThrow(/unsupported/i)
    expect(() => normalizeCodexAuthorizationScopes(['all'])).toThrow(/unsupported/i)
    expect(() => normalizeCodexAuthorizationScopes([], { allowEmpty: false })).toThrow(/at least one/i)
    expect(new Set(CODEX_AUTHORIZATION_SCOPES).size).toBe(CODEX_AUTHORIZATION_SCOPES.length)
  })

  it('generates a stable capabilities document without wildcard escalation', () => {
    expect(CODEX_CAPABILITIES_SCHEMA_VERSION).toBe(2)
    const payload = codexCapabilitiesForScopes({
      id: 'grant-1',
      name: 'Jasper laptop',
      scopes: [
        'applications:read',
        'shares:manage',
        'ai:manage',
        'ai:use',
        'interview:read',
        'interview:write',
        'interview:use',
      ],
      createdAt: '2026-08-01T00:00:00.000Z',
      lastUsedAt: null,
      expiresAt: '2027-08-01T00:00:00.000Z',
    })
    expect(Object.keys(payload)).toEqual([
      'schemaVersion',
      'scopeVersion',
      'credential',
      'routePrefixes',
      'deniedPrefixes',
    ])
    expect(payload).toMatchObject({
      schemaVersion: CODEX_CAPABILITIES_SCHEMA_VERSION,
      scopeVersion: CODEX_AUTHORIZATION_SCOPE_VERSION,
      credential: {
        id: 'grant-1',
        name: 'Jasper laptop',
        grantedScopes: [
          'applications:read',
          'ai:use',
          'ai:manage',
          'shares:manage',
          'interview:read',
          'interview:write',
          'interview:use',
        ],
        createdAt: '2026-08-01T00:00:00.000Z',
        lastUsedAt: null,
        expiresAt: '2027-08-01T00:00:00.000Z',
      },
      deniedPrefixes: CODEX_AUTHORIZATION_DENIED_PREFIXES,
    })
    expect(payload.deniedPrefixes).toEqual(expect.arrayContaining([
      '/api/workspace',
    ]))
    expect(payload.deniedPrefixes).not.toContain('/api/interview-prep')
    expect(payload.routePrefixes).toEqual(expect.arrayContaining(
      CODEX_INTERVIEW_PREP_ROUTE_POLICY.map(({ method, path, requiredScopes }) => ({
        prefix: path,
        methods: [method],
        requiredScopes,
        conditionalRequiredScopes: [],
      })),
    ))
    expect(payload.routePrefixes).toContainEqual({
      prefix: '/api/applications',
      methods: ['GET'],
      requiredScopes: ['applications:read'],
      conditionalRequiredScopes: [],
    })
    expect(payload.routePrefixes).not.toContainEqual(expect.objectContaining({
      prefix: '/api/applications/:applicationId/share',
    }))
    expect(payload.routePrefixes.every(({ requiredScopes }) => (
      requiredScopes.every((scope) => payload.credential.grantedScopes.includes(scope))
    ))).toBe(true)
  })

  it('advertises body-dependent scopes without over-scoping plain communication sends', () => {
    const payload = codexCapabilitiesForScopes([
      'applications:read',
      'communications:send',
    ])
    const send = payload.routePrefixes.find(({ prefix, methods }) => (
      prefix === '/api/applications/:applicationId/communications/send'
      && methods.includes('POST')
    ))

    expect(payload.credential.grantedScopes).not.toContain('files:read')
    expect(send).toEqual({
      prefix: '/api/applications/:applicationId/communications/send',
      methods: ['POST'],
      requiredScopes: ['applications:read', 'communications:send'],
      conditionalRequiredScopes: [{
        source: 'json-body',
        path: ['attachments', '*', 'fileId'],
        operator: 'non-empty-string',
        requiredScopes: ['files:read'],
      }],
    })
  })
})

describe('Codex default-deny request classifier', () => {
  it.each([
    '/api/auth/me',
    '/api/admin/users',
    '/api/admin-access/status',
    '/api/setup/status',
    '/api/account',
    '/api/share/public-token',
    '/api/asset-upload/public-token',
    '/api/teams/invites/public-token',
    '/api/teams/join-codes/code',
    '/api/calendar/feed',
    '/api/events',
    '/api/codex/device/start',
    '/api/codex/authorizations',
  ])('permanently denies %s', (path) => {
    expect(classifyCodexAuthorizationRequest({ method: 'GET', path })).toMatchObject({
      kind: 'deny',
      allowed: false,
    })
  })

  it('normalizes harmless casing/query/trailing slash but rejects encoded path confusion', () => {
    expect(classifyCodexAuthorizationRequest({ method: 'get', path: '/API/AUTH/ME/?x=1' }).code)
      .toBe('CODEX_ROUTE_FORBIDDEN')
    expect(classifyCodexAuthorizationRequest({ method: 'GET', path: '/%61pi/auth/me' }).code)
      .toBe('CODEX_ROUTE_FORBIDDEN')
    expect(classifyCodexAuthorizationRequest({ method: 'GET', path: '/api%2fauth/me' }).code)
      .toBe('CODEX_REQUEST_INVALID')
    expect(classifyCodexAuthorizationRequest({ method: 'TRACE', path: '/api/applications' }).code)
      .toBe('CODEX_REQUEST_INVALID')
  })

  it('allows only current-credential self-service plus scoped safe settings read', () => {
    expect(authorizeCodexRequest({ method: 'GET', path: '/api/codex/whoami', scopes: [] }))
      .toMatchObject({ allowed: true, capability: 'codex.self.read', requiredScopes: [] })
    expect(authorizeCodexRequest({ method: 'GET', path: '/api/codex/capabilities', scopes: [] }))
      .toMatchObject({ allowed: true, capability: 'codex.capabilities.read', requiredScopes: [] })
    expect(authorizeCodexRequest({ method: 'DELETE', path: '/api/codex/authorizations/current', scopes: [] }))
      .toMatchObject({ allowed: true, capability: 'codex.authorization.revoke_current', requiredScopes: [] })
    expect(authorizeCodexRequest({
      method: 'GET',
      path: '/api/codex/settings',
      scopes: ['settings:read'],
    })).toMatchObject({
      allowed: true,
      capability: 'settings.read',
      responsePolicy: 'codex-safe-settings',
    })
    expect(authorizeCodexRequest({ method: 'GET', path: '/api/codex/settings', scopes: [] }))
      .toMatchObject({ allowed: false, missingScopes: ['settings:read'] })
    expect(classifyCodexAuthorizationRequest({ method: 'GET', path: '/api/codex/authorizations/current' }).allowed)
      .toBe(false)
    expect(classifyCodexAuthorizationRequest({ method: 'POST', path: '/api/codex/whoami' }).allowed)
      .toBe(false)
  })

  it('denies unknown routes and unsupported method/path combinations', () => {
    expect(classifyCodexAuthorizationRequest({ method: 'GET', path: '/api/future-feature' }).code)
      .toBe('CODEX_ROUTE_UNMAPPED')
    expect(classifyCodexAuthorizationRequest({ method: 'POST', path: '/api/analytics' }).code)
      .toBe('CODEX_ROUTE_UNMAPPED')
    expect(classifyCodexAuthorizationRequest({ method: 'GET', path: '/api/applications/id/future-action' }).code)
      .toBe('CODEX_ROUTE_UNMAPPED')
  })

  it('classifies every Interview Prep route with exact read/write/AI scopes', () => {
    expect(classifyCodexAuthorizationRequest({
      method: 'GET',
      path: '/api/workspace/bootstrap/stream?sections=applications',
    })).toMatchObject({
      kind: 'deny',
      code: 'CODEX_WORKSPACE_BOOTSTRAP_FORBIDDEN',
    })
    expect(classifyCodexAuthorizationRequest({
      method: 'GET',
      path: '/api/interview-prep/workspace?subjectUserId=user-1',
    })).toMatchObject({
      allowed: true,
      capability: 'interview.read',
      requiredScopes: ['interview:read'],
    })
    expect(classifyCodexAuthorizationRequest({
      method: 'POST',
      path: '/api/interview-prep/ai/questions',
    })).toMatchObject({
      allowed: true,
      capability: 'interview.ai',
      requiredScopes: ['interview:use', 'ai:use'],
    })
    expect(classifyCodexAuthorizationRequest({
      method: 'POST',
      path: '/api/interview-prep/ai/unknown',
    })).toMatchObject({
      kind: 'deny',
      code: 'CODEX_ROUTE_UNMAPPED',
    })
    expect(authorizeCodexRequest({
      method: 'PUT',
      path: '/api/interview-prep/workspace',
      scopes: [],
    })).toMatchObject({
      allowed: false,
      code: 'CODEX_SCOPE_REQUIRED',
      missingScopes: ['interview:write'],
    })
    expect(authorizeCodexRequest({
      method: 'POST',
      path: '/api/interview-prep/ai/feedback',
      scopes: ['interview:use'],
    })).toMatchObject({
      allowed: false,
      missingScopes: ['ai:use'],
    })
  })

  it('keeps Interview Prep route registration synchronized with Codex policy', () => {
    const routes = []
    const app = {
      get: (path, handler) => routes.push({ method: 'GET', path, handler }),
      put: (path, handler) => routes.push({ method: 'PUT', path, handler }),
      post: (path, handler) => routes.push({ method: 'POST', path, handler }),
    }
    installInterviewPrepApiRoutes(app, {
      controller: {
        getWorkspace: () => undefined,
        saveWorkspace: () => undefined,
        generateQuestions: () => undefined,
        generateNextMockTurn: () => undefined,
        generateFeedback: () => undefined,
      },
    })
    expect(routes.map(({ method, path }) => ({ method, path }))).toEqual(
      CODEX_INTERVIEW_PREP_ROUTE_POLICY.map(({ method, path }) => ({ method, path })),
    )
  })
})

describe('Codex business-route scope policy', () => {
  it('separates application reads and writes and accepts HEAD as read-only', () => {
    expect(authorizeCodexRequest({ method: 'GET', path: '/api/applications', scopes: ['applications:read'] }))
      .toMatchObject({ allowed: true, capability: 'applications.read' })
    expect(authorizeCodexRequest({ method: 'HEAD', path: '/api/applications/a1', scopes: ['applications:read'] }))
      .toMatchObject({ allowed: true, method: 'GET', capability: 'applications.read' })
    expect(authorizeCodexRequest({ method: 'POST', path: '/api/applications', scopes: ['applications:read'] }))
      .toMatchObject({ allowed: false, missingScopes: ['applications:write'] })
  })

  it('keeps communication, explicit file and share side effects independently scoped', () => {
    const manualCategoryCapabilities = codexCapabilitiesForScopes([
      'applications:write',
      'communications:read',
    ])
    expect(manualCategoryCapabilities.routePrefixes).toContainEqual(expect.objectContaining({
      prefix: '/api/applications/:applicationId/communications/categories',
      methods: ['PATCH'],
      requiredScopes: ['applications:write', 'communications:read'],
    }))
    expect(manualCategoryCapabilities.routePrefixes).not.toContainEqual(expect.objectContaining({
      prefix: '/api/applications/:applicationId/communications/classify',
    }))
    expect(codexCapabilitiesForScopes([
      'applications:write',
      'communications:read',
      'ai:use',
    ]).routePrefixes).toContainEqual(expect.objectContaining({
      prefix: '/api/applications/:applicationId/communications/classify',
      methods: ['POST'],
      requiredScopes: ['applications:write', 'communications:read', 'ai:use'],
    }))
    const send = authorizeCodexRequest({
      method: 'POST',
      path: '/api/applications/a1/communications/send',
      scopes: ['applications:read', 'communications:send'],
    })
    expect(send).toMatchObject({
      allowed: true,
      capability: 'communications.send',
      missingScopes: [],
    })
    expect(authorizeCodexRequest({
      method: 'GET',
      path: '/api/applications/a1/review-comments/threaded',
      scopes: ['applications:read', 'communications:read'],
    })).toMatchObject({ allowed: true, capability: 'communications.read' })
    expect(authorizeCodexRequest({
      method: 'POST',
      path: '/api/applications/a1/communications',
      scopes: ['applications:write', 'communications:read'],
    })).toMatchObject({ allowed: false, missingScopes: ['communications:send'] })
    expect(authorizeCodexRequest({
      method: 'POST',
      path: '/api/applications/a1/request-feedback',
      scopes: ['applications:read', 'communications:send'],
    })).toMatchObject({ allowed: true, capability: 'communications.send' })
    expect(authorizeCodexRequest({
      method: 'POST',
      path: '/api/applications/a1/review-comments',
      scopes: ['applications:read', 'communications:send'],
    })).toMatchObject({ allowed: true, capability: 'communications.send' })
    expect(authorizeCodexRequest({
      method: 'POST',
      path: '/api/applications/a1/communications/classify',
      scopes: ['applications:write', 'communications:read'],
    })).toMatchObject({ allowed: false, missingScopes: ['ai:use'] })
    expect(authorizeCodexRequest({
      method: 'POST',
      path: '/api/applications/a1/communications/classify',
      scopes: ['applications:write', 'communications:read', 'ai:use'],
    })).toMatchObject({ allowed: true, capability: 'communications.classify' })
    expect(authorizeCodexRequest({
      method: 'PATCH',
      path: '/api/applications/a1/communications/categories',
      scopes: ['applications:write', 'communications:read'],
    })).toMatchObject({ allowed: true, capability: 'communications.categories.write' })
    expect(authorizeCodexRequest({
      method: 'PATCH',
      path: '/api/applications/a1/communications/categories',
      scopes: ['applications:write', 'communications:send'],
    })).toMatchObject({ allowed: false, missingScopes: ['communications:read'] })
    for (const [method, path] of [
      ['POST', '/api/applications/a1/communications'],
      ['PATCH', '/api/applications/a1/communications/c1'],
    ]) {
      expect(classifyCodexAuthorizationRequest({
        method,
        path,
        body: { mailCategoryOverride: 'interview_invite' },
      })).toMatchObject({
        allowed: false,
        code: 'CODEX_COMMUNICATION_CLASSIFICATION_ROUTE_REQUIRED',
      })
      expect(classifyCodexAuthorizationRequest({
        method,
        path,
        body: { mailClassification: { category: 'interview_invite' } },
      })).toMatchObject({
        allowed: false,
        code: 'CODEX_COMMUNICATION_CLASSIFICATION_ROUTE_REQUIRED',
      })
    }

    expect(authorizeCodexRequest({
      method: 'POST',
      path: '/api/applications/a1/materials',
      scopes: ['applications:write'],
    })).toMatchObject({ allowed: false, missingScopes: ['files:write'] })
    expect(authorizeCodexRequest({
      method: 'POST',
      path: '/api/applications/a1/materials',
      scopes: ['applications:write', 'files:write'],
    })).toMatchObject({ allowed: true, capability: 'files.write' })
    expect(authorizeCodexRequest({
      method: 'POST',
      path: '/api/applications/a1/materials/m1/file',
      scopes: ['applications:write'],
    })).toMatchObject({ allowed: false, missingScopes: ['files:write'] })
    expect(authorizeCodexRequest({
      method: 'PATCH',
      path: '/api/applications/a1/materials/m1/files/f1',
      scopes: ['applications:write', 'files:write'],
    })).toMatchObject({ allowed: true, capability: 'files.write' })

    const fileCapabilities = codexCapabilitiesForScopes(['applications:write', 'files:write'])
    expect(fileCapabilities.routePrefixes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        prefix: '/api/applications/:applicationId/materials/:materialId/files/:fileId',
      }),
      expect.objectContaining({
        prefix: '/api/applications/:applicationId/tasks/:taskId/files/:fileId',
      }),
    ]))

    const share = authorizeCodexRequest({
      method: 'POST',
      path: '/api/applications/a1/share',
      scopes: ['applications:write'],
    })
    expect(share).toMatchObject({ allowed: false, missingScopes: ['shares:manage'] })
    expect(authorizeCodexRequest({
      method: 'POST',
      path: '/api/applications/a1/share',
      scopes: ['applications:write', 'shares:manage'],
    }).allowed).toBe(true)
    expect(classifyCodexAuthorizationRequest({ method: 'GET', path: '/api/share/token' }).allowed)
      .toBe(false)
  })

  it('exposes profile recommenders only through the semantic Codex routes', () => {
    expect(authorizeCodexRequest({
      method: 'GET',
      path: '/api/codex/profile-recommenders',
      scopes: ['profile:read'],
    })).toMatchObject({ allowed: true, capability: 'profile.recommenders.read' })
    expect(authorizeCodexRequest({
      method: 'POST',
      path: '/api/codex/profile-recommenders',
      scopes: ['profile:write'],
    })).toMatchObject({ allowed: true, capability: 'profile.recommenders.write' })
    expect(authorizeCodexRequest({
      method: 'PATCH',
      path: '/api/codex/profile-recommenders/r1',
      scopes: ['profile:write'],
    })).toMatchObject({ allowed: true, capability: 'profile.recommenders.write' })
    expect(classifyCodexAuthorizationRequest({
      method: 'GET',
      path: '/api/codex/profile-recommenders/r1',
    }).allowed).toBe(false)
    const personalCapabilities = codexCapabilitiesForScopes(['profile:read'])
    expect(personalCapabilities.routePrefixes).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ prefix: expect.stringContaining('/api/teams') }),
    ]))
    expect(personalCapabilities.deniedPrefixes).toContain('/api/teams')
    expect(classifyCodexAuthorizationRequest({
      method: 'PATCH',
      path: '/api/settings',
      body: { profileRecommenders: [] },
    })).toMatchObject({ allowed: false, code: 'CODEX_SETTINGS_FIELD_FORBIDDEN' })
  })

  it('classifies atomic application recommender resolution with both write authorities', () => {
    const path = '/api/applications/application-1/recommenders/recommender-1/resolve'
    expect(authorizeCodexRequest({
      method: 'POST',
      path,
      scopes: ['applications:write'],
    })).toMatchObject({ allowed: false, missingScopes: ['profile:write'] })
    expect(authorizeCodexRequest({
      method: 'POST',
      path,
      scopes: ['applications:write', 'profile:write'],
    })).toMatchObject({
      allowed: true,
      capability: 'applications.recommenders.resolve',
      requiredScopes: ['applications:write', 'profile:write'],
    })
    expect(codexCapabilitiesForScopes(['applications:write', 'profile:write']).routePrefixes)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          prefix: '/api/applications/:applicationId/recommenders/:recommenderId/resolve',
          methods: ['POST'],
          requiredScopes: ['applications:write', 'profile:write'],
        }),
      ]))
  })

  it('maps each allowed Settings field group to all required scopes', () => {
    const safeBody = Object.fromEntries(CODEX_SETTINGS_WRITE_FIELDS.map((field) => [field, true]))
    expect(authorizeCodexRequest({
      method: 'PATCH',
      path: '/api/settings',
      body: safeBody,
      scopes: ['settings:write', 'profile:write', 'backups:manage', 'mail:manage', 'ai:manage'],
    })).toMatchObject({ allowed: true, capability: 'settings.write' })

    const scopedFields = [
      ['language', 'settings:write'],
      ['avatarDataUrl', 'profile:write'],
      ['profilePresets', 'profile:write'],
      ['autoBackup', 'backups:manage'],
      ['smtpPass', 'mail:manage'],
      ['incomingPass', 'mail:manage'],
      ['receiveEmails', 'mail:manage'],
      ['aiProfile', 'ai:manage'],
    ]
    for (const [field, scope] of scopedFields) {
      expect(authorizeCodexRequest({
        method: 'PATCH',
        path: '/api/settings',
        body: { [field]: true },
        scopes: [scope],
      })).toMatchObject({ allowed: true, requiredScopes: [scope] })
    }

    expect(authorizeCodexRequest({
      method: 'PATCH',
      path: '/api/settings',
      body: { language: 'en', smtpHost: 'smtp.example.com', aiProfile: {} },
      scopes: ['settings:write'],
    })).toMatchObject({ allowed: false, missingScopes: ['ai:manage', 'mail:manage'] })

    for (const forbiddenField of [
      'sessionDurationMinutes',
      'storageQuotaMb',
      'generateCalendarToken',
      'authVersion',
      'profileRecommenders',
    ]) {
      expect(classifyCodexAuthorizationRequest({
        method: 'PATCH',
        path: '/api/settings',
        body: { language: 'en', [forbiddenField]: 'attacker-controlled' },
      })).toMatchObject({
        allowed: false,
        code: 'CODEX_SETTINGS_FIELD_FORBIDDEN',
        forbiddenFields: [forbiddenField],
      })
    }
    expect(classifyCodexAuthorizationRequest({ method: 'PATCH', path: '/api/settings', body: {} }).code)
      .toBe('CODEX_SETTINGS_BODY_INVALID')
    expect(classifyCodexAuthorizationRequest({
      method: 'POST',
      path: '/api/settings/verify-receive-email',
    }).allowed).toBe(false)
  })

  it('separates AI metadata read, draft use, key management and key tests', () => {
    expect(authorizeCodexRequest({ method: 'GET', path: '/api/ai/keys', scopes: ['ai:use'] }))
      .toMatchObject({ allowed: false, missingScopes: ['ai:read'] })
    expect(authorizeCodexRequest({ method: 'GET', path: '/api/ai/keys', scopes: ['ai:read'] }))
      .toMatchObject({ allowed: true, capability: 'ai.read' })
    expect(authorizeCodexRequest({ method: 'POST', path: '/api/ai/keys', scopes: ['ai:manage'] }))
      .toMatchObject({ allowed: true, capability: 'ai.manage' })
    expect(authorizeCodexRequest({ method: 'POST', path: '/api/ai/draft', scopes: ['ai:use'] }))
      .toMatchObject({ allowed: false, missingScopes: ['applications:read'] })
    expect(authorizeCodexRequest({
      method: 'POST',
      path: '/api/ai/draft',
      body: {
        mode: 'reply',
        grants: { userProfile: true, checklist: true, correspondence: true },
      },
      scopes: ['ai:use', 'applications:read'],
    })).toMatchObject({
      allowed: false,
      missingScopes: ['profile:read', 'communications:read', 'files:read'],
    })
    expect(authorizeCodexRequest({
      method: 'POST',
      path: '/api/ai/draft',
      body: { mode: 'compose', grants: {} },
      scopes: ['ai:use', 'applications:read'],
    })).toMatchObject({ allowed: true, capability: 'ai.use' })
    expect(authorizeCodexRequest({
      method: 'POST',
      path: '/api/ai/keys/key-1/test',
      scopes: ['ai:manage'],
    })).toMatchObject({ allowed: false, missingScopes: ['ai:use'] })
    expect(authorizeCodexRequest({
      method: 'POST',
      path: '/api/ai/keys/key-1/test',
      scopes: ['ai:use', 'ai:manage'],
    })).toMatchObject({ allowed: true, capability: 'ai.test' })
  })

  it('keeps archived Team and application transfer routes outside the MCP boundary', () => {
    for (const [method, path] of [
      ['GET', '/api/teams/mine/applications'],
      ['PATCH', '/api/teams/t1/members/u1/profile-assets/a1'],
      ['POST', '/api/teams/t1/notifications/publish'],
      ['POST', '/api/teams/t1/members'],
      ['POST', '/api/teams/t1/join-codes'],
      ['POST', '/api/teams/invites/token/accept'],
      ['POST', '/api/teams/join-codes/code/redeem'],
      ['POST', '/api/applications/a1/team-transfer/preflight'],
      ['PATCH', '/api/applications/a1/team-visibility'],
    ]) {
      expect(classifyCodexAuthorizationRequest({ method, path }))
        .toMatchObject({ allowed: false, code: 'CODEX_ROUTE_FORBIDDEN' })
    }
  })

  it('maps discover apply/preview to both operation and target scopes', () => {
    const readCapabilities = codexCapabilitiesForScopes(['discover:read'])
    expect(readCapabilities.routePrefixes).toEqual(expect.arrayContaining([
      expect.objectContaining({ prefix: '/api/discover/catalog', methods: ['GET'] }),
      expect.objectContaining({ prefix: '/api/discover/state', methods: ['GET'] }),
      expect.objectContaining({ prefix: '/api/discover/source-index', methods: ['GET'] }),
    ]))
    const writeCapabilities = codexCapabilitiesForScopes(['applications:write', 'discover:write'])
    expect(writeCapabilities.routePrefixes).toEqual(expect.arrayContaining([
      expect.objectContaining({ prefix: '/api/discover/state', methods: ['PUT'] }),
      expect.objectContaining({ prefix: '/api/discover/programs/delete', methods: ['POST'] }),
      expect.objectContaining({
        prefix: '/api/discover/import',
        methods: ['POST'],
        requiredScopes: ['discover:write', 'applications:write'],
      }),
    ]))
    expect(authorizeCodexRequest({
      method: 'POST',
      path: '/api/discover/applications/a1/enrichment/preview',
      scopes: ['discover:read'],
    })).toMatchObject({ allowed: false, missingScopes: ['applications:read', 'ai:use'] })
    expect(authorizeCodexRequest({
      method: 'POST',
      path: '/api/discover/applications/a1/enrichment/preview',
      scopes: ['applications:read', 'discover:read', 'ai:use'],
    })).toMatchObject({ allowed: true, capability: 'discover.enrichment.preview' })
    expect(authorizeCodexRequest({
      method: 'POST',
      path: '/api/discover/applications/a1/enrichment/apply',
      scopes: ['discover:write', 'applications:write'],
    }).allowed).toBe(true)
    expect(authorizeCodexRequest({
      method: 'POST',
      path: '/api/discover/research/start',
      scopes: ['discover:write'],
    })).toMatchObject({ allowed: false, missingScopes: ['ai:use'] })
  })

  it('maps profile exports, downloads, notifications, analytics, exports, backups and mail', () => {
    const cases = [
      ['GET', '/api/profile-assets/a1/export', ['profile:read', 'exports:read'], 'profile.export'],
      ['GET', '/api/files/f1/download', ['files:read'], 'files.read'],
      ['POST', '/api/notifications/n1/read', ['notifications:write'], 'notifications.write'],
      ['GET', '/api/analytics', ['analytics:read'], 'analytics.read'],
      ['GET', '/api/exports', ['exports:read', 'applications:read'], 'exports.read'],
      ['POST', '/api/backups', ['backups:manage', 'applications:read'], 'backups.create'],
      ['POST', '/api/backups/a.json/restore', ['backups:manage', 'applications:write'], 'backups.restore'],
      ['POST', '/api/settings/fetch-mail-now', ['mail:manage'], 'mail.manage'],
      ['POST', '/api/settings/test-email', ['mail:manage'], 'mail.manage'],
      ['POST', '/api/settings/test-incoming-mail', ['mail:manage'], 'mail.manage'],
      ['POST', '/api/settings/receive-email-verification', ['mail:manage'], 'mail.manage'],
      ['GET', '/api/interview-prep/workspace', ['interview:read'], 'interview.read'],
      ['PUT', '/api/interview-prep/workspace', ['interview:write'], 'interview.write'],
      ['POST', '/api/interview-prep/ai/questions', ['interview:use', 'ai:use'], 'interview.ai'],
      ['POST', '/api/interview-prep/ai/mock-turn', ['interview:use', 'ai:use'], 'interview.ai'],
      ['POST', '/api/interview-prep/ai/feedback', ['interview:use', 'ai:use'], 'interview.ai'],
    ]
    for (const [method, path, scopes, capability] of cases) {
      expect(authorizeCodexRequest({ method, path, scopes }))
        .toMatchObject({ allowed: true, capability })
    }
    expect(authorizeCodexRequest({
      method: 'POST',
      path: '/api/backups',
      scopes: ['backups:manage'],
    })).toMatchObject({ allowed: false, missingScopes: ['applications:read'] })
    expect(authorizeCodexRequest({
      method: 'POST',
      path: '/api/backups/a.json/restore',
      scopes: ['backups:manage'],
    })).toMatchObject({ allowed: false, missingScopes: ['applications:write'] })
  })

  it('rejects invalid scopes and old or future scope versions with a reauthorization code', () => {
    expect(authorizeCodexRequest({
      method: 'GET',
      path: '/api/applications',
      scopes: ['*'],
    })).toMatchObject({ allowed: false, code: 'CODEX_SCOPE_INVALID' })
    expect(authorizeCodexRequest({
      method: 'GET',
      path: '/api/applications',
      scopes: ['applications:read'],
      scopeVersion: 1,
    })).toMatchObject({
      allowed: false,
      code: 'CODEX_AUTHORIZATION_REAUTHORIZATION_REQUIRED',
    })
    expect(authorizeCodexRequest({
      method: 'GET',
      path: '/api/applications',
      scopes: ['applications:read'],
      scopeVersion: 3,
    })).toMatchObject({
      allowed: false,
      code: 'CODEX_AUTHORIZATION_REAUTHORIZATION_REQUIRED',
    })
  })
})
