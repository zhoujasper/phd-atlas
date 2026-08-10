import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { once } from 'node:events'
import { request as httpRequest } from 'node:http'
import { createGunzip } from 'node:zlib'
import { WebSocket } from 'ws'
import { createApp } from './index.js'
import { MemoryPressureError } from './memoryPressure.js'
import { scopesForMutation } from './realtime.js'

let server
let baseUrl
let sharedToken

beforeAll(async () => {
  server = createApp().listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address()
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

async function login() {
  if (sharedToken) return sharedToken
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'jasper@example.com',
      password: 'demo123456',
      scope: 'app',
    }),
  })
  const payload = await response.json()
  if (!response.ok || !payload?.data?.token) {
    throw new Error(`Focused realtime login failed (${response.status}): ${JSON.stringify(payload)}`)
  }
  sharedToken = payload.data.token
  return sharedToken
}

async function nextEvent(reader, decoder, state) {
  while (true) {
    const separator = state.buffer.search(/\r?\n\r?\n/)
    if (separator >= 0) {
      const block = state.buffer.slice(0, separator)
      const match = state.buffer.slice(separator).match(/^\r?\n\r?\n/)
      state.buffer = state.buffer.slice(separator + (match?.[0].length ?? 2))
      const data = block.split(/\r?\n/).find((line) => line.startsWith('data:'))
      if (data) return JSON.parse(data.slice(5).trim())
    }
    const { done, value } = await reader.read()
    if (done) throw new Error('Realtime stream closed before the expected event.')
    state.buffer += decoder.decode(value, { stream: true })
  }
}

async function rawHttpGet(url, headers) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { headers }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }))
      response.on('error', reject)
    })
    request.on('error', reject)
    request.end()
  })
}

