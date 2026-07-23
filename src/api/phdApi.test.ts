import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearClientSessionCaches,
  getLatestSessionToken,
  phdApi,
  readSessionTokenSubject,
  sessionIdentityMatches,
  setSessionTokenHandler,
  setUnauthorizedHandler,
} from './phdApi'
import { getConnectivitySnapshot, reportApiReachable } from '../connectivity'
import type { ApplicationRecord } from '../data/applications'

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

function jwtFor(sub: string, label: string) {
  const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  const payload = btoa(JSON.stringify({ sub, label }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  return `${header}.${payload}.sig`
}

describe('phdApi session token tracking', () => {
  afterEach(() => {
    setSessionTokenHandler(null)
    setUnauthorizedHandler(null)
    clearClientSessionCaches()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('surfaces a gateway failure as an unavailable Atlas server', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 502 })))

    await expect(phdApi.login('jasper@example.com', 'demo123456')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'SERVER_UNAVAILABLE',
      status: 502,
    })
  })

  it('preserves structured external-service failures instead of reporting Atlas as offline', async () => {
    reportApiReachable()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: false,
        error: {
          code: 'SMTP_AUTH_FAILED',
          message: 'The SMTP server rejected the saved credentials.',
        },
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: false,
        error: {
          code: 'MAIL_FETCH_CONNECTION_FAILED',
          message: 'The IMAP server could not be reached.',
        },
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }))
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

  it('keeps refreshed session tokens scoped to the request token that produced them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(envelope({
      user: null,
      settings: null,
      mailFetchStatus: null,
    }, 'source-token-refreshed')))

    await phdApi.me('source-token')

    expect(getLatestSessionToken('source-token')).toBe('source-token-refreshed')
    expect(getLatestSessionToken('fresh-login-token')).toBe('fresh-login-token')
  })

  it('refuses to chain a refreshed token that belongs to a different account', async () => {
    const demoToken = jwtFor('user_demo', 'demo-source')
    const teacherToken = jwtFor('user_teacher', 'teacher-rotated')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(envelope({
      user: { id: 'user_teacher', email: 'teacher@phd-atlas.local' },
      settings: null,
      mailFetchStatus: null,
    }, teacherToken)))

    await phdApi.me(demoToken)

    expect(readSessionTokenSubject(demoToken)).toBe('user_demo')
    expect(readSessionTokenSubject(teacherToken)).toBe('user_teacher')
    expect(getLatestSessionToken(demoToken)).toBe(demoToken)
    expect(sessionIdentityMatches('user_demo', 'user_demo', demoToken)).toBe(true)
    expect(sessionIdentityMatches('user_demo', 'user_teacher', demoToken)).toBe(false)
    expect(sessionIdentityMatches('user_demo', 'user_demo', teacherToken)).toBe(false)
  })

  it('does not let a late same-account 401 from a previous generation fire unauthorized', async () => {
    const expiredToken = jwtFor('user_demo', 'expired')
    const freshToken = jwtFor('user_demo', 'fresh')
    let releaseExpired: (() => void) | undefined
    const unauthorized = vi.fn()
    setUnauthorizedHandler(unauthorized)

    const fetchMock = vi.fn()
      // First session request hangs until after a generation bump (re-login).
      .mockImplementationOnce(
        () => new Promise<Response>((resolve) => {
          releaseExpired = () => resolve(new Response(JSON.stringify({
            ok: false,
            error: { code: 'TOKEN_EXPIRED', message: 'Your session expired. Please sign in again.' },
            requestId: 'stale',
          }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          }))
        }),
      )
      // Fresh session me succeeds.
      .mockImplementationOnce(() => Promise.resolve(envelope({
        user: { id: 'user_demo', email: 'jasper@example.com' },
        settings: null,
        mailFetchStatus: null,
      })))
    vi.stubGlobal('fetch', fetchMock)

    const staleMe = phdApi.me(expiredToken)
    // Simulate login/re-login scrubbing client session state.
    clearClientSessionCaches()
    const freshMe = await phdApi.me(freshToken)
    expect(freshMe.user.id).toBe('user_demo')

    releaseExpired?.()
    await expect(staleMe).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' })
    expect(unauthorized).not.toHaveBeenCalled()
  })

  it('isolates conditional /api/auth/me caches by JWT subject across accounts', async () => {
    const demoToken = jwtFor('user_demo', 'demo')
    const teacherToken = jwtFor('user_teacher', 'teacher')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({
        user: { id: 'user_demo', email: 'jasper@example.com' },
        settings: null,
        mailFetchStatus: null,
      }, undefined, { ETag: '"me-demo"' }))
      .mockResolvedValueOnce(envelope({
        user: { id: 'user_teacher', email: 'teacher@phd-atlas.local' },
        settings: null,
        mailFetchStatus: null,
      }, undefined, { ETag: '"me-teacher"' }))
      .mockResolvedValueOnce(new Response(null, {
        status: 304,
        headers: new Headers({ ETag: '"me-demo"' }),
      }))
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
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope(mePayload, demoRotated, { ETag: '"me-demo-v1"' }))
      .mockResolvedValueOnce(new Response(null, {
        status: 304,
        headers: new Headers({ ETag: '"me-demo-v1"' }),
      }))
    vi.stubGlobal('fetch', fetchMock)

    const first = await phdApi.me(demoToken)
    const second = await phdApi.me(demoToken)

    expect(first.user.id).toBe('user_demo')
    expect(second.user.id).toBe('user_demo')
    expect(getLatestSessionToken(demoToken)).toBe(demoRotated)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('prefers a fresh response header over a stale cached envelope session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      data: { user: null, settings: null, mailFetchStatus: null },
      session: { token: 'expired-cached-body-token' },
      requestId: 'test-request',
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Token': 'fresh-revalidated-header-token',
      },
    })))

    await phdApi.me('login-token')

    expect(getLatestSessionToken('login-token')).toBe('fresh-revalidated-header-token')
  })

  it('follows only the refresh chain for the provided source token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
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
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope(applications, 'conditional-token-2', { ETag: '"apps-v1"' }))
      .mockResolvedValueOnce(new Response(null, {
        status: 304,
        headers: new Headers({ 'X-Session-Token': 'conditional-token-3' }),
      }))
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

  it('binds offline replay writes to the queued server version', async () => {
    const application = { id: 'app_1', progress: 45 } as ApplicationRecord
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope(application))
    vi.stubGlobal('fetch', fetchMock)

    await phdApi.replayOfflineApplicationUpdate(
      'offline-token',
      application,
      '2026-07-13T08:00:00.000Z',
    )

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/applications/app_1')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      id: 'app_1',
      progress: 45,
      clientBaseUpdatedAt: '2026-07-13T08:00:00.000Z',
    })
  })

  it('coalesces concurrent conditional reads for the same session and path', async () => {
    const applications = [{ id: 'app_inflight', school: { name: 'Fast University' } }]
    let resolveFetch!: (response: Response) => void
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve
    }))
    vi.stubGlobal('fetch', fetchMock)

    const first = phdApi.listApplications('inflight-token')
    const second = phdApi.listApplications('inflight-token')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    resolveFetch(envelope(applications, undefined, { ETag: '"apps-inflight"' }))
    await expect(Promise.all([first, second])).resolves.toEqual([applications, applications])
  })

  it('serves low-volatility reads from the short freshness cache even without an ETag', async () => {
    const assets = [{ id: 'asset_cached', name: 'Research statement' }]
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope(assets))
    vi.stubGlobal('fetch', fetchMock)

    await expect(phdApi.listProfileAssets('cache-token')).resolves.toEqual(assets)
    await expect(phdApi.listProfileAssets('cache-token')).resolves.toEqual(assets)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('advances the read-cache generation after a successful mutation', async () => {
    const firstAssets = [{ id: 'asset_1', name: 'First' }]
    const created = { id: 'asset_2', name: 'Second', kind: 'other', description: '', attachments: [] }
    const fetchMock = vi.fn()
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

  it('routes team student profile edits and deletes through the scoped member endpoint', async () => {
    const updated = {
      id: 'asset_student_1',
      ownerId: 'student_1',
      name: 'Updated research statement',
      kind: 'Research',
      description: 'Updated content',
      attachments: [],
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope(updated))
      .mockResolvedValueOnce(envelope({ id: updated.id }))
    vi.stubGlobal('fetch', fetchMock)

    await phdApi.updateTeamMemberProfileAsset(
      'teacher-token',
      'team_1',
      'student_1',
      updated.id,
      { name: updated.name, description: updated.description },
    )
    await phdApi.deleteTeamMemberProfileAsset('teacher-token', 'team_1', 'student_1', updated.id)

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/teams/team_1/members/student_1/profile-assets/asset_student_1')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify({ name: updated.name, description: updated.description }),
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
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const events: Array<{ type: string; scopes: string[] }> = []

    await phdApi.streamRealtimeUpdates('realtime-token', (event) => events.push(event))

    expect(events.map((event) => event.type)).toEqual(['connected', 'invalidate'])
    expect(events[1]?.scopes).toEqual(['applications', 'teams'])
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.get('Authorization')).toBe('Bearer realtime-token')
    expect(headers.get('X-Phd-Client-Id')).toBeTruthy()
  })

  it('times out stalled API requests instead of leaving callers pending', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_path: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      }),
    ))

    const request = phdApi.captcha()
    const assertion = expect(request).rejects.toMatchObject({
      code: 'REQUEST_TIMEOUT',
      status: 408,
    })
    await vi.advanceTimersByTimeAsync(20_000)

    await assertion
  })

  it('uses the shared blob transport for downloads without JSON content headers', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('file-content', {
      status: 200,
      headers: new Headers({ 'X-Session-Token': 'blob-token-2' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const blob = await phdApi.downloadFile('blob-token-1', 'file 1')

    expect(await blob.text()).toBe('file-content')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/files/file%201/download')
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.get('Authorization')).toBe('Bearer blob-token-1')
    expect(headers.get('Content-Type')).toBeNull()
    expect(getLatestSessionToken('blob-token-1')).toBe('blob-token-2')
  })

  it('sends the active interface language with localized PDF exports', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('pdf-content', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await phdApi.downloadExport('pdf-token', 'pdf', 'app 1', 'zh')

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/exports?format=pdf&applicationId=app+1&language=zh')
  })

  it('lets the browser set multipart headers for upload requests', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope({
      received: true,
      fileName: 'update.tar.gz',
      size: 1,
      storedAs: 'system-update.tar.gz',
      message: 'ok',
    }))
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
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope(check))
      .mockResolvedValueOnce(envelope({
        received: true,
        fileName: 'phd-atlas-update-0.1.0-beta.2.tar.gz',
        size: 1024,
        storedAs: 'phd-atlas-update-0.1.0-beta.2.tar.gz',
        version: '0.1.0-beta.2',
        verified: true,
        restartScheduled: true,
        message: 'ok',
      }))
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
    const assertion = { id: 'credential_1', response: { clientDataJSON: 'client' } }
    const session = { token: 'passkey-session', user: { id: 'user_1' } }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope({ options }))
      .mockResolvedValueOnce(envelope(session))
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
    const options = { challenge: 'challenge_register', rp: { name: 'PhD Atlas' } }
    const passkeys = [{ id: 'passkey_1', label: 'Laptop', transports: ['internal'] }]
    const attestation = { id: 'credential_1', response: { attestationObject: 'attestation' } }
    const fetchMock = vi.fn()
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
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ label: 'Laptop' })
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      response: attestation,
      label: 'Laptop',
    })
  })

  it('keeps system-mail transport explicit for receiving-mailbox tests', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope({
      sent: true,
      delivery: 'research@example.com',
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(phdApi.sendTestEmail('mail-token', {
      delivery: 'research@example.com',
      source: 'system',
    })).resolves.toEqual({ sent: true, delivery: 'research@example.com' })

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
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope({
      state: {},
      programs: [],
      pis: [],
      stats: {},
      ranked: [],
    }))
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
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ email: 'receive@example.com' })
  })

  it('passes the chosen recipient to the administrator system-mail test', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope({ sent: true, delivery: 'qa@example.com' }))
    vi.stubGlobal('fetch', fetchMock)

    await phdApi.sendAdminTestEmail('admin-token', 'qa@example.com')

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/admin/settings/test-email')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ delivery: 'qa@example.com' })
  })

  it('falls back to main-thread JSON parsing when the parser worker reports an error', async () => {
    class FailingJsonWorker {
      private listeners = new Map<string, Array<(event: MessageEvent) => void>>()

      addEventListener(type: string, listener: (event: MessageEvent) => void) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
      }

      postMessage(message: { id: number }) {
        queueMicrotask(() => {
          for (const listener of this.listeners.get('message') ?? []) {
            listener({ data: { id: message.id, error: 'worker failed' } } as MessageEvent)
          }
        })
      }

      terminate() {}
    }

    const largeApplication = { id: 'large-app', padding: 'x'.repeat(300_000) }
    vi.stubGlobal('Worker', FailingJsonWorker)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(envelope([largeApplication])))

    await expect(phdApi.listApplications('large-json-token')).resolves.toEqual([largeApplication])
  })
})
