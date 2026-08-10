import { performance } from 'node:perf_hooks'

const controllers = new Set()
const sseConnections = []
let stopping = false
let started = false
let finishing = false
let configuredInput = null
const receivedTokens = []

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function boundedMessage(value) {
  const encoded = JSON.stringify(value)
  invariant(Buffer.byteLength(encoded, 'utf8') <= 256 * 1024, 'IPC result exceeded 256 KiB.')
  return value
}

function sendMessage(value) {
  if (!process.connected || typeof process.send !== 'function') return Promise.resolve(false)
  return new Promise((resolve) => {
    process.send(boundedMessage(value), (error) => resolve(!error))
  })
}

function createController() {
  const controller = new AbortController()
  controllers.add(controller)
  controller.signal.addEventListener('abort', () => controllers.delete(controller), { once: true })
  return controller
}

async function closeClients() {
  if (stopping) return
  stopping = true
  for (const controller of controllers) controller.abort(new Error('Load worker stopping.'))
  const readers = sseConnections.map(async (entry) => {
    try { await entry.reader.cancel() } catch { /* transport already closed */ }
  })
  await Promise.allSettled(readers)
  await Promise.allSettled(sseConnections.map((entry) => entry.pump))
}

async function openSse(baseUrl, token, index) {
  const controller = createController()
  const response = await fetch(`${baseUrl}/api/events`, {
    headers: {
      authorization: `Bearer ${token}`,
      'x-phd-client-id': `memory-${index}`,
    },
    signal: controller.signal,
  })
  invariant(response.status === 200, `SSE ${index} returned ${response.status}.`)
  invariant(response.body, `SSE ${index} returned no body.`)
  const reader = response.body.getReader()
  const first = await reader.read()
  invariant(!first.done, `SSE ${index} closed before its connected frame.`)
  invariant(new TextDecoder().decode(first.value).includes('connected'), `SSE ${index} omitted connected.`)
  const entry = { controller, reader, closed: false, pump: null }
  entry.pump = (async () => {
    try {
      for (;;) {
        const frame = await reader.read()
        if (frame.done) {
          if (!controller.signal.aborted) entry.closed = true
          return
        }
      }
    } catch {
      if (!controller.signal.aborted) entry.closed = true
    }
  })()
  sseConnections.push(entry)
}

async function openSseFleet(baseUrl, tokens) {
  for (let offset = 0; offset < tokens.length; offset += 25) {
    await Promise.all(tokens.slice(offset, offset + 25).map((token, index) => (
      openSse(baseUrl, token, offset + index)
    )))
  }
  invariant(sseConnections.length === tokens.length, 'The full SSE fleet did not connect.')
}

function assertSseFleetAlive(label) {
  const closed = sseConnections.filter((entry) => entry.closed || entry.controller.signal.aborted).length
  invariant(closed === 0, `${label}: ${closed} SSE clients disconnected.`)
}

async function tinyReads(baseUrl, tokens) {
  const responses = await Promise.all(tokens.map((token) => fetch(`${baseUrl}/api/applications`, {
    headers: { authorization: `Bearer ${token}` },
  })))
  const statuses = responses.map((response) => response.status)
  await Promise.all(responses.map((response) => response.arrayBuffer()))
  invariant(statuses.every((status) => status === 200), `Tiny reads returned ${JSON.stringify(statuses)}.`)
  return { total: statuses.length, status200: statuses.filter((status) => status === 200).length }
}

async function tinyWrites(baseUrl, tokens) {
  const statuses = []
  for (let offset = 0; offset < tokens.length; offset += 50) {
    const responses = await Promise.all(tokens.slice(offset, offset + 50).map((token) => fetch(
      `${baseUrl}/api/notifications/read-all`,
      { method: 'POST', headers: { authorization: `Bearer ${token}` } },
    )))
    statuses.push(...responses.map((response) => response.status))
    await Promise.all(responses.map((response) => response.arrayBuffer()))
  }
  invariant(statuses.every((status) => status === 200), `Tiny writes returned ${JSON.stringify(statuses)}.`)
  return { total: statuses.length, status200: statuses.filter((status) => status === 200).length }
}

