import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearClientSessionCaches,
  getLatestSessionToken,
  invalidateClientReadCacheForScopes,
  phdApi,
  readSessionTokenSubject,
  sessionTokenIsDefinitelyExpired,
  sessionIdentityMatches,
  setSessionTokenHandler,
  setUnauthorizedHandler,
  SETTINGS_PERSISTENCE_ACK_PROTOCOL,
} from './phdApi'
import {
  CONNECTIVITY_OUTAGE_GRACE_MS,
  getConnectivitySnapshot,
  reportApiReachable,
  reportApiUnavailable,
  resetConnectivityForTests,
  setManualOfflineMode,
} from '../connectivity'
import type { InterviewEvent, InterviewMockSession } from '../interviewPrep'
import {
  applications as applicationFixtures,
  type ApplicationRecord,
} from '../data/applications'
import {
  APPLICATION_MUTATION_ACK_PROTOCOL,
  type ApplicationMutationPatchOperation,
  applicationAuthorityContentHash,
  applicationAuthoredContentHash,
  applicationMutationAckCommitment,
  canonicalValueHash,
} from '../applicationMutationAcknowledgement'

type VersionedApplicationRecord = ApplicationRecord & { updatedAt: string }

function applicationFixture<T extends Record<string, unknown>>(
  overrides: T,
): VersionedApplicationRecord & T {
  const seed = applicationFixtures[0]!
  return {
    ...seed,
    ...overrides,
    updatedAt: typeof overrides.updatedAt === 'string'
      ? overrides.updatedAt
      : '2026-07-13T08:00:00.000Z',
  } as VersionedApplicationRecord & T
}

function envelope<T>(data: T, sessionToken?: string, extraHeaders?: Record<string, string>) {
  const headers = new Headers({ 'Content-Type': 'application/json', ...extraHeaders })
  if (sessionToken) headers.set('X-Session-Token', sessionToken)
  return new Response(JSON.stringify({
    ok: true,
    data,
    session: sessionToken ? { token: sessionToken } : undefined,
    requestId: 'test-request',
  }), {
    status: 200,
    headers,
  })
}

async function applicationMutationAcknowledgement({
  submitted,
  durable,
  baseUpdatedAt,
  mutation,
  operationCount,
  patch = [],
}: {
  submitted: VersionedApplicationRecord
  durable: VersionedApplicationRecord
  baseUpdatedAt: string
  mutation: unknown
  operationCount: number
  patch?: ApplicationMutationPatchOperation[]
}) {
  const acknowledgement = {
    protocol: APPLICATION_MUTATION_ACK_PROTOCOL,
    projectionVersion: 2 as const,
    id: submitted.id,
    updatedAt: durable.updatedAt,
    baseUpdatedAt,
    operationCount,
    mutationHash: await canonicalValueHash(mutation),
    baselineHash: await applicationAuthoredContentHash(submitted),
    applicationHash: await applicationAuthoredContentHash(durable),
    authorityPurpose: 'none' as const,
    authorityProjectionVersion: 1 as const,
    authorityHash: await applicationAuthorityContentHash(durable),
    patch,
    durable: true as const,
  }
  return {
    ...acknowledgement,
    canonicalHash: await canonicalValueHash(applicationMutationAckCommitment(acknowledgement)),
  }
}

function authCapacityEnvelope(retryAfterMs: number, useStandardHeader = false) {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (useStandardHeader) {
    headers.set('Retry-After', String(retryAfterMs / 1_000))
  } else {
    headers.set('X-PhD-Retry-After-Ms', String(retryAfterMs))
  }
  return new Response(JSON.stringify({
    ok: false,
    error: {
      code: 'AUTH_CAPACITY_EXCEEDED',
      message: 'Password authentication is temporarily at capacity.',
    },
    requestId: 'capacity-request',
  }), {
    status: 429,
    headers,
  })
}

const workspaceSectionOrder = [
  'me',
  'applications',
  'profileAssets',
  'backups',
  'applicationTrash',
  'teamWorkspaces',
  'activeTeamId',
  'teamSummary',
  'teamApplications',
  'aiKeys',
  'teamMemberProfileAssets',
  'interviewWorkspace',
] as const

function responseTooLarge() {
  return new Response(JSON.stringify({
    ok: false,
    error: {
      code: 'RESPONSE_TOO_LARGE',
      message: 'This workspace response is too large for one safe transfer.',
    },
    requestId: 'large-response',
  }), {
    status: 413,
    headers: { 'Content-Type': 'application/json' },
  })
}

function workspaceSectionStream(
  payload: Record<string, unknown>,
  options: {
    revision?: number
    restartAfterSections?: number
    restartRevision?: number
    restartCode?: string
    retryAfterMs?: unknown
    requestId?: string
    etag?: string
  } = {},
) {
  const revision = options.revision ?? 1
  const sections = workspaceSectionOrder.filter((section) => Object.hasOwn(payload, section))
  const lines: string[] = [JSON.stringify({
    kind: 'manifest',
    protocol: 'phd-atlas-workspace-sections-v1',
    revision,
    sections,
  })]
  let completed = 0
  for (const section of sections) {
    const value = payload[section]
    const shape = Array.isArray(value) ? 'array' : 'value'
    const values: unknown[] = Array.isArray(value) ? value : [value ?? null]
    lines.push(JSON.stringify({ kind: 'section-begin', revision, section, shape, count: values.length }))
    values.forEach((item, itemIndex) => {
      const serialized = JSON.stringify(item ?? null)
      const chunks = serialized.match(/[\s\S]{1,65536}/gu) ?? []
      chunks.forEach((data, sequence) => {
        lines.push(JSON.stringify({ kind: 'chunk', revision, section, item: itemIndex, sequence, data }))
      })
      lines.push(JSON.stringify({
        kind: 'item-complete',
        revision,
        section,
        item: itemIndex,
        chunks: chunks.length,
        characters: serialized.length,
      }))
    })
    lines.push(JSON.stringify({ kind: 'section-complete', revision, section, items: values.length }))
    completed += 1
    if (options.restartAfterSections === completed) {
      lines.push(JSON.stringify({
        kind: 'restart',
        protocol: 'phd-atlas-workspace-sections-v1',
        expectedRevision: revision,
        revision: options.restartRevision ?? revision + 1,
        ...(options.restartCode ? { code: options.restartCode } : {}),
        ...(options.retryAfterMs === undefined ? {} : { retryAfterMs: options.retryAfterMs }),
        ...(options.requestId ? { requestId: options.requestId } : {}),
      }))
      return new Response(`${lines.join('\n')}\n`, {
        status: 200,
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'X-Workspace-Revision': String(revision),
          'X-Workspace-Stream-Protocol': 'phd-atlas-workspace-sections-v1',
          ...(options.requestId ? { 'X-Request-Id': options.requestId } : {}),
          ...(options.etag ? { ETag: options.etag } : {}),
        },
      })
    }
  }
  lines.push(JSON.stringify({
    kind: 'complete',
    protocol: 'phd-atlas-workspace-sections-v1',
    revision,
    sections: sections.length,
  }))
  return new Response(`${lines.join('\n')}\n`, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'X-Workspace-Revision': String(revision),
      'X-Workspace-Stream-Protocol': 'phd-atlas-workspace-sections-v1',
      ...(options.requestId ? { 'X-Request-Id': options.requestId } : {}),
      ...(options.etag ? { ETag: options.etag } : {}),
    },
  })
}

