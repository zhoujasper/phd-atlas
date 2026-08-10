import { monitorEventLoopDelay, performance } from 'node:perf_hooks'

let server
let shuttingDown = false
let shutdownPromise
let resolveShutdownAcknowledgement
let stopServer
let shutdownStorage
let requestStorageTerminalShutdown
let storageLifecycleDiagnostics
let startupProgressTimer
let runtimeSampler

const workerRole = process.env.PHD_ATLAS_QA_WORKER_ROLE || 'restart'

function rounded(value) {
  return Math.round(Number(value) * 1_000) / 1_000
}

function createServerRuntimeSampler() {
  let baseline = null
  let peak = null
  const startedAt = performance.now()
  const cpuBaseline = process.cpuUsage()
  let previousCpu = cpuBaseline
  let previousAt = startedAt
  let cpuPeakPercent = 0
  const loopDelay = monitorEventLoopDelay({ resolution: 20 })
  loopDelay.enable()
  const sample = () => {
    const sampledAt = performance.now()
    const memory = process.memoryUsage()
    const cpu = process.cpuUsage()
    const snapshot = {
      rss: memory.rss,
      heapTotal: memory.heapTotal,
      heapUsed: memory.heapUsed,
      external: memory.external,
      arrayBuffers: memory.arrayBuffers,
    }
    baseline ??= snapshot
    peak ??= snapshot
    peak = {
      rss: Math.max(peak.rss, snapshot.rss),
      heapTotal: Math.max(peak.heapTotal, snapshot.heapTotal),
      heapUsed: Math.max(peak.heapUsed, snapshot.heapUsed),
      external: Math.max(peak.external, snapshot.external),
      arrayBuffers: Math.max(peak.arrayBuffers, snapshot.arrayBuffers),
    }
    const elapsedMicros = Math.max(1, (sampledAt - previousAt) * 1_000)
    const cpuMicros = Math.max(0, cpu.user - previousCpu.user)
      + Math.max(0, cpu.system - previousCpu.system)
    cpuPeakPercent = Math.max(cpuPeakPercent, (cpuMicros / elapsedMicros) * 100)
    previousCpu = cpu
    previousAt = sampledAt
    return snapshot
  }
  sample()
  const timer = setInterval(sample, 25)
  timer.unref?.()
  return {
    stop() {
      clearInterval(timer)
      loopDelay.disable()
      const end = sample()
      const stoppedAt = performance.now()
      const cpuEnd = process.cpuUsage()
      const cpuUserMs = (cpuEnd.user - cpuBaseline.user) / 1_000
      const cpuSystemMs = (cpuEnd.system - cpuBaseline.system) / 1_000
      const cpuTotalMs = cpuUserMs + cpuSystemMs
      const wallMs = Math.max(1, stoppedAt - startedAt)
      const megabytes = (bytes) => rounded(bytes / 1024 / 1024)
      return {
        owner: 'api-worker',
        processId: process.pid,
        role: workerRole,
        sampleIntervalMs: 25,
        rssStartMb: megabytes(baseline.rss),
        rssEndMb: megabytes(end.rss),
        rssPeakMb: megabytes(peak.rss),
        rssDeltaMb: megabytes(end.rss - baseline.rss),
        heapUsedStartMb: megabytes(baseline.heapUsed),
        heapUsedEndMb: megabytes(end.heapUsed),
        heapUsedPeakMb: megabytes(peak.heapUsed),
        heapUsedDeltaMb: megabytes(end.heapUsed - baseline.heapUsed),
        heapTotalStartMb: megabytes(baseline.heapTotal),
        heapTotalEndMb: megabytes(end.heapTotal),
        heapTotalPeakMb: megabytes(peak.heapTotal),
        heapTotalDeltaMb: megabytes(end.heapTotal - baseline.heapTotal),
        externalStartMb: megabytes(baseline.external),
        externalEndMb: megabytes(end.external),
        externalPeakMb: megabytes(peak.external),
        externalDeltaMb: megabytes(end.external - baseline.external),
        arrayBuffersStartMb: megabytes(baseline.arrayBuffers),
        arrayBuffersEndMb: megabytes(end.arrayBuffers),
        arrayBuffersPeakMb: megabytes(peak.arrayBuffers),
        arrayBuffersDeltaMb: megabytes(end.arrayBuffers - baseline.arrayBuffers),
        cpuUserMs: rounded(cpuUserMs),
        cpuSystemMs: rounded(cpuSystemMs),
        cpuTotalMs: rounded(cpuTotalMs),
        cpuAveragePercent: rounded((cpuTotalMs / wallMs) * 100),
        cpuPeakPercent: rounded(cpuPeakPercent),
        eventLoopDelay: {
          p50Ms: rounded(loopDelay.percentile(50) / 1e6),
          p95Ms: rounded(loopDelay.percentile(95) / 1e6),
          p99Ms: rounded(loopDelay.percentile(99) / 1e6),
          maxMs: rounded(loopDelay.max / 1e6),
        },
      }
    },
  }
}

async function sendToParent(message) {
  if (!process.connected || typeof process.send !== 'function') return false
  return new Promise((resolve) => {
    try {
      process.send(message, (error) => resolve(!error))
    } catch {
      resolve(false)
    }
  })
}