async function consumeLargeStream(baseUrl, token, clientId, marker, section) {
  const controller = createController()
  try {
    const response = await fetch(
      `${baseUrl}/api/workspace/bootstrap/stream?sections=${encodeURIComponent(section)}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/x-ndjson',
          'accept-encoding': 'gzip',
          'x-phd-client-id': `large-team-stream-${clientId}`,
        },
        signal: controller.signal,
      },
    )
    if (response.status === 503) {
      const retryAfter = response.headers.get('retry-after')
      const retryAfterMs = response.headers.get('x-phd-retry-after-ms')
      invariant(retryAfter, `${clientId}: 503 omitted Retry-After.`)
      invariant(retryAfterMs, `${clientId}: 503 omitted X-PhD-Retry-After-Ms.`)
      const text = await response.text()
      const payload = JSON.parse(text)
      invariant(payload?.ok === false && payload?.error?.code === 'SERVER_BUSY', `${clientId}: malformed 503.`)
      return {
        status: 503,
        structuredOverload: true,
        pressure: response.headers.get('x-phd-memory-pressure') ?? 'capacity',
        retryAfterMs,
        responseBytes: Buffer.byteLength(text),
      }
    }
    if (response.status !== 200) {
      const failureBody = (await response.text()).slice(0, 512)
      invariant(
        false,
        `${clientId}: large stream section ${JSON.stringify(section)} returned ${response.status}: ${failureBody}`,
      )
    }
    invariant(response.headers.get('content-encoding') === 'gzip', `${clientId}: gzip missing.`)
    invariant(response.body, `${clientId}: 200 omitted body.`)
    let decodedBytes = 0
    let sawMarker = false
    let markerTail = ''
    let lineTail = ''
    let lastFrameKind = null
    let terminalCode = null
    const decoder = new TextDecoder()
    const reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      decodedBytes += value.byteLength
      const decoded = decoder.decode(value, { stream: true })
      const markerText = markerTail + decoded
      if (markerText.includes(marker)) sawMarker = true
      markerTail = markerText.slice(-marker.length)
      const lines = `${lineTail}${decoded}`.split('\n')
      lineTail = lines.pop() ?? ''
      for (const line of lines) {
        if (!line) continue
        const frame = JSON.parse(line)
        lastFrameKind = frame.kind
        if (frame.kind === 'restart') terminalCode = frame.code ?? null
      }
    }
    const finalText = lineTail + decoder.decode()
    if (finalText.trim()) {
      const frame = JSON.parse(finalText)
      lastFrameKind = frame.kind
      if (frame.kind === 'restart') terminalCode = frame.code ?? null
    }
    invariant(decodedBytes > 17 * 1024 * 1024, `${clientId}: decoded body was too small.`)
    invariant(sawMarker, `${clientId}: large application marker missing.`)
    invariant(
      lastFrameKind === 'complete',
      `${clientId}: terminal frame was ${lastFrameKind}${terminalCode ? ` (${terminalCode})` : ''}.`,
    )
    invariant(terminalCode === null, `${clientId}: stream requested restart (${terminalCode}).`)
    return {
      status: 200,
      decodedBytes,
      gzipDecoded: true,
      terminalFrame: lastFrameKind,
    }
  } finally {
    controllers.delete(controller)
  }
}

function summarizeLargeResults(results, label) {
  invariant(results.length === 100, `${label}: expected 100 results.`)
  const completed = results.filter((result) => result.status === 200)
  const overloaded = results.filter((result) => result.status === 503)
  invariant(completed.length > 0, `${label}: every request was overloaded.`)
  invariant(overloaded.length > 0, `${label}: overload protection was not exercised.`)
  invariant(overloaded.every((result) => result.structuredOverload), `${label}: malformed overload.`)
  return {
    total: results.length,
    complete200: completed.length,
    structured503: overloaded.length,
    statusCounts: { 200: completed.length, 503: overloaded.length },
    pressure: Object.fromEntries(Object.entries(Object.groupBy(
      overloaded,
      (result) => result.pressure,
    )).map(([key, values]) => [key, values.length])),
    minimumDecodedBytes: Math.min(...completed.map((result) => result.decodedBytes)),
    maximumDecodedBytes: Math.max(...completed.map((result) => result.decodedBytes)),
    allCompleteGzipDecoded: completed.every((result) => (
      result.gzipDecoded && result.terminalFrame === 'complete'
    )),
    overloadRetryAfterMs: [...new Set(overloaded.map((result) => result.retryAfterMs))],
    maximumOverloadResponseBytes: Math.max(...overloaded.map((result) => result.responseBytes)),
  }
}

async function readHealth(baseUrl) {
  const response = await fetch(`${baseUrl}/api/health`)
  invariant(response.status === 200, `Health returned ${response.status}.`)
  return response.json()
}

async function waitForNormalMemory(baseUrl, timeoutMs = 60_000) {
  const deadline = performance.now() + timeoutMs
  let latest = null
  while (performance.now() < deadline) {
    latest = await readHealth(baseUrl)
    if (latest?.data?.memoryPressure?.level === 'normal') return latest
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Server memory did not recover: ${JSON.stringify(latest?.data?.memoryPressure ?? null)}`)
}

async function runHealthProbe(baseUrl, state) {
  while (!state.stop) {
    const startedAt = performance.now()
    await readHealth(baseUrl)
    state.latencies.push(performance.now() - startedAt)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function percentile95(values) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]
}

async function runQualification({
  baseUrl,
  tokens,
  connections,
  marker,
  largeStreamSection,
  firstLargeMatrixUsesSharedAccount,
  largeStreamToken,
}) {
  invariant(Array.isArray(tokens) && tokens.length === 100, 'Exactly 100 transient tokens are required.')
  invariant(connections === 100, 'The qualification requires exactly 100 clients.')
  await openSseFleet(baseUrl, tokens)
  assertSseFleetAlive('after SSE connect')
  await sendMessage({ type: 'phase', phase: 'afterSse' })

  const reads = await tinyReads(baseUrl, tokens)
  await sendMessage({ type: 'phase', phase: 'afterTinyReads' })
  const writes = await tinyWrites(baseUrl, tokens)
  await sendMessage({ type: 'phase', phase: 'afterTinyWrites' })
  assertSseFleetAlive('before large matrices')

  const healthState = { stop: false, latencies: [] }
  const healthProbe = runHealthProbe(baseUrl, healthState)
  let firstLargeStreams
  let repeatLargeStreams
  let samePidRecovery
  try {
    const firstMatrixTokens = firstLargeMatrixUsesSharedAccount
      ? tokens.map(() => largeStreamToken)
      : tokens
    const first = await Promise.all(firstMatrixTokens.map((token, index) => (
      consumeLargeStream(baseUrl, token, `first-${index}`, marker, largeStreamSection)
    )))
    firstLargeStreams = summarizeLargeResults(first, 'first 100-stream matrix')
    assertSseFleetAlive('after first large-stream matrix')
    await waitForNormalMemory(baseUrl)

    const sameAccount = await Promise.all(Array.from({ length: 100 }, (_, index) => (
      consumeLargeStream(baseUrl, largeStreamToken, `repeat-${index}`, marker, largeStreamSection)
    )))
    repeatLargeStreams = summarizeLargeResults(sameAccount, 'repeated 100-stream matrix')
    assertSseFleetAlive('after repeated large-stream matrix')
    await waitForNormalMemory(baseUrl)

    const recovered = await consumeLargeStream(
      baseUrl,
      largeStreamToken,
      'same-pid-recovery',
      marker,
      largeStreamSection,
    )
    invariant(recovered.status === 200, 'Same-PID recovery was not a complete 200.')
    samePidRecovery = {
      status: recovered.status,
      decodedBytes: recovered.decodedBytes,
      gzipDecoded: recovered.gzipDecoded,
      terminalFrame: recovered.terminalFrame,
    }
    assertSseFleetAlive('after same-PID recovery')
  } finally {
    healthState.stop = true
    await healthProbe
  }
  invariant(healthState.latencies.length >= 2, 'Too few health probes were observed.')

  return {
    workerPid: process.pid,
    onlineSseClients: sseConnections.length,
    sseAliveDuringLarge: sseConnections.every((entry) => !entry.closed),
    tinyReads: reads,
    tinyWrites: writes,
    largeStreamSection,
    firstLargeStreams,
    repeatLargeStreams,
    samePidRecovery,
    health: {
      samples: healthState.latencies.length,
      p95Ms: percentile95(healthState.latencies),
      maximumMs: Math.max(...healthState.latencies),
    },
  }
}

async function finish(code, payload) {
  if (finishing) return
  finishing = true
  if (payload) await sendMessage(payload)
  await closeClients()
  try { process.disconnect?.() } catch { /* parent already disconnected */ }
  process.exitCode = code
}

async function startQualification() {
  invariant(!started, 'The load worker was already started.')
  invariant(configuredInput, 'The load worker was not configured.')
  invariant(
    receivedTokens.length === configuredInput.expectedTokenCount,
    'The load worker did not receive exactly 100 transient tokens.',
  )
  started = true
  const watchdog = setTimeout(() => {
    void finish(1, { type: 'error', message: 'Load worker deadline exceeded.' })
  }, 230_000)
  try {
    const report = await runQualification({
      ...configuredInput,
      tokens: receivedTokens,
    })
    clearTimeout(watchdog)
    await finish(0, { type: 'result', report })
  } catch (error) {
    clearTimeout(watchdog)
    await finish(1, {
      type: 'error',
      message: String(error?.message ?? 'Load worker failed.').slice(0, 4_096),
    })
  }
}

async function handleParentMessage(message) {
  if (finishing) return
  try {
    if (message?.type === 'configure') {
      invariant(!configuredInput && !started, 'The load worker was configured twice.')
      invariant(
        typeof message.baseUrl === 'string' && /^http:\/\/127\.0\.0\.1:\d+$/u.test(message.baseUrl),
        'The load worker requires one loopback HTTP origin.',
      )
      invariant(message.connections === 100, 'The qualification requires exactly 100 clients.')
      invariant(message.expectedTokenCount === 100, 'Exactly 100 transient tokens are required.')
      invariant(typeof message.marker === 'string' && message.marker.length > 0, 'Marker missing.')
      invariant(
        ['applications', 'teamApplications'].includes(message.largeStreamSection),
        'Large workspace stream section is invalid.',
      )
      invariant(
        typeof message.firstLargeMatrixUsesSharedAccount === 'boolean',
        'Large workspace stream account mode is invalid.',
      )
      invariant(
        typeof message.largeStreamToken === 'string' && message.largeStreamToken.length > 0,
        'Large workspace stream token is invalid.',
      )
      configuredInput = {
        baseUrl: message.baseUrl,
        connections: message.connections,
        expectedTokenCount: message.expectedTokenCount,
        marker: message.marker,
        largeStreamSection: message.largeStreamSection,
        firstLargeMatrixUsesSharedAccount: message.firstLargeMatrixUsesSharedAccount,
        largeStreamToken: message.largeStreamToken,
      }
      return
    }
    if (message?.type === 'tokens') {
      invariant(configuredInput && !started, 'Token chunk arrived before configuration or after start.')
      invariant(Array.isArray(message.tokens), 'Token chunk must be an array.')
      invariant(message.tokens.length > 0 && message.tokens.length <= 25, 'Token chunk size is invalid.')
      invariant(
        message.tokens.every((token) => typeof token === 'string' && token.length > 0),
        'Token chunk contains an invalid token.',
      )
      invariant(
        receivedTokens.length + message.tokens.length <= configuredInput.expectedTokenCount,
        'Too many transient tokens were received.',
      )
      receivedTokens.push(...message.tokens)
      return
    }
    if (message?.type === 'start') {
      await startQualification()
    }
  } catch (error) {
    await finish(1, {
      type: 'error',
      message: String(error?.message ?? 'Load worker protocol failed.').slice(0, 4_096),
    })
  }
}

process.on('message', (message) => { void handleParentMessage(message) })
void sendMessage({ type: 'ready', workerPid: process.pid })

process.once('disconnect', () => {
  if (!finishing) void finish(1)
})
process.once('SIGTERM', () => { void finish(1) })
process.once('SIGINT', () => { void finish(1) })
