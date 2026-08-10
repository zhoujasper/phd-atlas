import { performance } from 'node:perf_hooks'

let app = null
let server = null
let storage = null
let sampler = null
let stopping = false
let baselineMemory = null
let peakMemory = null
let maximumEventLoopLagMs = 0
let nextSampleAt = 0
const phaseMemory = {}

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function boundedMessage(value) {
  const encoded = JSON.stringify(value)
  invariant(Buffer.byteLength(encoded, 'utf8') <= 256 * 1024, 'Server worker IPC exceeded 256 KiB.')
  return value
}

function sendMessage(value) {
  if (!process.connected || typeof process.send !== 'function') return Promise.resolve(false)
  return new Promise((resolve) => {
    process.send(boundedMessage(value), (error) => resolve(!error))
  })
}

function memorySnapshot() {
  return { ...process.memoryUsage() }
}

function sampleRuntime() {
  const observedAt = performance.now()
  maximumEventLoopLagMs = Math.max(maximumEventLoopLagMs, observedAt - nextSampleAt)
  nextSampleAt = observedAt + 10
  const memory = memorySnapshot()
  for (const field of ['rss', 'heapUsed', 'external', 'arrayBuffers']) {
    peakMemory[field] = Math.max(peakMemory[field], memory[field])
  }
}

function runtimeReport() {
  invariant(app && server && baselineMemory && peakMemory, 'Server worker is not ready.')
  return {
    serverPid: process.pid,
    listening: server.listening,
    memory: {
      baseline: baselineMemory,
      phases: { ...phaseMemory },
      peak: { ...peakMemory },
    },
    maximumEventLoopLagMs,
    memoryPressure: app.locals.memoryPressureGuard.snapshot(),
    memoryLedger: app.locals.memoryReservationLedger.snapshot(),
    workspaceStreamPreAuthAdmission: app.locals.workspaceStreamPreAuthAdmission.snapshot(),
    workspaceStreamPreparationAdmission: app.locals.workspaceStreamPreparationAdmission.snapshot(),
    streamAdmission: app.locals.streamAdmission.snapshot(),
  }
}

async function shutdown(code = 0, notify = true) {
  if (stopping) return
  stopping = true
  clearInterval(sampler)
  sampler = null
  try { await app?.locals.stopRecurringTasks() } catch { /* bounded parent cleanup remains authoritative */ }
  if (server?.listening) {
    await new Promise((resolve) => server.close(resolve))
  }
  try { await storage?.shutdownStorage() } catch { /* storage is already closed */ }
  if (notify) await sendMessage({ type: 'stopped', serverPid: process.pid })
  try { process.disconnect?.() } catch { /* parent already disconnected */ }
  process.exitCode = code
}

async function start() {
  storage = await import('./storage.js')
  await storage.ensureStorage()
  const { createApp } = await import('./index.js')
  app = createApp()
  server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  baselineMemory = memorySnapshot()
  peakMemory = { ...baselineMemory }
  nextSampleAt = performance.now() + 10
  sampler = setInterval(sampleRuntime, 10)
  await sendMessage({
    type: 'ready',
    serverPid: process.pid,
    port: server.address().port,
    baselineMemory,
  })
}

process.on('message', (message) => {
  if (stopping) return
  if (message?.type === 'phase' && typeof message.phase === 'string') {
    phaseMemory[message.phase] = memorySnapshot()
    return
  }
  if (message?.type === 'report' && typeof message.requestId === 'string') {
    void sendMessage({
      type: 'report',
      requestId: message.requestId,
      report: runtimeReport(),
    })
    return
  }
  if (message?.type === 'stop') void shutdown(0)
})

process.once('disconnect', () => { void shutdown(1, false) })
process.once('SIGTERM', () => { void shutdown(1, false) })
process.once('SIGINT', () => { void shutdown(1, false) })

try {
  await start()
} catch (error) {
  await sendMessage({
    type: 'error',
    message: String(error?.message ?? 'Server worker failed to start.').slice(0, 4_096),
  })
  await shutdown(1, false)
}