async function within(promise, timeoutMs, message) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
        timer.unref?.()
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function waitForState(predicate, describeState, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for state: ${JSON.stringify(describeState())}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function reconstructWorkspaceSections(frames) {
  const result = {}
  let current = null
  for (const frame of frames) {
    if (frame.kind === 'section-begin') {
      current = { section: frame.section, shape: frame.shape, values: [], chunks: [] }
    } else if (frame.kind === 'chunk') {
      current.chunks.push(frame.data)
    } else if (frame.kind === 'item-complete') {
      current.values.push(JSON.parse(current.chunks.join('')))
      current.chunks = []
    } else if (frame.kind === 'section-complete') {
      result[current.section] = current.shape === 'array' ? current.values : current.values[0]
      current = null
    }
  }
  return result
}

describe('authenticated realtime route', () => {
  it('classifies only Codex profile recommender writes for realtime invalidation', () => {
    expect(scopesForMutation('GET', '/api/codex/profile-recommenders')).toEqual([])
    expect(scopesForMutation('POST', '/api/codex/profile-recommenders')).toEqual([
      'applications',
      'session',
    ])
  })

  it('returns the full workspace startup graph in one conditional response', async () => {
    const token = await login()
    const first = await fetch(`${baseUrl}/api/workspace/bootstrap`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(first.status).toBe(200)
    const etag = first.headers.get('etag')
    const payload = await first.json()
    expect(payload.data).toMatchObject({
      me: { user: { email: 'jasper@example.com' } },
    })
    expect(Array.isArray(payload.data.applications)).toBe(true)
    expect(Array.isArray(payload.data.profileAssets)).toBe(true)
    expect(Array.isArray(payload.data.teamWorkspaces)).toBe(true)

    const revalidated = await fetch(`${baseUrl}/api/workspace/bootstrap`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'If-None-Match': etag,
      },
    })
    expect(revalidated.status).toBe(304)
  })

  it('streams one revision-consistent application section with explicit completion boundaries', async () => {
    const token = await login()
    const headers = { Authorization: `Bearer ${token}` }
    const legacyResponse = await fetch(`${baseUrl}/api/applications`, { headers })
    const legacyApplications = (await legacyResponse.json()).data
    const response = await fetch(
      `${baseUrl}/api/workspace/bootstrap/stream?sections=applications`,
      {
        headers: {
          ...headers,
          Accept: 'application/x-ndjson',
          'Accept-Encoding': 'gzip',
        },
      },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/x-ndjson')
    expect(response.headers.get('content-encoding')).toBe('gzip')
    expect(response.headers.get('vary')).toContain('Accept-Encoding')
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('cache-control')).not.toContain('no-transform')
    expect(response.headers.get('x-accel-buffering')).toBe('no')
    expect(response.headers.get('x-workspace-stream-protocol')).toBe('phd-atlas-workspace-sections-v1')
    const frames = (await response.text()).trim().split(/\r?\n/u).map((line) => JSON.parse(line))
    const manifest = frames[0]
    expect(manifest).toMatchObject({
      kind: 'manifest',
      protocol: 'phd-atlas-workspace-sections-v1',
      sections: ['applications'],
    })
    expect(String(manifest.revision)).toBe(response.headers.get('x-workspace-revision'))

    const applications = []
    let chunks = []
    for (const frame of frames) {
      expect(frame.revision ?? manifest.revision).toBe(manifest.revision)
      if (frame.kind === 'chunk') chunks.push(frame.data)
      if (frame.kind === 'item-complete') {
        expect(chunks).toHaveLength(frame.chunks)
        expect(chunks.join('')).toHaveLength(frame.characters)
        applications.push(JSON.parse(chunks.join('')))
        chunks = []
      }
    }
    expect(chunks).toEqual([])
    expect(applications).toEqual(legacyApplications)
    expect(frames.at(-1)).toMatchObject({
      kind: 'complete',
      revision: manifest.revision,
      sections: 1,
    })
  })

  it('streams slim application metadata for first-screen bootstrap', async () => {
    const token = await login()
    const headers = { Authorization: `Bearer ${token}` }
    const legacyResponse = await fetch(`${baseUrl}/api/applications`, { headers })
    const legacyApplications = (await legacyResponse.json()).data
    const response = await fetch(
      `${baseUrl}/api/workspace/bootstrap/stream?sections=applications`,
      {
        headers: {
          ...headers,
          Accept: 'application/x-ndjson',
          'X-PhD-Workspace-Slim': '1',
        },
      },
    )
    expect(response.status).toBe(200)
    const frames = (await response.text()).trim().split(/\r?\n/u).map((line) => JSON.parse(line))
    const streamed = reconstructWorkspaceSections(frames)
    expect(streamed.applications).toHaveLength(legacyApplications.length)
    for (const application of streamed.applications) {
      expect(application.__listSlim).toBe(true)
      for (const communication of application.communications ?? []) {
        expect(communication).not.toHaveProperty('bodyHtml')
        expect(communication).not.toHaveProperty('bodyText')
      }
      for (const material of application.materials ?? []) {
        expect(material.versions).toEqual([])
      }
    }
  })

  it('leaves an NDJSON workspace stream uncompressed when the client does not negotiate an encoding', async () => {
    const token = await login()
    const response = await rawHttpGet(
      `${baseUrl}/api/workspace/bootstrap/stream?sections=applications`,
      {
        Authorization: `Bearer ${token}`,
        Accept: 'application/x-ndjson',
      },
    )
    expect(response.status).toBe(200)
    expect(response.headers['content-encoding']).toBeUndefined()
    expect(response.headers['cache-control']).toContain('no-store')
    expect(response.headers['cache-control']).not.toContain('no-transform')
    const frames = response.body.toString('utf8').trim().split(/\r?\n/u).map((line) => JSON.parse(line))
    expect(frames.at(-1)).toMatchObject({
      kind: 'complete',
      protocol: 'phd-atlas-workspace-sections-v1',
    })
  })

  it('flushes the gzip manifest before final validation and releases stream capacity after disconnect', async () => {
    let releaseFinalValidation
    let reportFinalValidationReached
    let reportServerTransportClosed
    let preparedReservedBytes = 0
    let finalValidationReservedBytes = 0
    const finalValidationGate = new Promise((resolve) => { releaseFinalValidation = resolve })
    const finalValidationReached = new Promise((resolve) => { reportFinalValidationReached = resolve })
    const serverTransportClosed = new Promise((resolve) => { reportServerTransportClosed = resolve })
    const localApp = createApp({
      testHooks: {
        // Exercise the large-row lifecycle without allocating a second huge
        // fixture in this focused transport test. Production retains its
        // fixed 8 MiB classification boundary.
        workspaceStreamLargeCursorPayloadBytes: 0,
        workspaceStreamSourcesPrepared: ({ retainsPreparation }) => {
          expect(retainsPreparation).toBe(true)
          expect(localApp.locals.workspaceStreamPreparationAdmission.snapshot().active).toBe(1)
          preparedReservedBytes = localApp.locals.memoryReservationLedger.snapshot().reservedBytes
        },
        workspaceStreamBeforeFinalValidation: async ({ response: serverResponse }) => {
          finalValidationReservedBytes = localApp.locals.memoryReservationLedger.snapshot().reservedBytes
          serverResponse.once('close', reportServerTransportClosed)
          reportFinalValidationReached()
          await finalValidationGate
        },
      },
    })
    const localServer = localApp.listen(0, '127.0.0.1')
    await once(localServer, 'listening')
    const address = localServer.address()
    const localBaseUrl = `http://127.0.0.1:${address.port}`
    let request
    let response
    let intentionalDisconnect = false
    try {
      const token = await login()
      const startedAt = performance.now()
      const firstFrame = new Promise((resolve, reject) => {
        request = httpRequest(
          `${localBaseUrl}/api/workspace/bootstrap/stream?sections=applications`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/x-ndjson',
              'Accept-Encoding': 'gzip',
            },
          },
          (incoming) => {
            response = incoming
            const gunzip = createGunzip()
            gunzip.setEncoding('utf8')
            let buffer = ''
            gunzip.on('data', (chunk) => {
              buffer += chunk
              const newline = buffer.indexOf('\n')
              if (newline < 0) return
              resolve({
                frame: JSON.parse(buffer.slice(0, newline)),
                headers: incoming.headers,
                latencyMs: performance.now() - startedAt,
              })
            })
            gunzip.on('error', (error) => {
              if (!intentionalDisconnect) reject(error)
            })
            incoming.pipe(gunzip)
          },
        )
        request.on('error', (error) => {
          if (!intentionalDisconnect) reject(error)
        })
        request.end()
      })

      const [observed] = await Promise.all([
        within(firstFrame, 1_500, 'The gzip workspace manifest was not flushed promptly.'),
        within(finalValidationReached, 1_500, 'The workspace stream did not reach final validation.'),
      ])
      expect(observed.headers['content-encoding']).toBe('gzip')
      expect(observed.frame).toMatchObject({
        kind: 'manifest',
        protocol: 'phd-atlas-workspace-sections-v1',
      })
      expect(observed.latencyMs).toBeLessThan(1_500)
      expect(localApp.locals.streamAdmission.snapshot().activeLeases).toBe(1)
      expect(localApp.locals.workspaceStreamPreparationAdmission.snapshot().active).toBe(1)
      expect(preparedReservedBytes).toBeGreaterThan(finalValidationReservedBytes)

      intentionalDisconnect = true
      response.destroy()
      request.destroy()
      await within(
        serverTransportClosed,
        1_500,
        'The server did not observe the workspace transport disconnect.',
      )
      // Transport capacity must remain owned while the final-validation
      // handler is still unwinding its cursor and exact-row memory leases.
      expect(localApp.locals.streamAdmission.snapshot().activeLeases).toBe(1)
      expect(localApp.locals.workspaceStreamPreparationAdmission.snapshot().active).toBe(1)
      expect(localApp.locals.memoryReservationLedger.snapshot().activeReservations).toBeGreaterThan(0)
      releaseFinalValidation()
      await waitForState(
        () => localApp.locals.streamAdmission.snapshot().activeLeases === 0,
        () => ({
          stream: localApp.locals.streamAdmission.snapshot(),
          ledger: localApp.locals.memoryReservationLedger.snapshot(),
        }),
      )
      expect(localApp.locals.memoryReservationLedger.snapshot()).toMatchObject({
        activeReservations: 0,
        reservedBytes: 0,
      })
      expect(localApp.locals.workspaceStreamPreparationAdmission.snapshot()).toMatchObject({
        active: 0,
        waiting: 0,
      })
    } finally {
      intentionalDisconnect = true
      response?.destroy()
      request?.destroy()
      releaseFinalValidation?.()
      await new Promise((resolve) => localServer.close(resolve))
    }
  }, 10_000)

  it('terminates a started workspace stream with restart and recovers instead of returning a truncated 200', async () => {
    let interruptFinalValidation = true
    const localServer = createApp({
      testHooks: {
        workspaceStreamBeforeFinalValidation: () => {
          if (!interruptFinalValidation) return
          interruptFinalValidation = false
          throw new Error('Injected final workspace validation interruption.')
        },
      },
    }).listen(0, '127.0.0.1')
    await once(localServer, 'listening')
    const address = localServer.address()
    const localBaseUrl = `http://127.0.0.1:${address.port}`
    try {
      const token = await login()
      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/x-ndjson',
      }
      const interrupted = await fetch(
        `${localBaseUrl}/api/workspace/bootstrap/stream?sections=applications`,
        { headers },
      )
      expect(interrupted.status).toBe(200)
      const interruptedFrames = (await interrupted.text())
        .trim()
        .split(/\r?\n/u)
        .map((line) => JSON.parse(line))
      expect(interruptedFrames.some((frame) => frame.kind === 'section-complete')).toBe(true)
      expect(interruptedFrames.some((frame) => frame.kind === 'complete')).toBe(false)
      expect(interruptedFrames.at(-1)).toMatchObject({
        kind: 'restart',
        protocol: 'phd-atlas-workspace-sections-v1',
        code: 'WORKSPACE_STREAM_RETRY_REQUIRED',
      })

      const recovered = await fetch(
        `${localBaseUrl}/api/workspace/bootstrap/stream?sections=applications`,
        { headers },
      )
      expect(recovered.status).toBe(200)
      const recoveredFrames = (await recovered.text())
        .trim()
        .split(/\r?\n/u)
        .map((line) => JSON.parse(line))
      expect(recoveredFrames.at(-1)).toMatchObject({
        kind: 'complete',
        protocol: 'phd-atlas-workspace-sections-v1',
      })
    } finally {
      await new Promise((resolve) => localServer.close(resolve))
    }
  })

  it('keeps every compact bootstrap metadata section byte-for-byte compatible with the legacy graph', async () => {
    const token = await login()
    const headers = { Authorization: `Bearer ${token}` }
    const legacyResponse = await fetch(`${baseUrl}/api/workspace/bootstrap`, { headers })
    expect(legacyResponse.status).toBe(200)
    const legacy = (await legacyResponse.json()).data
    const sections = [
      'me',
      'backups',
      'applicationTrash',
      'teamWorkspaces',
      'activeTeamId',
      'teamSummary',
      'aiKeys',
    ]
    const response = await fetch(
      `${baseUrl}/api/workspace/bootstrap/stream?sections=${sections.join(',')}`,
      { headers: { ...headers, Accept: 'application/x-ndjson' } },
    )
    expect(response.status).toBe(200)
    const etag = response.headers.get('etag')
    const fingerprints = {
      content: response.headers.get('x-workspace-content-fingerprint'),
      scope: response.headers.get('x-workspace-scope-fingerprint'),
      sections: response.headers.get('x-workspace-section-fingerprint'),
    }
    expect(etag).toBeTruthy()
    const frames = (await response.text()).trim().split(/\r?\n/u).map((line) => JSON.parse(line))
    expect(frames.at(-1)?.kind).toBe('complete')
    const streamed = reconstructWorkspaceSections(frames)
    for (const section of sections) expect(streamed[section]).toEqual(legacy[section])

    const unchanged = await fetch(
      `${baseUrl}/api/workspace/bootstrap/stream?sections=${sections.join(',')}`,
      { headers: { ...headers, Accept: 'application/x-ndjson', 'If-None-Match': etag } },
    )
    expect({
      content: unchanged.headers.get('x-workspace-content-fingerprint'),
      scope: unchanged.headers.get('x-workspace-scope-fingerprint'),
      sections: unchanged.headers.get('x-workspace-section-fingerprint'),
    }).toEqual(fingerprints)
    expect(unchanged.headers.get('etag')).toBe(etag)
    expect(unchanged.status).toBe(304)
    expect(await unchanged.text()).toBe('')
  })

  it('serves repeated workspace reads from the revision cache before recomputing the payload', async () => {
    const token = await login()
    const headers = { Authorization: `Bearer ${token}` }
    const cacheApp = createApp()
    const cacheSequenceKey = Symbol.for('phd-atlas.test.realtime-route-cache-sequence')
    const cacheSequence = Number(globalThis[cacheSequenceKey] ?? 0) + 1
    globalThis[cacheSequenceKey] = cacheSequence
    // The response cache is intentionally process-wide. Give this independent
    // app a monotonically unique negative revision so earlier tests cannot
    // preheat either side of the mutation boundary exercised below.
    cacheApp.locals.conditionalExternalRevision = Number.MIN_SAFE_INTEGER + cacheSequence * 2
    const cacheServer = cacheApp.listen(0, '127.0.0.1')
    await once(cacheServer, 'listening')
    const cacheBaseUrl = `http://127.0.0.1:${cacheServer.address().port}`
    const applicationsUrl = `${cacheBaseUrl}/api/applications`

    try {
      const first = await fetch(applicationsUrl, { headers })
      expect(first.status).toBe(200)
      expect(first.headers.get('server-timing')).toContain('desc="miss"')
      const etag = first.headers.get('etag')
      expect(etag).toBeTruthy()
      await first.arrayBuffer()

      const cached = await fetch(applicationsUrl, { headers })
      expect(cached.status).toBe(200)
      expect(cached.headers.get('server-timing')).toContain('desc="hit"')
      await cached.arrayBuffer()

      const revisionBeforeMutation = cacheApp.locals.conditionalExternalRevision
      const mutation = await fetch(`${cacheBaseUrl}/api/notifications/read-all`, {
        method: 'POST',
        headers,
      })
      expect(mutation.status).toBe(200)
      await mutation.arrayBuffer()
      expect(cacheApp.locals.conditionalExternalRevision).toBe(revisionBeforeMutation + 1)

      const invalidated = await fetch(applicationsUrl, { headers })
      expect(invalidated.status).toBe(200)
      expect(invalidated.headers.get('server-timing')).toContain('desc="miss"')
      expect(invalidated.headers.get('etag')).toBeTruthy()
      await invalidated.arrayBuffer()
    } finally {
      await new Promise((resolve) => cacheServer.close(resolve))
    }
  })

  it('revalidates application and Discover reads with empty 304 bodies', async () => {
    const token = await login()
    for (const path of ['/api/applications', '/api/discover/catalog']) {
      const first = await fetch(`${baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(first.status, path).toBe(200)
      const etag = first.headers.get('etag')
      expect(etag, path).toBeTruthy()
      await first.arrayBuffer()

      const second = await fetch(`${baseUrl}${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'If-None-Match': etag ?? '',
        },
      })
      expect(second.status, path).toBe(304)
      expect(await second.text(), path).toBe('')
    }
  })

  it('streams a scoped invalidation after a successful mutation from another tab', async () => {
    const token = await login()
    const controller = new AbortController()
    const streamResponse = await fetch(`${baseUrl}/api/events`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Phd-Client-Id': 'reader-tab',
      },
      signal: controller.signal,
    })
    expect(streamResponse.status).toBe(200)
    expect(streamResponse.headers.get('content-type')).toContain('text/event-stream')
    expect(streamResponse.headers.get('cache-control')).toContain('no-transform')
    expect(streamResponse.headers.get('x-accel-buffering')).toBe('no')
    expect(streamResponse.headers.get('content-encoding')).toBeNull()
    const reader = streamResponse.body.getReader()
    const decoder = new TextDecoder()
    const state = { buffer: '' }

    await expect(nextEvent(reader, decoder, state)).resolves.toMatchObject({ type: 'connected' })
    const mutation = await fetch(`${baseUrl}/api/notifications/read-all`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Phd-Client-Id': 'writer-tab',
      },
    })
    expect(mutation.status).toBe(200)
    await expect(nextEvent(reader, decoder, state)).resolves.toMatchObject({
      type: 'invalidate',
      scopes: ['notifications'],
    })

    controller.abort()
    await reader.cancel().catch(() => undefined)
  })

  it('publishes Codex profile recommender mutations to the account realtime stream', async () => {
    const token = await login()
    const authorizationResponse = await fetch(`${baseUrl}/api/codex/authorizations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Realtime profile recommender test',
        scopeVersion: 2,
        scopes: ['profile:read', 'profile:write'],
        expiresInDays: 30,
      }),
    })
    const authorizationPayload = await authorizationResponse.json()
    expect(authorizationResponse.status).toBe(201)
    const codexToken = authorizationPayload.data.token
    const authorizationId = authorizationPayload.data.authorization.id
    const profileId = 'profile_recommender_realtime_invalidation'
    const controller = new AbortController()
    let reader

    try {
      const streamResponse = await fetch(`${baseUrl}/api/events`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Phd-Client-Id': 'reader-tab-codex-profile',
        },
        signal: controller.signal,
      })
      expect(streamResponse.status).toBe(200)
      reader = streamResponse.body.getReader()
      const decoder = new TextDecoder()
      const state = { buffer: '' }
      await expect(nextEvent(reader, decoder, state)).resolves.toMatchObject({ type: 'connected' })

      const mutation = await fetch(`${baseUrl}/api/codex/profile-recommenders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${codexToken}`,
          'Content-Type': 'application/json',
          'X-Phd-Client-Id': 'writer-codex-profile',
        },
        body: JSON.stringify({
          id: profileId,
          name: 'Realtime Professor',
          email: '',
        }),
      })
      expect(mutation.status).toBe(201)
      await mutation.arrayBuffer()
      await expect(within(
        nextEvent(reader, decoder, state),
        2_000,
        'Codex profile recommender mutation did not publish a realtime invalidation.',
      )).resolves.toMatchObject({
        type: 'invalidate',
        scopes: ['applications', 'session'],
      })
    } finally {
      controller.abort()
      if (reader) await reader.cancel().catch(() => undefined)
      await fetch(`${baseUrl}/api/codex/profile-recommenders/${profileId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${codexToken}` },
      }).catch(() => undefined)
      await fetch(`${baseUrl}/api/codex/authorizations/${authorizationId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => undefined)
    }
  })

  it('drains active health WebSocket and SSE clients before a direct server close', async () => {
    // Acquire the shared bearer from the primary fixture before creating the
    // throwaway server. This test is about connection ownership, not login;
    // another credential attempt would consume the module-global anti-abuse
    // bucket and make the result depend on test ordering or neighboring suites.
    const token = await login()
    const localServer = createApp().listen(0, '127.0.0.1')
    await once(localServer, 'listening')
    const address = localServer.address()
    const localBaseUrl = `http://127.0.0.1:${address.port}`
    const healthSocket = new WebSocket(
      `ws://127.0.0.1:${address.port}/api/health/ws`,
      { headers: { Origin: 'http://localhost:5173' } },
    )
    const controller = new AbortController()
    try {
      await once(healthSocket, 'message')
      const streamResponse = await fetch(`${localBaseUrl}/api/events`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Phd-Client-Id': 'shutdown-reader',
        },
        signal: controller.signal,
      })
      expect(streamResponse.status).toBe(200)
      const reader = streamResponse.body.getReader()
      const decoder = new TextDecoder()
      const state = { buffer: '' }
      await expect(nextEvent(reader, decoder, state)).resolves.toMatchObject({ type: 'connected' })
      const healthClosed = once(healthSocket, 'close')

      const closeResult = await Promise.race([
        new Promise((resolve, reject) => {
          localServer.close((error) => (error ? reject(error) : resolve('closed')))
        }),
        new Promise((_, reject) => {
          const timer = setTimeout(() => reject(new Error('Direct server.close() did not drain long-lived clients.')), 2_000)
          timer.unref?.()
        }),
      ])

      expect(closeResult).toBe('closed')
      await healthClosed
      expect(localServer.listening).toBe(false)
      await reader.cancel().catch(() => undefined)
    } finally {
      controller.abort()
      healthSocket.terminate()
      if (localServer.listening) {
        await new Promise((resolve) => localServer.close(() => resolve()))
      }
    }
  }, 10_000)

  it('publishes a bounded retry hint and request reference after post-header memory pressure', async () => {
    const localServer = createApp({
      testHooks: {
        workspaceStreamBeforeFinalValidation: () => {
          throw new MemoryPressureError({
            code: 'MEMORY_PRESSURE_HARD',
            level: 'hard',
            retryAfterMs: 2_345,
          })
        },
      },
    }).listen(0, '127.0.0.1')
    await once(localServer, 'listening')
    const address = localServer.address()
    const localBaseUrl = `http://127.0.0.1:${address.port}`
    try {
      const token = await login()
      const response = await fetch(
        `${localBaseUrl}/api/workspace/bootstrap/stream?sections=applications`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/x-ndjson',
          },
        },
      )
      expect(response.status).toBe(200)
      const requestId = response.headers.get('x-request-id')
      expect(requestId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u)
      const frames = (await response.text())
        .trim()
        .split(/\r?\n/u)
        .map((line) => JSON.parse(line))
      expect(frames.at(-1)).toMatchObject({
        kind: 'restart',
        protocol: 'phd-atlas-workspace-sections-v1',
        code: 'SERVER_BUSY',
        retryAfterMs: 2_345,
        requestId,
      })
    } finally {
      await new Promise((resolve) => localServer.close(resolve))
    }
  }, 10_000)
})