function jwtFor(sub: string, label: string) {
  const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }))
    .replace(/\+/g, '-').replace(/\//g, '_')
    .replace(/=+$/g, '')
  const payload = btoa(JSON.stringify({ sub, label }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  return `${header}.${payload}.sig`
}

describe('phdApi session token tracking', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    })
    resetConnectivityForTests()
    reportApiReachable(80)
  })

  afterEach(() => {
    setSessionTokenHandler(null)
    setUnauthorizedHandler(null)
    clearClientSessionCaches()
    resetConnectivityForTests()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('negotiates and binds a settings acknowledgement to the exact request nonce', async () => {
    const fetchMock = vi.fn().mockImplementation((_path, init: RequestInit) => {
      const headers = new Headers(init.headers)
      const mutationId = headers.get('X-PhD-Settings-Mutation-Id') ?? ''
      expect(headers.get('X-PhD-Settings-Acknowledgement')).toBe('v1')
      expect(mutationId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/)
      return Promise.resolve(envelope({
        protocol: SETTINGS_PERSISTENCE_ACK_PROTOCOL,
        version: 1,
        durable: true,
        mutationId,
        settingsVersion: 4,
        keys: ['snippetPhraseLeadEn'],
        secretReceipts: {},
        user: {
          id: 'settings-user',
          name: 'Settings user',
          email: 'settings@example.com',
          role: 'user',
          createdAt: '2026-08-03T00:00:00.000Z',
          lastLoginAt: null,
          settingsVersion: 4,
          settings: { snippetPhraseLeadEn: 'Durable lead' },
        },
      }))
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(phdApi.updateSettings('settings-token', {
      snippetPhraseLeadEn: 'Durable lead',
    })).resolves.toMatchObject({
      id: 'settings-user',
      settingsVersion: 4,
      settingsAcknowledgement: {
        protocol: SETTINGS_PERSISTENCE_ACK_PROTOCOL,
        durable: true,
        settingsVersion: 4,
      },
    })
  })

  it.each([
    ['legacy PublicUser response', (mutationId: string) => ({
      id: 'settings-user',
      settings: { snippetPhraseLeadEn: 'Durable lead' },
      mutationId,
    })],
    ['wrong mutation nonce', (_mutationId: string) => ({
      protocol: SETTINGS_PERSISTENCE_ACK_PROTOCOL,
      version: 1,
      durable: true,
      mutationId: 'settings-stale-response-0001',
      settingsVersion: 4,
      user: { id: 'settings-user', settings: { snippetPhraseLeadEn: 'Durable lead' } },
    })],
  ])('rejects a %s before it can be committed as saved', async (_label, responseFor) => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_path, init: RequestInit) => {
      const mutationId = new Headers(init.headers).get('X-PhD-Settings-Mutation-Id') ?? ''
      return Promise.resolve(envelope(responseFor(mutationId)))
    }))

    await expect(phdApi.updateSettings('settings-token', {
      snippetPhraseLeadEn: 'Durable lead',
    })).rejects.toMatchObject({
      code: 'SETTINGS_PERSISTENCE_NOT_ACKNOWLEDGED',
      status: 409,
    })
  })

  it('surfaces a gateway failure as an unavailable Atlas server', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 502 })))

    await expect(phdApi.login('jasper@example.com', 'demo123456')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'SERVER_UNAVAILABLE',
      status: 502,
    })
  })

  it('retries password login capacity responses and keeps the server circuit healthy', async () => {
    vi.useFakeTimers()
    const randomMock = vi.spyOn(Math, 'random').mockReturnValue(0)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(authCapacityEnvelope(500))
      .mockResolvedValueOnce(authCapacityEnvelope(1_000, true))
      .mockResolvedValueOnce(envelope({
        token: 'capacity-login-token',
        user: { id: 'capacity-user', email: 'capacity@example.com' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    try {
      const loginPromise = phdApi.login('capacity@example.com', 'password')
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchMock).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(500)
      expect(fetchMock).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(1_000)
      await expect(loginPromise).resolves.toMatchObject({ token: 'capacity-login-token' })
      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(getConnectivitySnapshot()).toMatchObject({
        mode: 'online',
        serverReachable: true,
        consecutiveFailures: 0,
      })
    } finally {
      randomMock.mockRestore()
    }
  })

  it('bounds password login capacity retries to the total retry budget', async () => {
    vi.useFakeTimers()
    const randomMock = vi.spyOn(Math, 'random').mockReturnValue(0)
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(authCapacityEnvelope(60_000)))
    vi.stubGlobal('fetch', fetchMock)

    try {
      const loginPromise = phdApi.login('capacity@example.com', 'password')
      const rejection = expect(loginPromise).rejects.toMatchObject({
        code: 'AUTH_CAPACITY_EXCEEDED',
        status: 429,
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchMock).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(60_000)
      expect(fetchMock).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(15_000)
      await rejection
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      randomMock.mockRestore()
    }
  })

  it('stops a waiting password login retry when the session generation is superseded', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValueOnce(authCapacityEnvelope(60_000))
    vi.stubGlobal('fetch', fetchMock)

    const loginPromise = phdApi.login('first@example.com', 'password')
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    clearClientSessionCaches()
    await expect(loginPromise).rejects.toMatchObject({
      code: 'SESSION_SUPERSEDED',
      status: 409,
    })
    await vi.advanceTimersByTimeAsync(75_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('stops a waiting password login retry when its caller aborts', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValueOnce(authCapacityEnvelope(60_000))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    const loginPromise = phdApi.login('cancelled@example.com', 'password', 'app', {
      signal: controller.signal,
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    controller.abort()
    await expect(loginPromise).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(75_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry capacity errors for non-login mutations', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(authCapacityEnvelope(500))
    vi.stubGlobal('fetch', fetchMock)

    await expect(phdApi.completeInitialSetup({} as never, 'short-lived-test-claim')).rejects.toMatchObject({
      code: 'AUTH_CAPACITY_EXCEEDED',
      status: 429,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fails repeated reads locally after the API circuit opens', async () => {
    reportApiUnavailable()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(phdApi.listApplications('offline-read-token')).rejects.toMatchObject({
      code: 'SERVER_UNAVAILABLE',
      status: 503,
    })
    await expect(phdApi.listApplications('offline-read-token')).rejects.toMatchObject({
      code: 'SERVER_UNAVAILABLE',
      status: 503,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('blocks every transport in deliberate offline mode but lets an explicit mutation recover an open server circuit', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      envelope({
        token: 'restored-token',
        user: { id: 'user-restored', email: 'restored@example.com' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    setManualOfflineMode(true)
    await expect(phdApi.login('restored@example.com', 'password')).rejects.toMatchObject({
      code: 'SERVER_UNAVAILABLE',
    })
    expect(fetchMock).not.toHaveBeenCalled()

    setManualOfflineMode(false)
    reportApiUnavailable()
    await expect(phdApi.login('restored@example.com', 'password')).resolves.toMatchObject({
      token: 'restored-token',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getConnectivitySnapshot()).toMatchObject({
      mode: 'online',
      serverReachable: true,
    })
  })

  it('preserves structured external-service failures instead of reporting Atlas as offline', async () => {
    reportApiReachable()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: 'SMTP_AUTH_FAILED',
              message: 'The SMTP server rejected the saved credentials.',
            },
          }),
          {
            status: 502,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: 'MAIL_FETCH_CONNECTION_FAILED',
              message: 'The IMAP server could not be reached.',
            },
          }),
          {
            status: 502,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(phdApi.sendTestEmail('mail-token')).rejects.toMatchObject({
      code: 'SMTP_AUTH_FAILED',
      status: 502,
    })
    await expect(phdApi.testIncomingMail('mail-token')).rejects.toMatchObject({
      code: 'MAIL_FETCH_CONNECTION_FAILED',
      status: 502,
    })
    expect(getConnectivitySnapshot()).toMatchObject({
      mode: 'online',
      serverReachable: true,
      consecutiveFailures: 0,
    })
  })

  it('opens the circuit for a gateway-owned JSON failure and preserves its safe request reference', async () => {
    vi.useFakeTimers()
    reportApiReachable()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      ok: false,
      error: { code: 'SERVER_UNAVAILABLE', message: 'The upstream API is unavailable.' },
      requestId: 'body-request-reference',
    }), {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'X-PhD-Gateway-Error': 'unavailable',
        'X-Request-Id': 'gateway-request-reference',
      },
    })))

    await expect(phdApi.me('gateway-json-token')).rejects.toMatchObject({
      code: 'SERVER_UNAVAILABLE',
      requestId: 'gateway-request-reference',
      status: 503,
    })
    expect(getConnectivitySnapshot()).toMatchObject({
      mode: 'checking',
      serverReachable: null,
    })
    await vi.advanceTimersByTimeAsync(CONNECTIVITY_OUTAGE_GRACE_MS)
    expect(getConnectivitySnapshot()).toMatchObject({
      mode: 'server-unreachable',
      serverReachable: false,
    })
  })

  it('keeps the circuit healthy for an application-owned structured 503', async () => {
    reportApiReachable()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      ok: false,
      error: { code: 'SERVER_BUSY', message: 'The application is temporarily busy.' },
      requestId: 'application-busy-reference',
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })))

    await expect(phdApi.me('application-busy-token')).rejects.toMatchObject({
      code: 'SERVER_BUSY',
      requestId: 'application-busy-reference',
      status: 503,
    })
    expect(getConnectivitySnapshot()).toMatchObject({
      mode: 'online',
      serverReachable: true,
    })
  })

  it('keeps refreshed session tokens scoped to the request token that produced them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        envelope(
          {
            user: null,
            settings: null,
            mailFetchStatus: null,
          },
          'source-token-refreshed',
        ),
      ),
    )

    await phdApi.me('source-token')

    expect(getLatestSessionToken('source-token')).toBe('source-token-refreshed')
    expect(getLatestSessionToken('fresh-login-token')).toBe('fresh-login-token')
  })

  it('refuses to chain a refreshed token that belongs to a different account', async () => {
    const demoToken = jwtFor('user_demo', 'demo-source')
    const teacherToken = jwtFor('user_teacher', 'teacher-rotated')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        envelope(
          {
            user: { id: 'user_teacher', email: 'teacher@phd-atlas.local' },
            settings: null,
            mailFetchStatus: null,
          },
          teacherToken,
        ),
      ),
    )

    await phdApi.me(demoToken)

    expect(readSessionTokenSubject(demoToken)).toBe('user_demo')
    expect(readSessionTokenSubject(teacherToken)).toBe('user_teacher')
    expect(getLatestSessionToken(demoToken)).toBe(demoToken)
    expect(sessionIdentityMatches('user_demo', 'user_demo', demoToken)).toBe(true)
    expect(sessionIdentityMatches('user_demo', 'user_teacher', demoToken)).toBe(false)
    expect(sessionIdentityMatches('user_demo', 'user_demo', teacherToken)).toBe(false)
  })

  it('identifies only explicitly expired JWTs during cold-start preflight', () => {
    const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '')
    const tokenWithExpiry = (exp: number) => {
      const payload = btoa(JSON.stringify({ sub: 'user_demo', exp }))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '')
      return `${header}.${payload}.sig`
    }
    const now = Date.UTC(2026, 6, 27, 12, 0, 0)

    expect(sessionTokenIsDefinitelyExpired(tokenWithExpiry(now / 1_000 - 1), now)).toBe(true)
    expect(sessionTokenIsDefinitelyExpired(tokenWithExpiry(now / 1_000 + 1), now)).toBe(false)
    expect(sessionTokenIsDefinitelyExpired('opaque-legacy-token', now)).toBe(false)
  })

  it('does not let a late same-account 401 from a previous generation fire unauthorized', async () => {
    const expiredToken = jwtFor('user_demo', 'expired')
    const freshToken = jwtFor('user_demo', 'fresh')
    let releaseExpired: (() => void) | undefined
    const unauthorized = vi.fn()
    setUnauthorizedHandler(unauthorized)

    const fetchMock = vi
      .fn()
      // First session request hangs until after a generation bump (re-login).
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            releaseExpired = () =>
              resolve(
                new Response(
                  JSON.stringify({
                    ok: false,
                    error: {
                      code: 'TOKEN_EXPIRED',
                      message: 'Your session expired. Please sign in again.',
                    },
                    requestId: 'stale',
                  }),
                  {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' },
                  },
                ),
              )
          }),
      )
      // Fresh session me succeeds.
      .mockImplementationOnce(() =>
        Promise.resolve(
          envelope({
            user: { id: 'user_demo', email: 'jasper@example.com' },
            settings: null,
            mailFetchStatus: null,
          }),
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    const staleMe = phdApi.me(expiredToken)
    // Simulate login/re-login scrubbing client session state.
    clearClientSessionCaches()
    const freshMe = await phdApi.me(freshToken)
    expect(freshMe.user.id).toBe('user_demo')

    releaseExpired?.()
    await expect(staleMe).rejects.toMatchObject({ code: 'SESSION_SUPERSEDED' })
    expect(unauthorized).not.toHaveBeenCalled()
  })

  it('rejects an authenticated mutation immediately when its session generation is superseded', async () => {
    const token = jwtFor('user_demo', 'mutation-stale')
    let transportSignal: AbortSignal | undefined
    const fetchMock = vi.fn(
      (_path: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>(() => {
          transportSignal = init?.signal ?? undefined
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const request = phdApi.addProfileAsset(token, {
      name: 'Stale asset',
      kind: 'other',
      description: '',
    })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    clearClientSessionCaches()

    await expect(request).rejects.toMatchObject({ code: 'SESSION_SUPERSEDED' })
    expect(transportSignal?.aborted).toBe(true)
    expect(transportSignal?.reason).toMatchObject({ code: 'SESSION_SUPERSEDED' })
  })

  it('isolates conditional /api/auth/me caches by JWT subject across accounts', async () => {
    const demoToken = jwtFor('user_demo', 'demo')
    const teacherToken = jwtFor('user_teacher', 'teacher')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        envelope(
          {
            user: { id: 'user_demo', email: 'jasper@example.com' },
            settings: null,
            mailFetchStatus: null,
          },
          undefined,
          { ETag: '"me-demo"' },
        ),
      )
      .mockResolvedValueOnce(
        envelope(
          {
            user: { id: 'user_teacher', email: 'teacher@phd-atlas.local' },
            settings: null,
            mailFetchStatus: null,
          },
          undefined,
          { ETag: '"me-teacher"' },
        ),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 304,
          headers: new Headers({ ETag: '"me-demo"' }),
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const demoMe = await phdApi.me(demoToken)
    const teacherMe = await phdApi.me(teacherToken)
    const demoMeAgain = await phdApi.me(demoToken)

    expect(demoMe.user.id).toBe('user_demo')
    expect(teacherMe.user.id).toBe('user_teacher')
    expect(demoMeAgain.user.id).toBe('user_demo')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const thirdHeaders = new Headers(fetchMock.mock.calls[2]?.[1]?.headers)
    expect(thirdHeaders.get('If-None-Match')).toBe('"me-demo"')
  })

  it('keeps same-account /api/auth/me 304 reuse and never swaps the subject', async () => {
    const demoToken = jwtFor('user_demo', 'demo-v1')
    const demoRotated = jwtFor('user_demo', 'demo-v2')
    const mePayload = {
      user: { id: 'user_demo', email: 'jasper@example.com' },
      settings: null,
      mailFetchStatus: null,
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(envelope(mePayload, demoRotated, { ETag: '"me-demo-v1"' }))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 304,
          headers: new Headers({ ETag: '"me-demo-v1"' }),
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const first = await phdApi.me(demoToken)
    const second = await phdApi.me(demoToken)

    expect(first.user.id).toBe('user_demo')
    expect(second.user.id).toBe('user_demo')
    expect(getLatestSessionToken(demoToken)).toBe(demoRotated)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('prefers a fresh response header over a stale cached envelope session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            data: { user: null, settings: null, mailFetchStatus: null },
            session: { token: 'expired-cached-body-token' },
            requestId: 'test-request',
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'X-Session-Token': 'fresh-revalidated-header-token',
            },
          },
        ),
      ),
    )

    await phdApi.me('login-token')

    expect(getLatestSessionToken('login-token')).toBe('fresh-revalidated-header-token')
  })

  it('follows only the refresh chain for the provided source token', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(envelope({ user: null, settings: null, mailFetchStatus: null }, 'chain-token-2'))
        .mockResolvedValueOnce(envelope({ user: null, settings: null, mailFetchStatus: null }, 'chain-token-3')),
    )

    await phdApi.me('chain-token-1')
    await phdApi.me('chain-token-2')

    expect(getLatestSessionToken('chain-token-1')).toBe('chain-token-3')
    expect(getLatestSessionToken('other-token')).toBe('other-token')
  })

  it('reuses cached application lists when the server returns 304', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-20T00:00:00.000Z'))
    const applications = [{ id: 'app_cached', school: { name: 'Cached University' } }]
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(envelope(applications, 'conditional-token-2', { ETag: '"apps-v1"' }))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 304,
          headers: new Headers({ 'X-Session-Token': 'conditional-token-3' }),
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const first = await phdApi.listApplications('conditional-token-1')
    await vi.advanceTimersByTimeAsync(1_001)
    const second = await phdApi.listApplications('conditional-token-1')

    expect(first).toEqual(applications)
    expect(second).toEqual(applications)
    const secondHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers)
    expect(secondHeaders.get('Authorization')).toBe('Bearer conditional-token-2')
    expect(secondHeaders.get('If-None-Match')).toBe('"apps-v1"')
    expect(fetchMock.mock.calls[1]?.[1]?.cache).toBe('no-store')
    expect(getLatestSessionToken('conditional-token-1')).toBe('conditional-token-3')
  })

  it('binds offline replay writes to a compact durable server version', async () => {
    const base = applicationFixture({
      id: 'app_1',
      progress: 30,
      updatedAt: '2026-07-13T08:00:00.000Z',
    })
    const application = applicationFixture({ ...base, progress: 45 })
    const committedAt = '2026-07-13T08:00:01.000Z'
    const operations = [{ op: 'replace', path: '/progress', value: 45 }]
    const durable = { ...application, updatedAt: committedAt }
    const acknowledgement = await applicationMutationAcknowledgement({
      submitted: application,
      durable,
      baseUpdatedAt: base.updatedAt,
      mutation: operations,
      operationCount: operations.length,
    })
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope(acknowledgement))
    vi.stubGlobal('fetch', fetchMock)

    await expect(phdApi.replayOfflineApplicationUpdate('offline-token', application, base)).resolves.toMatchObject({
      unchanged: false,
      application: { id: 'app_1', progress: 45, updatedAt: committedAt },
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/applications/app_1/delta')
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PATCH')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      baseUpdatedAt: base.updatedAt,
      operations,
    })
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.get('X-PhD-Application-Acknowledgement')).toBe('v2')
    expect(headers.get('X-PhD-Application-Projection-Version')).toBe('2')
    expect(headers.get('X-PhD-Application-Baseline-Hash')).toBe(acknowledgement.baselineHash)
  })

  it('rejects a valid durable proof when persistence stripped a submitted authored field', async () => {
    const base = applicationFixture({
      id: 'app_stripped',
      notes: 'Before',
      updatedAt: '2026-07-13T08:00:00.000Z',
    })
    const submitted = applicationFixture({ ...base, notes: 'Must survive' })
    const durable = { ...submitted, notes: '', updatedAt: '2026-07-13T08:00:01.000Z' }
    const operations = [{ op: 'replace', path: '/notes', value: 'Must survive' }]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(envelope(
      await applicationMutationAcknowledgement({
        submitted,
        durable,
        baseUpdatedAt: base.updatedAt,
        mutation: operations,
        operationCount: operations.length,
        patch: [{
          op: 'set',
          path: '/notes',
          value: '',
          valueHash: await canonicalValueHash(''),
        }],
      }),
    )))

    await expect(phdApi.updateApplication('token', submitted, base)).rejects.toMatchObject({
      code: 'REQUEST_FAILED',
      status: 409,
    })
  })

  it('returns an explicit local no-op without manufacturing a server acknowledgement', async () => {
    const base = applicationFixture({
      id: 'app_noop',
      notes: 'Already durable',
      updatedAt: '2026-07-13T08:00:00.000Z',
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(phdApi.updateApplication('token', { ...base }, base)).resolves.toEqual({
      unchanged: true,
      application: base,
      acknowledgement: null,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requests a compact truthful acknowledgement for the PUT compatibility path', async () => {
    const submitted = applicationFixture({
      id: 'app_put',
      notes: 'PUT authored value',
      updatedAt: '2026-07-13T08:00:00.000Z',
    })
    const durable = { ...submitted, updatedAt: '2026-07-13T08:00:01.000Z' }
    const baselineHash = await applicationAuthoredContentHash(submitted)
    const acknowledgement = await applicationMutationAcknowledgement({
      submitted,
      durable,
      baseUpdatedAt: submitted.updatedAt,
      mutation: submitted,
      operationCount: 0,
    })
    acknowledgement.mutationHash = baselineHash
    acknowledgement.canonicalHash = await canonicalValueHash(applicationMutationAckCommitment(acknowledgement))
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope(acknowledgement))
    vi.stubGlobal('fetch', fetchMock)

    await expect(phdApi.updateApplication('token', submitted)).resolves.toMatchObject({
      unchanged: false,
      application: { id: submitted.id, notes: submitted.notes, updatedAt: durable.updatedAt },
    })
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.get('X-PhD-Application-Projection-Version')).toBe('2')
    expect(headers.get('X-PhD-Application-Baseline-Hash')).toBe(baselineHash)
    expect(JSON.stringify(acknowledgement).length).toBeLessThan(2_048)
  })

  it('re-sends the whole application when the server refuses the delta shape', async () => {
    const base = applicationFixture({
      id: 'app_delta_fallback',
      notes: 'Before',
      updatedAt: '2026-08-05T08:00:00.000Z',
    })
    const submitted = applicationFixture({ ...base, notes: 'After a base drift' })
    const durable = { ...submitted, updatedAt: '2026-08-05T08:00:01.000Z' }
    const baselineHash = await applicationAuthoredContentHash(submitted)
    const acknowledgement = await applicationMutationAcknowledgement({
      submitted,
      durable,
      baseUpdatedAt: submitted.updatedAt,
      mutation: submitted,
      operationCount: 0,
    })
    acknowledgement.mutationHash = baselineHash
    acknowledgement.canonicalHash = await canonicalValueHash(applicationMutationAckCommitment(acknowledgement))

    // A base copy that drifted produces a pointer the server cannot resolve.
    // Nobody editing can act on that, so the save must complete anyway.
    const rejection = new Response(JSON.stringify({
      ok: false,
      error: { code: 'APPLICATION_DELTA_INVALID', message: 'An application delta path does not exist.' },
      requestId: 'test-request',
    }), { status: 400, headers: { 'Content-Type': 'application/json' } })

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(rejection)
      .mockResolvedValueOnce(envelope(acknowledgement))
    vi.stubGlobal('fetch', fetchMock)

    await expect(phdApi.updateApplication('token', submitted, base)).resolves.toMatchObject({
      unchanged: false,
      application: { id: submitted.id, notes: submitted.notes, updatedAt: durable.updatedAt },
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/applications/app_delta_fallback/delta')
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PATCH')
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('/api/applications/app_delta_fallback')
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('PUT')
  })

  it('does not fall back for a rejection the person can actually act on', async () => {
    const base = applicationFixture({
      id: 'app_delta_validation',
      notes: 'Before',
      updatedAt: '2026-08-05T08:00:00.000Z',
    })
    const submitted = applicationFixture({ ...base, notes: 'After' })
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid url', field: 'professor.labUrl' },
      requestId: 'test-request',
    }), { status: 400, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(phdApi.updateApplication('token', submitted, base)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('coalesces concurrent conditional reads for the same session and path', async () => {
    const applications = [{ id: 'app_inflight', school: { name: 'Fast University' } }]
    let resolveFetch!: (response: Response) => void
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const first = phdApi.listApplications('inflight-token')
    const second = phdApi.listApplications('inflight-token')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    resolveFetch(envelope(applications, undefined, { ETag: '"apps-inflight"' }))
    await expect(Promise.all([first, second])).resolves.toEqual([applications, applications])
  })

  it('coalesces concurrent plain GET reads through the shared transport boundary', async () => {
    const status = {
      phase: 'idle',
      operationInFlight: false,
      restartPending: false,
    }
    let resolveFetch!: (response: Response) => void
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const first = phdApi.systemUpdateStatus('admin-read-token')
    const second = phdApi.systemUpdateStatus('admin-read-token')
    await Promise.resolve()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    resolveFetch(envelope(status))
    await expect(Promise.all([first, second])).resolves.toEqual([status, status])
  })

  it('aborts an owned conditional transport when its caller leaves', async () => {
    let transportSignal: AbortSignal | undefined
    const fetchMock = vi.fn(
      (_path: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          transportSignal = init?.signal ?? undefined
          transportSignal?.addEventListener('abort', () => reject(transportSignal?.reason), { once: true })
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    const request = phdApi.unreadNotificationCount('notification-token', {
      signal: controller.signal,
    })
    const assertion = expect(request).rejects.toMatchObject({
      name: 'AbortError',
    })
    await Promise.resolve()
    controller.abort()

    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(transportSignal?.aborted).toBe(true)
  })

  it('serves low-volatility reads from the short freshness cache even without an ETag', async () => {
    const assets = [{ id: 'asset_cached', name: 'Research statement' }]
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope(assets))
    vi.stubGlobal('fetch', fetchMock)

    await expect(phdApi.listProfileAssets('cache-token')).resolves.toEqual(assets)
    await expect(phdApi.listProfileAssets('cache-token')).resolves.toEqual(assets)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reuses a freshly hydrated application detail across rapid remounts', async () => {
    const application = { id: 'app_fresh_detail', school: { name: 'Cambridge' } }
    const fetchMock = vi.fn().mockResolvedValue(envelope(application))
    vi.stubGlobal('fetch', fetchMock)

    await expect(phdApi.getApplication('detail-cache-token', application.id)).resolves.toEqual(application)
    await expect(phdApi.getApplication('detail-cache-token', application.id)).resolves.toEqual(application)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('caches admission panel reads and invalidates them after an admission mutation', async () => {
    const report = { id: 'report_1', generatedAt: '2026-08-09T12:00:00.000Z' }
    const bookmark = {
      id: 'bookmark_1',
      applicationId: 'app_admission',
      type: 'outcome',
      title: 'Offer',
      data: {},
      note: null,
      createdAt: '2026-08-09T12:00:00.000Z',
      updatedAt: '2026-08-09T12:00:00.000Z',
    }
    const fetchMock = vi.fn((path: RequestInfo | URL, init?: RequestInit) => {
      const requestPath = String(path)
      const method = String(init?.method ?? 'GET').toUpperCase()
      if (requestPath.includes('/admission-signals')) {
        return Promise.resolve(envelope({ report }))
      }
      if (requestPath.startsWith('/api/admission-bookmarks') && method === 'GET') {
        return Promise.resolve(envelope({ bookmarks: [bookmark] }))
      }
      if (requestPath === '/api/admission-bookmarks' && method === 'POST') {
        return Promise.resolve(envelope({ bookmarkId: 'bookmark_2' }))
      }
      throw new Error(`Unexpected request: ${requestPath}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await phdApi.getAdmissionSignalReport('admission-cache-token', 'app_admission')
    await phdApi.getAdmissionSignalReport('admission-cache-token', 'app_admission')
    await phdApi.getAdmissionBookmarks('admission-cache-token', 'app_admission')
    await phdApi.getAdmissionBookmarks('admission-cache-token', 'app_admission')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await phdApi.createAdmissionBookmark('admission-cache-token', {
      applicationId: 'app_admission',
      type: 'outcome',
      title: 'Interview',
      data: {},
    })
    await phdApi.getAdmissionSignalReport('admission-cache-token', 'app_admission')
    await phdApi.getAdmissionBookmarks('admission-cache-token', 'app_admission')
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('bounds conditional response memory with least-recently-used eviction', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(envelope([])))
    vi.stubGlobal('fetch', fetchMock)

    for (let index = 0; index < 70; index += 1) {
      await phdApi.listNotifications('bounded-cache-token', {
        before: `2026-07-28T12:${String(index).padStart(2, '0')}:00.000Z`,
      })
    }
    expect(fetchMock).toHaveBeenCalledTimes(70)

    await phdApi.listNotifications('bounded-cache-token', {
      before: '2026-07-28T12:00:00.000Z',
    })
    expect(fetchMock).toHaveBeenCalledTimes(71)
  })

  it('advances the read-cache generation after a successful mutation', async () => {
    const firstAssets = [{ id: 'asset_1', name: 'First' }]
    const created = {
      id: 'asset_2',
      name: 'Second',
      kind: 'other',
      description: '',
      attachments: [],
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(envelope(firstAssets))
      .mockResolvedValueOnce(envelope(created))
      .mockResolvedValueOnce(envelope([...firstAssets, created]))
    vi.stubGlobal('fetch', fetchMock)

    await phdApi.listProfileAssets('mutation-cache-token')
    await phdApi.addProfileAsset('mutation-cache-token', {
      name: 'Second',
      kind: 'other',
      description: '',
    })
    await expect(phdApi.listProfileAssets('mutation-cache-token')).resolves.toHaveLength(2)

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('X-Phd-Client-Id')).toBeTruthy()
  })

  it('restarts an affected in-flight read instead of exposing stale data or an abort', async () => {
    const created = {
      id: 'asset_created',
      name: 'Created',
      kind: 'other',
      description: '',
      attachments: [],
    }
    const freshAssets = [created]
    let firstRead = true
    const fetchMock = vi.fn((path: RequestInfo | URL, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase()
      if (String(path) === '/api/profile-assets' && method === 'GET' && firstRead) {
        firstRead = false
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        })
      }
      if (String(path) === '/api/profile-assets' && method === 'POST') {
        return Promise.resolve(envelope(created))
      }
      return Promise.resolve(envelope(freshAssets))
    })
    vi.stubGlobal('fetch', fetchMock)

    const read = phdApi.listProfileAssets('mutation-race-token')
    await phdApi.addProfileAsset('mutation-race-token', {
      name: 'Created',
      kind: 'other',
      description: '',
    })

    await expect(read).resolves.toEqual(freshAssets)
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/profile-assets',
      '/api/profile-assets',
      '/api/profile-assets',
    ])
  })

  it('leaves unrelated in-flight reads alone after a successful mutation', async () => {
    let applicationSignal: AbortSignal | undefined
    let resolveApplications!: (response: Response) => void
    const fetchMock = vi.fn((path: RequestInfo | URL, init?: RequestInit) => {
      const requestPath = String(path)
      if (requestPath === '/api/applications') {
        applicationSignal = init?.signal ?? undefined
        return new Promise<Response>((resolve) => {
          resolveApplications = resolve
        })
      }
      if (requestPath === '/api/profile-assets') {
        return Promise.resolve(envelope({
          id: 'asset_scoped',
          name: 'Scoped asset',
          kind: 'other',
          description: '',
          attachments: [],
        }))
      }
      throw new Error(`Unexpected request: ${requestPath}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const applications = phdApi.listApplications('scoped-mutation-token')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await phdApi.addProfileAsset('scoped-mutation-token', {
      name: 'Scoped asset',
      kind: 'other',
      description: '',
    })

    expect(applicationSignal?.aborted).toBe(false)
    resolveApplications(envelope([{ id: 'app_unchanged' }]))
    await expect(applications).resolves.toEqual([{ id: 'app_unchanged' }])
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/applications')).toHaveLength(1)
  })

  it('restarts only reads covered by realtime scopes and leaves unrelated GETs in flight', async () => {
    let applicationAttempt = 0
    let applicationSignal: AbortSignal | undefined
    let notificationSignal: AbortSignal | undefined
    let resolveNotification!: (response: Response) => void
    const fetchMock = vi.fn((path: RequestInfo | URL, init?: RequestInit) => {
      const requestPath = String(path)
      if (requestPath === '/api/applications') {
        applicationAttempt += 1
        if (applicationAttempt === 1) {
          applicationSignal = init?.signal ?? undefined
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
          })
        }
        return Promise.resolve(envelope([{ id: 'app_after_realtime' }]))
      }
      if (requestPath === '/api/notifications/unread-count') {
        notificationSignal = init?.signal ?? undefined
        return new Promise<Response>((resolve) => {
          resolveNotification = resolve
        })
      }
      throw new Error(`Unexpected request: ${requestPath}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const applications = phdApi.listApplications('realtime-scope-token')
    const notifications = phdApi.unreadNotificationCount('realtime-scope-token')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    invalidateClientReadCacheForScopes(
      'realtime-scope-token',
      new Set(['applications']),
    )

    await expect(applications).resolves.toEqual([{ id: 'app_after_realtime' }])
    expect(applicationSignal?.aborted).toBe(true)
    expect(notificationSignal?.aborted).toBe(false)
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/applications')).toHaveLength(2)
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/notifications/unread-count')).toHaveLength(1)

    resolveNotification(envelope({ count: 3 }))
    await expect(notifications).resolves.toEqual({ count: 3 })
  })


  it('revalidates with the kept ETag after an invalidation instead of re-downloading', async () => {
    const body = { id: 'app_etag', program: 'Kept validator' }
    const path = '/api/applications/app_etag'
    const fetchMock = vi.fn((requestPath: RequestInfo | URL, init?: RequestInit) => {
      if (String(requestPath) !== path) throw new Error(`Unexpected request: ${String(requestPath)}`)
      const sent = new Headers(init?.headers)
      if (sent.get('If-None-Match') === 'W/"app-1"') {
        return Promise.resolve(new Response(null, { status: 304 }))
      }
      return Promise.resolve(envelope(body, undefined, { ETag: 'W/"app-1"' }))
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(phdApi.getApplication('etag-token', 'app_etag')).resolves.toEqual(body)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // A realtime echo says this record may have moved on. The body is no longer
    // trusted, but the validator still is: dropping it made the next read pull
    // the whole record down again to learn nothing had changed.
    invalidateClientReadCacheForScopes('etag-token', new Set(['applications']))

    await expect(phdApi.getApplication('etag-token', 'app_etag')).resolves.toEqual(body)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('If-None-Match')).toBe('W/"app-1"')
  })

  it('coalesces and retries a transient application-detail failure during navigation', async () => {
    const application = applicationFixture({ id: 'navigation-detail-retry' })
    const unavailable = new Response(JSON.stringify({
      ok: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'The focused application service is temporarily unavailable.',
      },
      requestId: 'navigation-detail-busy',
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(unavailable)
      .mockResolvedValueOnce(envelope(application))
    vi.stubGlobal('fetch', fetchMock)

    const first = phdApi.getApplicationForNavigation('navigation-token', application.id)
    const second = phdApi.getApplicationForNavigation('navigation-token', application.id)

    await expect(Promise.all([first, second])).resolves.toEqual([application, application])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.every(([path]) => (
      String(path) === '/api/applications/navigation-detail-retry'
    ))).toBe(true)
  })

  it('coalesces simultaneous scoped invalidations so each affected read restarts once per burst', async () => {
    const readAttempts = new Map<string, number>()
    const fetchMock = vi.fn((path: RequestInfo | URL, init?: RequestInit) => {
      const requestPath = String(path)
      const method = String(init?.method ?? 'GET').toUpperCase()
      if (
        method === 'GET'
        && (requestPath === '/api/profile-assets' || requestPath === '/api/ai/keys')
      ) {
        const attempt = (readAttempts.get(requestPath) ?? 0) + 1
        readAttempts.set(requestPath, attempt)
        if (attempt === 1) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
          })
        }
        return Promise.resolve(envelope([]))
      }
      if (requestPath === '/api/profile-assets' && method === 'POST') {
        return Promise.resolve(envelope({
          id: 'asset_burst',
          name: 'Burst asset',
          kind: 'other',
          description: '',
          attachments: [],
        }))
      }
      if (requestPath === '/api/ai/keys' && method === 'POST') {
        return Promise.resolve(envelope({ id: 'key_burst', label: 'Burst key' }))
      }
      throw new Error(`Unexpected request: ${requestPath}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const assets = phdApi.listProfileAssets('burst-token')
    const aiKeys = phdApi.listAiKeys('burst-token')
    await Promise.resolve()
    await Promise.all([
      phdApi.addProfileAsset('burst-token', {
        name: 'Burst asset',
        kind: 'other',
        description: '',
      }),
      phdApi.createAiKey('burst-token', {
        scope: 'personal',
        label: 'Burst key',
        provider: 'openai',
        model: 'gpt-5',
        apiKey: 'secret',
      }),
    ])

    await expect(Promise.all([assets, aiKeys])).resolves.toEqual([[], []])
    expect(readAttempts).toEqual(new Map([
      ['/api/profile-assets', 2],
      ['/api/ai/keys', 2],
    ]))
  })

  it('routes team student profile edits and deletes through the scoped member endpoint', async () => {
    const updated = {
      id: 'asset_student_1',
      ownerId: 'student_1',
      name: 'Updated research statement',
      kind: 'Research',
      description: 'Updated content',
      attachments: [],
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(envelope(updated))
      .mockResolvedValueOnce(envelope({ id: updated.id }))
    vi.stubGlobal('fetch', fetchMock)

    await phdApi.updateTeamMemberProfileAsset('teacher-token', 'team_1', 'student_1', updated.id, {
      name: updated.name,
      description: updated.description,
    })
    await phdApi.deleteTeamMemberProfileAsset('teacher-token', 'team_1', 'student_1', updated.id)

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/teams/team_1/members/student_1/profile-assets/asset_student_1')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify({
        name: updated.name,
        description: updated.description,
      }),
    })
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/teams/team_1/members/student_1/profile-assets/asset_student_1')
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'DELETE' })
  })

  it('parses authenticated realtime invalidation frames from a fetch stream', async () => {
    const frames = [
      'event: connected\ndata: {"type":"connected","scopes":[],"revision":0,"at":"2026-07-20T00:00:00.000Z"}\n\n',
      'event: invalidate\ndata: {"type":"invalidate","scopes":["applications","teams"],"revision":1,"at":"2026-07-20T00:00:01.000Z"}\n\n',
    ]
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        frames.forEach((frame) => controller.enqueue(encoder.encode(frame)))
        controller.close()
      },
    })
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const events: Array<{ type: string; scopes: string[] }> = []

    await phdApi.streamRealtimeUpdates('realtime-token', (event) => events.push(event))

    expect(events.map((event) => event.type)).toEqual(['connected', 'invalidate'])
    expect(events[1]?.scopes).toEqual(['applications', 'teams'])
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.get('Authorization')).toBe('Bearer realtime-token')
    expect(headers.get('X-Phd-Client-Id')).toBeTruthy()
    expect(headers.get('Accept')).toBe('text/event-stream')
  })

  it('requires an explicit terminal frame for an AI draft stream', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          'event: token\ndata: {"text":"Subject: Draft\\n\\nBody"}\n\n',
        ))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })))

    await expect(phdApi.streamAiDraft('draft-token', {
      keyId: 'key_1',
      applicationId: 'app_1',
      mode: 'compose',
      instructions: 'Write a concise draft.',
      grants: {
        userProfile: false,
        dossier: true,
        checklist: false,
        scholarships: false,
        tasks: false,
        correspondence: false,
      },
    }, () => undefined)).rejects.toMatchObject({ code: 'AI_STREAM_INCOMPLETE' })
  })

  it('preserves structured AI stream errors for actionable localization', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          'event: error\ndata: {"code":"EMPTY_DRAFT","message":"The AI provider did not return a draft."}\n\n',
        ))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })))
    const events: Array<{ type: string; code?: string }> = []

    await phdApi.streamAiDraft('draft-token', {
      keyId: 'key_1',
      applicationId: 'app_1',
      mode: 'compose',
      instructions: 'Write a concise draft.',
      grants: {
        userProfile: false,
        dossier: true,
        checklist: false,
        scholarships: false,
        tasks: false,
        correspondence: false,
      },
    }, (event) => events.push(event))

    expect(events).toEqual([expect.objectContaining({ type: 'error', code: 'EMPTY_DRAFT' })])
  })

  it('requires consecutive transport failures before opening the client circuit', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    await expect(phdApi.streamRealtimeUpdates('realtime-token', () => undefined)).rejects.toBeInstanceOf(TypeError)
    expect(getConnectivitySnapshot()).toMatchObject({
      serverReachable: true,
    })

    await expect(phdApi.streamRealtimeUpdates('realtime-token', () => undefined)).rejects.toBeInstanceOf(TypeError)
    expect(getConnectivitySnapshot()).toMatchObject({
      mode: 'checking',
      serverReachable: null,
    })
    await vi.advanceTimersByTimeAsync(CONNECTIVITY_OUTAGE_GRACE_MS)
    expect(getConnectivitySnapshot()).toMatchObject({
      mode: 'server-unreachable',
      serverReachable: false,
    })
  })

  it('drops a frame that finishes reading after its realtime request is aborted', async () => {
    let releaseRead!: (result: ReadableStreamReadResult<Uint8Array>) => void
    const reader = {
      cancel: vi.fn().mockResolvedValue(undefined),
      read: vi.fn(
        () =>
          new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
            releaseRead = resolve
          }),
      ),
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'text/event-stream' }),
        body: { getReader: () => reader },
      } as unknown as Response),
    )
    const controller = new AbortController()
    const events: Array<{ type: string }> = []
    const request = phdApi.streamRealtimeUpdates('realtime-token', (event) => events.push(event), controller.signal)
    await vi.waitFor(() => expect(reader.read).toHaveBeenCalledTimes(1))

    controller.abort()
    releaseRead({
      done: false,
      value: new TextEncoder().encode(
        'event: invalidate\ndata: {"type":"invalidate","scopes":["applications"],"revision":1,"at":"2026-07-20T00:00:01.000Z"}\n\n',
      ),
    })

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(events).toEqual([])
    expect(reader.cancel).toHaveBeenCalled()
  })

  it('times out stalled API requests instead of leaving callers pending', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_path: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
          }),
      ),
    )

    const request = phdApi.captcha()
    const assertion = expect(request).rejects.toMatchObject({
      code: 'REQUEST_TIMEOUT',
      status: 408,
    })
    await vi.advanceTimersByTimeAsync(20_000)

    await assertion
    expect(getConnectivitySnapshot()).toMatchObject({
      mode: 'online',
      serverReachable: true,
    })

    const secondRequest = phdApi.captcha()
    const secondAssertion = expect(secondRequest).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(20_000)
    await secondAssertion
    expect(getConnectivitySnapshot()).toMatchObject({
      mode: 'checking',
      serverReachable: null,
    })
    await vi.advanceTimersByTimeAsync(CONNECTIVITY_OUTAGE_GRACE_MS)
    expect(getConnectivitySnapshot()).toMatchObject({
      mode: 'server-unreachable',
      serverReachable: false,
    })
  })

  it('keeps the timeout active while a response body is stalled after headers', async () => {
    vi.useFakeTimers()
    const cancelBody = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        body: { cancel: cancelBody },
        json: () => new Promise<never>(() => undefined),
      } as unknown as Response),
    )

    const request = phdApi.captcha()
    const assertion = expect(request).rejects.toMatchObject({
      code: 'REQUEST_TIMEOUT',
      status: 408,
    })
    await vi.advanceTimersByTimeAsync(20_000)

    await assertion
    expect(cancelBody).toHaveBeenCalled()
  })

  it('rejects a stalled authenticated download when the account changes after headers', async () => {
    const cancelBody = vi.fn().mockResolvedValue(undefined)
    const readBlob = vi.fn(() => new Promise<Blob>(() => undefined))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        body: { cancel: cancelBody },
        blob: readBlob,
      } as unknown as Response),
    )

    const request = phdApi.downloadFile(jwtFor('user_demo', 'download-stale'), 'file-1')
    await vi.waitFor(() => expect(readBlob).toHaveBeenCalledTimes(1))
    clearClientSessionCaches()

    await expect(request).rejects.toMatchObject({ code: 'SESSION_SUPERSEDED' })
    expect(cancelBody).toHaveBeenCalled()
  })

  it('uses the shared blob transport for downloads without JSON content headers', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response('file-content', {
        status: 200,
        headers: new Headers({ 'X-Session-Token': 'blob-token-2' }),
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const blob = await phdApi.downloadFile('blob-token-1', 'file 1')

    expect(await blob.text()).toBe('file-content')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/files/file%201/download')
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.get('Authorization')).toBe('Bearer blob-token-1')
    expect(headers.get('Content-Type')).toBeNull()
    expect(headers.get('Accept')).toBe('application/octet-stream')
    expect(getLatestSessionToken('blob-token-1')).toBe('blob-token-2')
  })

  it('binds every first-run transport to the claimed browser and exact request body', async () => {
    const claim = {
      token: 'short-lived-test-claim',
      expiresAt: '2026-07-28T14:00:00.000Z',
      expiresInSeconds: 7200,
    }
    const secrets = {
      autoGenerated: true,
      jwtSecretPreview: 'preview-only',
      encryptionKeyPreview: 'preview-only',
    }
    const smtpInput: Parameters<typeof phdApi.sendInitialSetupSmtpVerification>[0] = {
      notificationMailbox: 'admin@example.test',
      smtpHost: 'smtp.example.test',
      smtpPort: 587,
      smtpUser: 'admin@example.test',
      smtpPass: 'test-only-smtp-password',
      smtpTls: true,
      language: 'en',
    }
    const setupInput: Parameters<typeof phdApi.completeInitialSetup>[0] = {
      name: 'Test Administrator',
      email: 'admin@example.test',
      password: 'test-only-password-long-enough',
      adminEntryHidden: false,
      notificationMailbox: smtpInput.notificationMailbox,
      smtpHost: smtpInput.smtpHost,
      smtpPort: smtpInput.smtpPort,
      smtpUser: smtpInput.smtpUser,
      smtpPass: smtpInput.smtpPass,
      smtpTls: smtpInput.smtpTls,
      smtpVerificationToken: 'verified-mail-token',
      language: 'en',
      database: { type: 'sqlite' },
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope(claim))
      .mockResolvedValueOnce(envelope(secrets))
      .mockResolvedValueOnce(envelope({ token: 'mail-token', expiresInSeconds: 600 }))
      .mockResolvedValueOnce(envelope({ verified: true, token: 'verified-mail-token' }))
      .mockResolvedValueOnce(envelope({ token: 'session-token', user: {}, settings: {} }))
    vi.stubGlobal('fetch', fetchMock)

    const operatorToken = 'test-only-bootstrap-operator-token-32'
    await expect(phdApi.claimInitialSetup(operatorToken)).resolves.toEqual(claim)
    await expect(phdApi.initialSetupSecrets(claim.token)).resolves.toEqual(secrets)
    await phdApi.sendInitialSetupSmtpVerification(smtpInput, claim.token)
    await phdApi.verifyInitialSetupSmtpVerification({
      ...smtpInput,
      token: 'mail-token',
      code: '123456',
    }, claim.token)
    await phdApi.completeInitialSetup(setupInput, claim.token)

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/setup/claim')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ token: operatorToken }),
    })
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/setup/secrets')
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/setup/smtp-verification/send')
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify(smtpInput) })
    expect(fetchMock.mock.calls[3]?.[0]).toBe('/api/setup/smtp-verification/check')
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ ...smtpInput, token: 'mail-token', code: '123456' }),
    })
    expect(fetchMock.mock.calls[4]?.[0]).toBe('/api/setup')
    expect(fetchMock.mock.calls[4]?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify(setupInput) })
    for (const [, init] of fetchMock.mock.calls) {
      const headers = new Headers(init?.headers)
      expect(headers.get('X-Phd-Client-Id')).toBeTruthy()
    }
    for (const callIndex of [1, 2, 3, 4]) {
      expect(new Headers(fetchMock.mock.calls[callIndex]?.[1]?.headers).get('X-PhD-Bootstrap-Claim')).toBe(claim.token)
    }
  })

  it('sends the active interface language with localized PDF exports', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('pdf-content', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await phdApi.downloadExport('pdf-token', 'pdf', 'app 1', 'zh')

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/exports?format=pdf&applicationId=app+1&language=zh')
  })

  it('downloads an authored profile document in the selected format and language', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('word-content', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await phdApi.downloadProfileAssetExport('profile-token', 'asset 1', 'word', 'zh')

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/profile-assets/asset%201/export?format=word&language=zh')
  })

  it('lets the browser set multipart headers for upload requests', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      envelope({
        received: true,
        fileName: 'update.tar.gz',
        size: 1,
        storedAs: 'system-update.tar.gz',
        message: 'ok',
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await phdApi.uploadSystemUpdate('upload-token', new File(['x'], 'update.tar.gz'))

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.get('Authorization')).toBe('Bearer upload-token')
    expect(headers.get('Content-Type')).toBeNull()
  })

  it('checks and installs only the selected server-owned GitHub Release tag', async () => {
    const check = {
      currentVersion: '0.1.0-beta.1',
      updateAvailable: true,
      release: {
        version: '0.1.0-beta.2',
        tagName: 'v0.1.0-beta.2',
      },
      checkedAt: '2026-07-23T12:00:00.000Z',
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(envelope(check))
      .mockResolvedValueOnce(
        envelope({
          received: true,
          fileName: 'phd-atlas-update-0.1.0-beta.2.tar.gz',
          size: 1024,
          storedAs: 'phd-atlas-update-0.1.0-beta.2.tar.gz',
          version: '0.1.0-beta.2',
          verified: true,
          restartScheduled: true,
          message: 'ok',
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(phdApi.checkSystemUpdate('admin-token')).resolves.toEqual(check)
    await phdApi.installReleaseUpdate('admin-token', 'v0.1.0-beta.2')

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/admin/system-update/check')
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/admin/system-update/install-release')
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'POST' })
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      tagName: 'v0.1.0-beta.2',
    })
  })

  it('reads the persisted server-side update log with a bounded entry limit', async () => {
    const logs = {
      fileName: 'system-update.log.jsonl',
      entries: [],
    }
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope(logs))
    vi.stubGlobal('fetch', fetchMock)

    await expect(phdApi.systemUpdateLogs('admin-token', 25)).resolves.toEqual(logs)

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/admin/system-update/logs?limit=25')
  })

  it('sends every selected attachment in one multipart request', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope({ id: 'material-1', versions: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await phdApi.uploadMaterialFiles('upload-token', 'app 1', 'material 1', [
      new File(['a'], 'proposal.pdf', { type: 'application/pdf' }),
      new File(['b'], 'appendix.pdf', { type: 'application/pdf' }),
    ])

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/applications/app 1/materials/material 1/file')
    const body = fetchMock.mock.calls[0]?.[1]?.body
    expect(body).toBeInstanceOf(FormData)
    expect((body as FormData).getAll('file').map((entry) => (entry as File).name)).toEqual([
      'proposal.pdf',
      'appendix.pdf',
    ])
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.get('Content-Type')).toBeNull()
  })

  it('posts passkey login options and verification without an existing session token', async () => {
    const options = { challenge: 'challenge_login', rpId: 'localhost' }
    const assertion = {
      id: 'credential_1',
      response: { clientDataJSON: 'client' },
    }
    const session = { token: 'passkey-session', user: { id: 'user_1' } }
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope({ options })).mockResolvedValueOnce(envelope(session))
    vi.stubGlobal('fetch', fetchMock)

    await expect(phdApi.beginPasskeyLogin(' jasper@example.com ')).resolves.toEqual({ options })
    await expect(phdApi.finishPasskeyLogin(assertion)).resolves.toEqual(session)

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/passkeys/login/options')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      email: ' jasper@example.com ',
      scope: 'app',
    })
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Authorization')).toBeNull()
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/auth/passkeys/login/verify')
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      response: assertion,
      scope: 'app',
    })
  })

  it('uses bearer auth for passkey management requests', async () => {
    const options = {
      challenge: 'challenge_register',
      rp: { name: 'PhD Atlas' },
    }
    const passkeys = [{ id: 'passkey_1', label: 'Laptop', transports: ['internal'] }]
    const attestation = {
      id: 'credential_1',
      response: { attestationObject: 'attestation' },
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(envelope(passkeys))
      .mockResolvedValueOnce(envelope({ options }))
      .mockResolvedValueOnce(envelope(passkeys))
      .mockResolvedValueOnce(envelope({ id: 'passkey_1' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(phdApi.listPasskeys('manage-token')).resolves.toEqual(passkeys)
    await expect(phdApi.beginPasskeyRegistration('manage-token', 'Laptop')).resolves.toEqual({ options })
    await expect(phdApi.finishPasskeyRegistration('manage-token', attestation, 'Laptop')).resolves.toEqual(passkeys)
    await expect(phdApi.deletePasskey('manage-token', 'passkey 1')).resolves.toEqual({ id: 'passkey_1' })

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/auth/passkeys',
      '/api/auth/passkeys/register/options',
      '/api/auth/passkeys/register/verify',
      '/api/auth/passkeys/passkey%201',
    ])
    for (const call of fetchMock.mock.calls) {
      expect(new Headers(call[1]?.headers).get('Authorization')).toBe('Bearer manage-token')
    }
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      label: 'Laptop',
    })
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      response: attestation,
      label: 'Laptop',
    })
  })

  it('keeps Codex authorization management and device approval contracts explicit', async () => {
    const authorization = {
      id: 'codex-auth-1',
      name: 'Research laptop',
      clientName: 'Codex Desktop',
      deviceName: 'Lab Surface',
      scopeVersion: 2,
      scopes: ['applications:read'],
      createdAt: '2026-08-01T09:00:00.000Z',
      lastUsedAt: null,
      expiresAt: '2027-08-01T09:00:00.000Z',
      revokedAt: null,
      disabledAt: null,
      status: 'active',
      tokenHint: 'phda_cdx_••••9K2F',
    } as const
    const preview = {
      id: 'device-auth-1',
      status: 'pending',
      clientName: 'Codex CLI',
      deviceName: 'Workstation',
      scopeVersion: 2,
      requestedScopes: ['applications:read'],
      requestedExpiresInDays: 365,
      expiresAt: '2027-08-01T09:00:00.000Z',
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(envelope([authorization]))
      .mockResolvedValueOnce(envelope({ authorization, token: 'one-time-token' }))
      .mockResolvedValueOnce(envelope({ authorization: { ...authorization, name: 'Office Codex' } }))
      .mockResolvedValueOnce(envelope({ authorization: { ...authorization, status: 'revoked' } }))
      .mockResolvedValueOnce(envelope(preview))
      .mockResolvedValueOnce(envelope({ deviceAuthorization: { ...preview, status: 'approved' } }))
      .mockResolvedValueOnce(envelope({ deviceAuthorization: { ...preview, status: 'denied' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(phdApi.listCodexAuthorizations('manage-token')).resolves.toEqual([authorization])
    await expect(phdApi.createCodexAuthorization('manage-token', {
      name: 'Research laptop',
      scopeVersion: 2,
      scopes: ['applications:read'],
    })).resolves.toEqual({ authorization, token: 'one-time-token' })
    await expect(phdApi.updateCodexAuthorization('manage-token', 'codex auth/1', 'Office Codex'))
      .resolves.toMatchObject({ name: 'Office Codex' })
    await expect(phdApi.deleteCodexAuthorization('manage-token', 'codex auth/1'))
      .resolves.toMatchObject({ id: authorization.id, status: 'revoked' })
    await expect(phdApi.previewCodexDeviceAuthorization('manage-token', 'ABCD EFGH')).resolves.toEqual(preview)
    await expect(phdApi.approveCodexDeviceAuthorization('manage-token', 'ABCD EFGH'))
      .resolves.toMatchObject({ deviceAuthorization: { status: 'approved' } })
    await expect(phdApi.denyCodexDeviceAuthorization('manage-token', 'ABCD EFGH'))
      .resolves.toMatchObject({ deviceAuthorization: { status: 'denied' } })

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/codex/authorizations',
      '/api/codex/authorizations',
      '/api/codex/authorizations/codex%20auth%2F1',
      '/api/codex/authorizations/codex%20auth%2F1',
      '/api/codex/device-authorizations/ABCD%20EFGH',
      '/api/codex/device-authorizations/ABCD%20EFGH/approve',
      '/api/codex/device-authorizations/ABCD%20EFGH/deny',
    ])
    for (const call of fetchMock.mock.calls) {
      expect(new Headers(call[1]?.headers).get('Authorization')).toBe('Bearer manage-token')
    }
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      name: 'Research laptop',
      scopeVersion: 2,
      scopes: ['applications:read'],
    })
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({ name: 'Office Codex' })
    expect(fetchMock.mock.calls[5]?.[1]?.body).toBeUndefined()
    expect(fetchMock.mock.calls[6]?.[1]?.body).toBeUndefined()
  })

  it('keeps system-mail transport explicit for receiving-mailbox tests', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      envelope({
        sent: true,
        delivery: 'research@example.com',
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      phdApi.sendTestEmail('mail-token', {
        delivery: 'research@example.com',
        source: 'system',
      }),
    ).resolves.toEqual({ sent: true, delivery: 'research@example.com' })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/settings/test-email')
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer mail-token')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      delivery: 'research@example.com',
      source: 'system',
    })
  })

  it('starts Discover research with an explicit AI key and team student scope', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope({ job: { id: 'research-1' } }))
    vi.stubGlobal('fetch', fetchMock)

    await phdApi.runDiscoverResearch('discover-token', {
      notify: true,
      useAi: true,
      keyId: 'key-primary',
      keyIds: ['key-primary', 'key-verifier'],
      teamId: 'team-1',
      targetUserId: 'student-1',
      acceptSuggestions: true,
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/discover/research/start')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      notify: true,
      useAi: true,
      keyId: 'key-primary',
      keyIds: ['key-primary', 'key-verifier'],
      teamId: 'team-1',
      targetUserId: 'student-1',
      acceptSuggestions: true,
    })
  })

  it('deletes Discover program results with the active team student scope', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      envelope({
        state: {},
        programs: [],
        pis: [],
        stats: {},
        ranked: [],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await phdApi.deleteDiscoverPrograms('discover-token', {
      ids: ['program-1', 'program-2'],
      teamId: 'team-1',
      targetUserId: 'student-1',
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/discover/programs/delete')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' })
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      ids: ['program-1', 'program-2'],
      teamId: 'team-1',
      targetUserId: 'student-1',
    })
  })

  it('sends receiving-mailbox verification through its dedicated API', async () => {
    const result = {
      user: { id: 'user-1' },
      verificationSentAt: '2026-07-18T12:00:00.000Z',
      retryAt: '2026-07-18T12:01:00.000Z',
    }
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope(result))
    vi.stubGlobal('fetch', fetchMock)

    await expect(phdApi.sendReceiveEmailVerification('mail-token', 'receive@example.com')).resolves.toEqual(result)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/settings/receive-email-verification')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      email: 'receive@example.com',
    })
  })

  it('passes the chosen recipient to the administrator system-mail test', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope({ sent: true, delivery: 'qa@example.com' }))
    vi.stubGlobal('fetch', fetchMock)

    await phdApi.sendAdminTestEmail('admin-token', 'qa@example.com')

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/admin/settings/test-email')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      delivery: 'qa@example.com',
    })
  })

  it('falls back to main-thread JSON parsing when the parser worker reports an error', async () => {
    const workerPostMessage = vi.fn()
    class FailingJsonWorker {
      private listeners = new Map<string, Array<(event: MessageEvent) => void>>()

      addEventListener(type: string, listener: (event: MessageEvent) => void) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
      }

      postMessage(message: { id: number }) {
        workerPostMessage(message.id)
        queueMicrotask(() => {
          for (const listener of this.listeners.get('message') ?? []) {
            listener({
              data: { id: message.id, error: 'worker failed' },
            } as MessageEvent)
          }
        })
      }

      terminate() {}
    }

    const largeApplication = { id: 'large-app', padding: 'x'.repeat(300_000) }
    vi.stubGlobal('Worker', FailingJsonWorker)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(envelope(largeApplication)))

    await expect(phdApi.getApplication('large-json-token', largeApplication.id)).resolves.toEqual(largeApplication)
    expect(workerPostMessage).toHaveBeenCalledOnce()
  })

  it('reloads an application collection above 16 MiB through bounded workspace sections', async () => {
    const applications = Array.from({ length: 17 }, (_, index) => ({
      id: `large-app-${index}`,
      school: { name: `Large University ${index}` },
      notes: `${index}:`.padEnd(1_000_000, 'x'),
    }))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(responseTooLarge())
      .mockResolvedValueOnce(workspaceSectionStream({ applications }, { revision: 21 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(phdApi.listApplications('large-workspace-token')).resolves.toEqual(applications)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map(([path]) => String(path))).toEqual([
      '/api/applications',
      '/api/workspace/bootstrap/stream?sections=applications',
    ])
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('Accept')).toBe('application/x-ndjson')
  })

  it('discards partial sections and restarts atomically when the workspace revision changes', async () => {
    const staleApplication = { id: 'stale-app', school: { name: 'Stale University' } }
    const freshApplication = { id: 'fresh-app', school: { name: 'Fresh University' } }
    const basePayload = {
      me: { user: { id: 'user-1' }, settings: {}, mailFetchStatus: {} },
      profileAssets: [],
      backups: [],
      applicationTrash: [],
      teamWorkspaces: [],
      activeTeamId: null,
      teamSummary: null,
      teamApplications: [],
      aiKeys: [],
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(workspaceSectionStream(
        { ...basePayload, applications: [staleApplication] },
        {
          revision: 31,
          restartAfterSections: 2,
          restartRevision: 32,
          restartCode: 'WORKSPACE_REVISION_CHANGED',
        },
      ))
      .mockResolvedValueOnce(workspaceSectionStream(
        { ...basePayload, applications: [freshApplication] },
        { revision: 32 },
      ))
    vi.stubGlobal('fetch', fetchMock)

    const bootstrap = await phdApi.workspaceBootstrap('revision-safe-token')
    expect(bootstrap.applications).toEqual([freshApplication])
    // Conditional section caches are primed only after the final completion
    // marker, so the stale partial application can never escape this request.
    await expect(phdApi.listApplications('revision-safe-token')).resolves.toEqual([freshApplication])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map(([path]) => String(path))).toEqual([
      '/api/workspace/bootstrap/stream',
      '/api/workspace/bootstrap/stream',
    ])
  })

  it('rejects restart frames that are not part of the current stream protocol', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(responseTooLarge())
      .mockResolvedValueOnce(workspaceSectionStream(
        { applications: [{ id: 'unsupported-restart-app' }] },
        {
          restartAfterSections: 1,
          restartCode: 'OUTDATED_SERVER_RESTART',
        },
      ))
    vi.stubGlobal('fetch', fetchMock)

    await expect(phdApi.listApplications('workspace-current-protocol-token')).rejects.toMatchObject({
      code: 'WORKSPACE_SECTION_STREAM_INVALID',
      status: 502,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('backs off with jitter for stream capacity restarts and preserves the final request reference', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const payload = { applications: [{ id: 'busy-app' }] }
    const busyResponse = () => workspaceSectionStream(payload, {
      revision: 33,
      restartAfterSections: 1,
      restartRevision: 33,
      restartCode: 'SERVER_BUSY',
      retryAfterMs: 1_200,
      requestId: 'workspace-busy-reference',
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(responseTooLarge())
      .mockImplementationOnce(async () => busyResponse())
      .mockImplementationOnce(async () => busyResponse())
      .mockImplementationOnce(async () => busyResponse())
    vi.stubGlobal('fetch', fetchMock)

    const request = phdApi.listApplications('workspace-busy-token')
    const outcome = request.catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // 1,200 ms server floor + deterministic 150 ms jitter. No synchronized
    // immediate reopen is allowed before that complete delay.
    await vi.advanceTimersByTimeAsync(1_349)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1_350)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    await expect(outcome).resolves.toMatchObject({
      code: 'SERVER_BUSY',
      requestId: 'workspace-busy-reference',
      retryAfterMs: 1_200,
      retryExhausted: true,
      status: 503,
    })
  })

  it('returns a whole-response workspace 503 to the outer recovery owner without nested retries', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      error: {
        code: 'SERVER_BUSY',
        message: 'The workspace is temporarily at capacity.',
      },
      requestId: 'workspace-http-busy-reference',
    }), {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': '1',
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(phdApi.workspaceBootstrap('workspace-http-busy-token')).rejects.toMatchObject({
      code: 'SERVER_BUSY',
      requestId: 'workspace-http-busy-reference',
      retryAfterMs: 1_000,
      status: 503,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/workspace/bootstrap/stream')
  })

  it('cancels a stream capacity backoff when the caller aborts', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(responseTooLarge())
      .mockResolvedValue(workspaceSectionStream(
        { applications: [{ id: 'busy-app' }] },
        {
          revision: 34,
          restartAfterSections: 1,
          restartRevision: 34,
          restartCode: 'MEMORY_PRESSURE',
          retryAfterMs: 1_000,
        },
      ))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    const request = phdApi.listApplications('workspace-abort-token', { signal: controller.signal })
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    controller.abort(new DOMException('caller left', 'AbortError'))
    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    await vi.runAllTimersAsync()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('cancels a stream capacity backoff when the authenticated session generation changes', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(responseTooLarge())
      .mockResolvedValue(workspaceSectionStream(
        { applications: [{ id: 'busy-app' }] },
        {
          revision: 35,
          restartAfterSections: 1,
          restartRevision: 35,
          restartCode: 'SERVER_BUSY',
          retryAfterMs: 1_000,
        },
      ))
    vi.stubGlobal('fetch', fetchMock)

    const request = phdApi.listApplications('workspace-session-change-token')
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    clearClientSessionCaches()
    await expect(request).rejects.toMatchObject({ code: 'SESSION_SUPERSEDED' })
    await vi.runAllTimersAsync()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects an invalid stream retry hint without reopening the transport', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(responseTooLarge())
      .mockResolvedValue(workspaceSectionStream(
        { applications: [{ id: 'busy-app' }] },
        {
          revision: 35,
          restartAfterSections: 1,
          restartRevision: 35,
          restartCode: 'SERVER_BUSY',
          retryAfterMs: '1000',
        },
      ))
    vi.stubGlobal('fetch', fetchMock)

    await expect(phdApi.listApplications('workspace-invalid-retry-token')).rejects.toMatchObject({
      code: 'WORKSPACE_SECTION_STREAM_INVALID',
      status: 502,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('revalidates a completed sectional snapshot and reuses it only after a server 304', async () => {
    const payload = {
      me: { user: { id: 'conditional-user' }, settings: {}, mailFetchStatus: {} },
      applications: [{ id: 'conditional-app' }],
      profileAssets: [],
      backups: [],
      applicationTrash: [],
      teamWorkspaces: [],
      activeTeamId: null,
      teamSummary: null,
      teamApplications: [],
      aiKeys: [],
    }
    const etag = '"workspace-sections-1"'
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(workspaceSectionStream(payload, { revision: 41, etag }))
      .mockResolvedValueOnce(new Response(null, { status: 304, headers: { ETag: etag } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(phdApi.workspaceBootstrap('conditional-stream-token')).resolves.toEqual(payload)
    now.mockReturnValue(2_100)
    await expect(phdApi.workspaceBootstrap('conditional-stream-token')).resolves.toEqual(payload)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('If-None-Match')).toBeNull()
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('If-None-Match')).toBe(etag)
  })

  it('uses sectional fallbacks for large Profile, Trash, Team, and Interview aggregates', async () => {
    const profileAssets = [{ id: 'profile-large', name: 'Large statement', description: 'x'.repeat(300_000) }]
    const applicationTrash = [{
      id: 'trash-large',
      deletedAt: '2026-08-02T17:00:00.000Z',
      expiresAt: '2026-09-02T17:00:00.000Z',
      application: { id: 'deleted-large', notes: 'x'.repeat(300_000) },
    }]
    const teamApplications = [{ id: 'team-app-large', ownerId: 'student-1', teamId: 'team-1' }]
    const teamMemberProfileAssets = [{
      id: 'student-profile-large',
      ownerId: 'student-1',
      teamId: 'team-1',
      name: 'Research statement',
      description: 'x'.repeat(300_000),
    }]
    const interviewWorkspace = {
      subjectUserId: 'student-1',
      subjectName: 'Student One',
      revision: 7,
      interviews: [],
      questions: [],
      mockSessions: [],
      feedback: [],
      updatedAt: '2026-08-02T18:00:00.000Z',
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(responseTooLarge())
      .mockResolvedValueOnce(workspaceSectionStream({ profileAssets }, { revision: 41 }))
      .mockResolvedValueOnce(responseTooLarge())
      .mockResolvedValueOnce(workspaceSectionStream({ applicationTrash }, { revision: 41 }))
      .mockResolvedValueOnce(responseTooLarge())
      .mockResolvedValueOnce(workspaceSectionStream({ teamApplications }, { revision: 41 }))
      .mockResolvedValueOnce(responseTooLarge())
      .mockResolvedValueOnce(workspaceSectionStream({ teamMemberProfileAssets }, { revision: 41 }))
      .mockResolvedValueOnce(responseTooLarge())
      .mockResolvedValueOnce(workspaceSectionStream({ interviewWorkspace }, { revision: 41 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(phdApi.listProfileAssets('section-family-token')).resolves.toEqual(profileAssets)
    await expect(phdApi.listApplicationTrash('section-family-token')).resolves.toEqual(applicationTrash)
    await expect(phdApi.listTeamApplications('section-family-token', 'team-1')).resolves.toEqual(teamApplications)
    await expect(phdApi.listTeamMemberProfileAssets(
      'section-family-token',
      'team-1',
      'student-1',
    )).resolves.toEqual(teamMemberProfileAssets)
    await expect(phdApi.getInterviewPrepWorkspace('section-family-token', {
      subjectUserId: 'student-1',
      teamId: 'team-1',
    })).resolves.toEqual(interviewWorkspace)

    expect(fetchMock.mock.calls.map(([path]) => String(path))).toEqual([
      '/api/profile-assets',
      '/api/workspace/bootstrap/stream?sections=profileAssets',
      '/api/applications/trash',
      '/api/workspace/bootstrap/stream?sections=applicationTrash',
      '/api/teams/mine/applications?teamId=team-1',
      '/api/workspace/bootstrap/stream?teamId=team-1&sections=teamApplications',
      '/api/teams/team-1/members/student-1/profile-assets',
      '/api/workspace/bootstrap/stream?teamId=team-1&subjectUserId=student-1&sections=teamMemberProfileAssets',
      '/api/interview-prep/workspace?subjectUserId=student-1&teamId=team-1',
      '/api/workspace/bootstrap/stream?teamId=team-1&subjectUserId=student-1&sections=interviewWorkspace',
    ])
  })

  it('persists manual mail categories and preserves an explicit clear', async () => {
    const categorized = [{ id: 'mail-1', type: 'email', mailCategoryOverride: 'interview_invite' }]
    const cleared = [{ id: 'mail-1', type: 'email', mailCategoryOverride: null }]
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(envelope({ communications: categorized }))
      .mockResolvedValueOnce(envelope({ communications: cleared }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      phdApi.setCommunicationCategories('mail-token', 'app-1', {
        communicationIds: ['mail-1', 'mail-2'],
        categories: ['interview_invite', 'funding'],
        category: 'interview_invite',
      }, { idempotencyKey: 'manual-category-request-1' }),
    ).resolves.toEqual({ communications: categorized })
    await expect(
      phdApi.setCommunicationCategories('mail-token', 'app-1', {
        communicationIds: ['mail-1'],
        categories: [],
        category: null,
      }, { idempotencyKey: 'manual-category-request-2' }),
    ).resolves.toEqual({ communications: cleared })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/applications/app-1/communications/categories')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'PATCH' })
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer mail-token')
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Idempotency-Key'))
      .toBe('manual-category-request-1')
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('Idempotency-Key'))
      .toBe('manual-category-request-2')
    // The list is authoritative; `category` still carries the primary built-in
    // so a reader of the earlier single-valued shape shows something.
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      communicationIds: ['mail-1', 'mail-2'],
      categories: ['interview_invite', 'funding'],
      category: 'interview_invite',
    })
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      communicationIds: ['mail-1'],
      categories: [],
      category: null,
    })
  })

  it('starts AI mail classification with the selected key and force policy', async () => {
    const communications = [
      {
        id: 'mail-1',
        type: 'email',
        mailClassification: {
          category: 'offer',
          confidence: 0.98,
          summary: 'The department made an offer.',
          evidence: ['offer of admission'],
          actions: ['reply'],
          source: 'ai',
          classifiedAt: '2026-08-02T12:00:00.000Z',
          inputHash: 'sha256:mail-1',
          version: 1,
        },
      },
    ]
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope({ communications }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      phdApi.classifyCommunications('ai-token', 'app-1', {
        communicationIds: ['mail-1'],
        keyId: 'key-primary',
        force: true,
      }, { idempotencyKey: 'ai-classification-request-1' }),
    ).resolves.toEqual({ communications })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/applications/app-1/communications/classify')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' })
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer ai-token')
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Idempotency-Key'))
      .toBe('ai-classification-request-1')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      communicationIds: ['mail-1'],
      keyId: 'key-primary',
      force: true,
    })
  })

  it('posts an Interview Prep AI follow-up to the strict mock-turn route', async () => {
    const followUp = [{
      id: 'question-follow-up-1',
      interviewId: 'interview-1',
      category: 'research',
      prompt: 'How did you verify that result is reproducible?',
      source: 'ai',
      createdByUserId: 'user-1',
      order: 2,
      notes: '',
      createdAt: '2026-08-02T12:00:00.000Z',
      updatedAt: '2026-08-02T12:00:00.000Z',
    }]
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope(followUp))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      phdApi.generateInterviewMockTurn('interview-token', {
        subjectUserId: 'user-1',
        teamId: 'team-1',
        keyId: 'key-1',
        interview: { id: 'interview-1' } as unknown as InterviewEvent,
        session: { id: 'mock-1' } as unknown as InterviewMockSession,
        questions: [],
      }),
    ).resolves.toEqual(followUp)

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/interview-prep/ai/mock-turn')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' })
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer interview-token')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      subjectUserId: 'user-1',
      teamId: 'team-1',
      keyId: 'key-1',
      interview: { id: 'interview-1' } as unknown as InterviewEvent,
      session: { id: 'mock-1' } as unknown as InterviewMockSession,
      questions: [],
    })
  })

  it('posts an admin workspace restore to the encoded backup file route', async () => {
    const result = {
      restored: true,
      fileName: 'phd atlas 2026-08-04.tar.gz',
      format: 'sqlite-uploads-v1',
    }
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope(result))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      phdApi.restoreAdminBackup('admin-token', 'phd atlas 2026-08-04.tar.gz'),
    ).resolves.toEqual(result)

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/admin/backups/phd%20atlas%202026-08-04.tar.gz/restore',
    )
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' })
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Authorization'))
      .toBe('Bearer admin-token')
  })
})
