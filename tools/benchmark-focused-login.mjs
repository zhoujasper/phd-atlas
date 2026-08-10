import Database from 'better-sqlite3'
import { hash as bcryptHash } from 'bcryptjs'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'

const __filename = fileURLToPath(import.meta.url)
const projectRoot = path.resolve(path.dirname(__filename), '..')
const RESULT_PREFIX = 'FOCUSED_LOGIN_BENCHMARK '

function memorySnapshot() {
  const value = process.memoryUsage()
  return {
    rss: value.rss,
    heapUsed: value.heapUsed,
    external: value.external,
    arrayBuffers: value.arrayBuffers,
  }
}

function memoryDelta(after, before) {
  return Object.fromEntries(Object.keys(after).map((key) => [key, after[key] - before[key]]))
}

function peakSampler() {
  const peak = memorySnapshot()
  const timer = setInterval(() => {
    const current = memorySnapshot()
    for (const key of Object.keys(peak)) peak[key] = Math.max(peak[key], current[key])
  }, 5)
  timer.unref?.()
  return {
    stop() {
      clearInterval(timer)
      const current = memorySnapshot()
      for (const key of Object.keys(peak)) peak[key] = Math.max(peak[key], current[key])
      return peak
    },
  }
}

async function closeServer(server) {
  if (!server) return
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      server.closeAllConnections?.()
      resolve()
    }, 5_000)
    timeout.unref?.()
    server.close(() => {
      clearTimeout(timeout)
      resolve()
    })
  })
}

async function runWorker(mode) {
  const storage = await import('../server/storage.js')
  await storage.ensureStorage()
  const userId = process.env.PHD_ATLAS_BENCHMARK_USER_ID
  const email = process.env.PHD_ATLAS_BENCHMARK_EMAIL
  const password = process.env.PHD_ATLAS_BENCHMARK_PASSWORD
  global.gc?.()
  const before = memorySnapshot()
  const cacheBefore = storage.sharedStoreCacheDiagnostics()
  const sampler = peakSampler()
  let result
  let app
  let server
  try {
    if (mode === 'migrate') {
      result = { mode, elapsedMs: 0, responseBytes: 0, fullStoreReads: 0 }
    } else if (mode === 'legacy') {
      const startedAt = performance.now()
      const store = await storage.readStore()
      const elapsedMs = performance.now() - startedAt
      const user = store.users.find((candidate) => candidate.id === userId)
      const responseBytes = Buffer.byteLength(JSON.stringify({
        user: storage.publicUser(user),
        settings: storage.publicSystemSettings(store.settings),
      }), 'utf8')
      result = {
        mode,
        elapsedMs,
        responseBytes,
        fullStoreReads: 1,
        hydratedSnapshots: storage.sharedStoreCacheDiagnostics().hydratedSnapshots
          - cacheBefore.hydratedSnapshots,
        entityCounts: {
          users: store.users.length,
          applications: store.applications.length,
          profileAssets: store.profileAssets.length,
        },
      }
    } else if (mode === 'focused-data') {
      const startedAt = performance.now()
      const candidateStartedAt = performance.now()
      const candidate = await storage.readPasswordLoginCandidateByEmail(email)
      const candidateMs = performance.now() - candidateStartedAt
      if (candidate?.guard?.id !== userId) throw new Error('Focused candidate did not resolve the benchmark account.')

      const projectionStartedAt = performance.now()
      const [user, settings, usage] = await Promise.all([
        storage.readFocusedSessionAccount(userId),
        storage.readFocusedPublicSystemSettings(),
        storage.readFocusedAccountUsage(userId, { includePersonalTrash: true }),
      ])
      const projectionMs = performance.now() - projectionStartedAt
      if (!user || !settings || !usage) throw new Error('Focused session projection is incomplete.')

      const responseBytes = Buffer.byteLength(JSON.stringify({
        user: storage.publicUser(user),
        settings,
        usage,
      }), 'utf8')
      result = {
        mode,
        candidateMs,
        projectionMs,
        elapsedMs: performance.now() - startedAt,
        responseBytes,
        fullStoreReads: 0,
        hydratedSnapshots: storage.sharedStoreCacheDiagnostics().hydratedSnapshots
          - cacheBefore.hydratedSnapshots,
        userProjectionBytes: Buffer.byteLength(JSON.stringify(storage.publicUser(user)), 'utf8'),
      }
    } else if (mode === 'focused-http') {
      const candidate = await storage.readPasswordLoginCandidateByEmail(email)
      if (candidate?.guard?.id !== userId) throw new Error('Focused candidate did not resolve the benchmark account.')

      const { createApp } = await import('../server/index.js')
      app = createApp()
      server = app.listen(0, '127.0.0.1')
      await new Promise((resolve) => server.once('listening', resolve))
      const address = server.address()
      const startedAt = performance.now()
      const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, scope: 'app' }),
      })
      const responseText = await response.text()
      const elapsedMs = performance.now() - startedAt
      if (response.status !== 200) {
        throw new Error(`Focused login returned HTTP ${response.status}: ${responseText.slice(0, 240)}`)
      }
      result = {
        mode,
        elapsedMs,
        responseBytes: Buffer.byteLength(responseText, 'utf8'),
        fullStoreReads: 0,
        hydratedSnapshots: storage.sharedStoreCacheDiagnostics().hydratedSnapshots
          - cacheBefore.hydratedSnapshots,
      }
    } else {
      throw new Error(`Unknown benchmark worker mode: ${mode}`)
    }
  } finally {
    await app?.locals?.stopRecurringTasks?.()
    await closeServer(server)
    await storage.shutdownStorage()
  }
  const peak = sampler.stop()
  const after = memorySnapshot()
  process.stdout.write(`${RESULT_PREFIX}${JSON.stringify({
    ...result,
    memoryBefore: before,
    memoryAfter: after,
    memoryDelta: memoryDelta(after, before),
    memoryPeakDelta: memoryDelta(peak, before),
    pidHealthy: true,
  })}\n`)
}