async function waitForShutdownAcknowledgement() {
  if (!process.connected) return
  let timer
  try {
    await Promise.race([
      new Promise((resolve) => { resolveShutdownAcknowledgement = resolve }),
      new Promise((resolve) => {
        timer = setTimeout(resolve, 2_000)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
    resolveShutdownAcknowledgement = null
  }
}

function reportStartup(phase, details = {}) {
  try {
    process.send?.({
      type: 'startup-progress',
      role: workerRole,
      processId: process.pid,
      phase,
      at: new Date().toISOString(),
      ...details,
    })
  } catch {
    // The parent owns worker lifetime; a closed IPC channel is already handled
    // by the disconnect shutdown hook.
  }
}

function readServerDiagnostics() {
  const locals = server?.phdAtlasApp?.locals
  const memory = process.memoryUsage()
  return {
    processId: process.pid,
    role: workerRole,
    memory: {
      rss: memory.rss,
      heapTotal: memory.heapTotal,
      heapUsed: memory.heapUsed,
      external: memory.external,
      arrayBuffers: memory.arrayBuffers,
    },
    requestBodyAdmission: locals?.requestBodyAdmission?.snapshot?.() ?? null,
    credentialBodyAdmission: locals?.credentialBodyAdmission?.snapshot?.() ?? null,
    memoryPressure: locals?.memoryPressureGuard?.snapshot?.() ?? null,
    memoryReservations: locals?.memoryReservationLedger?.snapshot?.() ?? null,
    mutationAdmission: locals?.mutationAdmission?.snapshot?.() ?? null,
    heavyWorkAdmission: locals?.heavyWorkAdmission?.snapshot?.() ?? null,
    standardWorkAdmission: locals?.standardWorkAdmission?.snapshot?.() ?? null,
    accountSummaryAdmission: locals?.accountSummaryAdmission?.snapshot?.() ?? null,
    applicationListAdmission: locals?.applicationListAdmission?.snapshot?.() ?? null,
    workspaceBootstrapAdmission: locals?.workspaceBootstrapAdmission?.snapshot?.() ?? null,
    smallWorkspaceBootstrapAdmission: locals?.smallWorkspaceBootstrapAdmission?.snapshot?.() ?? null,
  }
}

async function shutdown(exitCode = 0, reason = 'signal') {
  if (shutdownPromise) return shutdownPromise
  shuttingDown = true
  shutdownPromise = (async () => {
    if (startupProgressTimer) clearInterval(startupProgressTimer)
    const runtime = runtimeSampler?.stop() ?? null
    runtimeSampler = null
    requestStorageTerminalShutdown?.()
    let stopOutcome = null
    const failures = []
    try {
      if (server && stopServer) stopOutcome = await stopServer(server)
    } catch (error) {
      failures.push({ owner: 'listener', code: error?.code, message: error?.message || String(error) })
      process.stderr.write(`[qa-server-worker] listener shutdown failed: ${error?.message || error}\n`)
      exitCode = 1
    }
    server = null
    try {
      await shutdownStorage?.({ terminal: true })
    } catch (error) {
      failures.push({ owner: 'storage', code: error?.code, message: error?.message || String(error) })
      process.stderr.write(`[qa-server-worker] storage shutdown failed: ${error?.message || error}\n`)
      exitCode = 1
    }
    const shutdownReport = {
      type: 'shutdown-complete',
      role: workerRole,
      processId: process.pid,
      reason,
      exitCode,
      stopOutcome,
      storageDiagnostics: storageLifecycleDiagnostics?.() ?? null,
      runtime,
      failures,
    }
    if (await sendToParent(shutdownReport)) await waitForShutdownAcknowledgement()
    process.exit(exitCode)
  })()
  return shutdownPromise
}

process.on('message', (message) => {
  if (message?.type === 'shutdown') void shutdown(0, 'parent-request')
  if (message?.type === 'shutdown-ack') resolveShutdownAcknowledgement?.()
  if (message?.type === 'diagnostics-request' && typeof message.requestId === 'string') {
    void sendToParent({
      type: 'diagnostics-response',
      requestId: message.requestId,
      diagnostics: readServerDiagnostics(),
    })
  }
})
process.once('disconnect', () => {
  if (shuttingDown) resolveShutdownAcknowledgement?.()
  else void shutdown(1, 'parent-disconnect')
})
process.once('SIGINT', () => { void shutdown(0, 'SIGINT') })
process.once('SIGTERM', () => { void shutdown(0, 'SIGTERM') })

try {
  reportStartup('import-api')
  const api = await import('../server/index.js')
  reportStartup('import-storage')
  const storage = await import('../server/storage.js')
  stopServer = api.stopServer
  shutdownStorage = storage.shutdownStorage
  requestStorageTerminalShutdown = storage.requestStorageTerminalShutdown
  storageLifecycleDiagnostics = storage.storageLifecycleDiagnostics
  startupProgressTimer = setInterval(() => {
    reportStartup('storage-wait', {
      storage: storageLifecycleDiagnostics?.(),
    })
  }, 5_000)
  startupProgressTimer.unref?.()
  reportStartup('start-server')
  server = await api.startServer({
    port: Number(process.env.PORT ?? 0),
    host: process.env.PHD_ATLAS_LISTEN_HOST || '127.0.0.1',
    installStartupSignalHandlers: false,
    onListener: () => reportStartup('listener-open'),
  })
  if (startupProgressTimer) clearInterval(startupProgressTimer)
  startupProgressTimer = null
  runtimeSampler = createServerRuntimeSampler()
  const address = server.address()
  await sendToParent({
    type: 'ready',
    role: workerRole,
    processId: process.pid,
    runtimeOwner: 'api-worker',
    address: typeof address === 'object' && address ? address.address : null,
    port: typeof address === 'object' && address ? address.port : null,
  })
} catch (error) {
  await sendToParent({
    type: 'startup-error',
    role: workerRole,
    processId: process.pid,
    code: error?.code || 'QA_RESTART_WORKER_START_FAILED',
    message: error?.message || String(error),
  })
  await shutdown(1, 'startup-error')
}