function runChild(mode, storageRoot, credentials) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      '--expose-gc',
      '--max-old-space-size=512',
      __filename,
      '--worker',
      mode,
    ], {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        RATE_LIMIT_DISABLED: '1',
        PHD_ATLAS_STORAGE_ROOT: storageRoot,
        PHD_ATLAS_BENCHMARK_USER_ID: credentials.id,
        PHD_ATLAS_BENCHMARK_EMAIL: credentials.email,
        PHD_ATLAS_BENCHMARK_PASSWORD: credentials.password,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      child.kill()
      const killTimeout = setTimeout(() => child.kill('SIGKILL'), 5_000)
      killTimeout.unref?.()
    }, 180_000)
    timeout.unref?.()
    const settle = (handler) => (value) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      handler(value)
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', settle(reject))
    child.once('close', settle((code) => {
      if (code !== 0) {
        reject(new Error(`Benchmark ${mode} worker exited ${code}: ${stderr.slice(-2000)}`))
        return
      }
      const line = stdout.split(/\r?\n/u).findLast((entry) => entry.startsWith(RESULT_PREFIX))
      if (!line) {
        reject(new Error(`Benchmark ${mode} worker returned no result: ${stdout.slice(-2000)} ${stderr.slice(-2000)}`))
        return
      }
      resolve(JSON.parse(line.slice(RESULT_PREFIX.length)))
    }))
  })
}

async function createStorageRoot(parent, name) {
  const root = path.join(parent, name)
  await mkdir(path.join(root, 'backups'), { recursive: true })
  await mkdir(path.join(root, 'uploads'), { recursive: true })
  return root
}

async function backupSqlite(source, target) {
  const sourceDatabase = new Database(source, { readonly: true, fileMustExist: true })
  try {
    await sourceDatabase.backup(target)
  } finally {
    sourceDatabase.close()
  }
}

async function main() {
  const workerIndex = process.argv.indexOf('--worker')
  if (workerIndex >= 0) {
    await runWorker(process.argv[workerIndex + 1])
    return
  }

  const sourceFlag = process.argv.indexOf('--source')
  const source = path.resolve(sourceFlag >= 0
    ? process.argv[sourceFlag + 1]
    : path.join(projectRoot, 'storage', 'phd-atlas.sqlite'))
  const sourceInfo = await stat(source)
  const sourceWalBytes = await stat(`${source}-wal`).then((info) => info.size).catch(() => 0)
  const temporaryBase = path.resolve(os.tmpdir())
  const temporaryRoot = await mkdtemp(path.join(temporaryBase, 'phd-atlas-login-benchmark-'))
  const resolvedTemporaryRoot = path.resolve(temporaryRoot)
  if (!resolvedTemporaryRoot.startsWith(`${temporaryBase}${path.sep}`)) {
    throw new Error('Refusing to create the benchmark outside the OS temporary directory.')
  }
  const storageRoot = await createStorageRoot(resolvedTemporaryRoot, 'staging')
  const target = path.join(storageRoot, 'phd-atlas.sqlite')
  await backupSqlite(source, target)

  const credentials = {
    id: `user_login_benchmark_${Date.now()}`,
    email: `login-benchmark-${Date.now()}@example.test`,
    password: `Login benchmark ${Date.now()}!`,
  }
  const passwordHash = await bcryptHash(credentials.password, 12)
  const database = new Database(target)
  try {
    const now = new Date().toISOString()
    const settings = {
      language: 'zh',
      contentLanguagePrimary: 'zh',
      contentLanguageSecondary: 'en',
      highContrast: false,
      themeAccent: '#7654ab',
      membershipPlan: 'pro',
      personalMembershipPlan: 'pro',
      storageQuotaMb: 321,
      applicationQuota: 44,
      applicationCreateQuota: 1000000,
      shareQuota: 100,
      shareCreateQuota: 1000,
      sessionDurationMinutes: 120,
      authVersion: 0,
    }
    // The benchmark deliberately accepts a real pre-migration database too.
    const availableColumns = new Set(
      database.prepare('PRAGMA table_info(users)').all().map((row) => row.name),
    )
    const insertValues = {
      id: credentials.id,
      name: 'Focused login benchmark',
      email: credentials.email,
      canonical_email: credentials.email,
      recovery_email: credentials.email,
      language: 'zh',
      role: 'user',
      password_hash: passwordHash,
      auth_version: 0,
      created_at: now,
      last_login_at: null,
      disabled_at: null,
      settings_json: JSON.stringify(settings),
    }
    const insertColumns = Object.keys(insertValues).filter((column) => availableColumns.has(column))
    database.prepare(
      `INSERT INTO users (${insertColumns.join(', ')})
       VALUES (${insertColumns.map(() => '?').join(', ')})`,
    ).run(...insertColumns.map((column) => insertValues[column]))
  } finally {
    database.close()
  }

  try {
    // Migrate once outside the timed paths, then fork byte-equivalent SQLite
    // copies so legacy and focused measurements start at the same schema and
    // neither worker benefits from the other's WAL/cache activity.
    await runChild('migrate', storageRoot, credentials)
    const fixtureInfo = await stat(target)
    const legacyRoot = await createStorageRoot(resolvedTemporaryRoot, 'legacy')
    const focusedDataRoot = await createStorageRoot(resolvedTemporaryRoot, 'focused-data')
    const focusedHttpRoot = await createStorageRoot(resolvedTemporaryRoot, 'focused-http')
    await backupSqlite(target, path.join(legacyRoot, 'phd-atlas.sqlite'))
    await backupSqlite(target, path.join(focusedDataRoot, 'phd-atlas.sqlite'))
    await backupSqlite(target, path.join(focusedHttpRoot, 'phd-atlas.sqlite'))

    const legacy = await runChild('legacy', legacyRoot, credentials)
    const focusedData = await runChild('focused-data', focusedDataRoot, credentials)
    const focusedHttp = await runChild('focused-http', focusedHttpRoot, credentials)
    const readbackDatabase = new Database(path.join(focusedHttpRoot, 'phd-atlas.sqlite'), {
      readonly: true,
      fileMustExist: true,
    })
    let durableReadback
    try {
      const row = readbackDatabase.prepare(
        `SELECT last_login_at,
                (SELECT COUNT(*) FROM system_events
                  WHERE actor_id = ? AND scope = 'Authentication'
                    AND message = 'User signed in') AS event_count
           FROM users WHERE id = ?`,
      ).get(credentials.id, credentials.id)
      durableReadback = {
        lastLoginPersisted: Boolean(row?.last_login_at),
        authenticationEventCount: Number(row?.event_count ?? 0),
      }
    } finally {
      readbackDatabase.close()
    }
    process.stdout.write(`${JSON.stringify({
      source: {
        bytes: sourceInfo.size,
        mebibytes: sourceInfo.size / (1024 * 1024),
        walBytes: sourceWalBytes,
        totalLiveBytes: sourceInfo.size + sourceWalBytes,
        totalLiveMebibytes: (sourceInfo.size + sourceWalBytes) / (1024 * 1024),
      },
      migratedFixture: {
        bytes: fixtureInfo.size,
        mebibytes: fixtureInfo.size / (1024 * 1024),
      },
      heapLimitMib: 512,
      comparison: {
        legacyFullStoreDataPath: legacy,
        focusedSqlDataPath: focusedData,
      },
      realFocusedHttpLogin: focusedHttp,
      durableReadback,
      improvement: {
        dataPathElapsedRatio: legacy.elapsedMs / focusedData.elapsedMs,
        dataPathPeakRssReductionBytes:
          legacy.memoryPeakDelta.rss - focusedData.memoryPeakDelta.rss,
        dataPathPeakHeapReductionBytes:
          legacy.memoryPeakDelta.heapUsed - focusedData.memoryPeakDelta.heapUsed,
        avoidedFullStoreReads: legacy.fullStoreReads - focusedData.fullStoreReads,
      },
    }, null, 2)}\n`)
  } finally {
    await rm(resolvedTemporaryRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`)
  process.exitCode = 1
})
