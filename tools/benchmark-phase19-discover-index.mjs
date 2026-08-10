import Database from 'better-sqlite3'
import { hash as bcryptHash } from 'bcryptjs'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'

const __filename = fileURLToPath(import.meta.url)
const projectRoot = path.resolve(path.dirname(__filename), '..')
const RESULT_PREFIX = 'PHASE19_BENCHMARK '

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
  let result
  let app
  let server
  try {
    if (mode === 'migrate') {
      result = { mode, elapsedMs: 0 }
    } else if (mode === 'readstore') {
      const startedAt = performance.now()
      const store = await storage.readStore()
      const user = store.users.find((candidate) => candidate.id === userId)
      const settingsBytes = Buffer.byteLength(JSON.stringify(user?.settings ?? {}), 'utf8')
      result = {
        mode,
        elapsedMs: performance.now() - startedAt,
        settingsBytes,
        userCount: store.users.length,
      }
    } else if (mode === 'login' || mode === 'bootstrap') {
      const { createApp } = await import('../server/index.js')
      app = createApp()
      server = app.listen(0, '127.0.0.1')
      await new Promise((resolve) => server.once('listening', resolve))
      const address = server.address()
      const loginStartedAt = performance.now()
      const loginResponse = await fetch(`http://127.0.0.1:${address.port}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, scope: 'app' }),
      })
      const loginText = await loginResponse.text()
      const loginElapsedMs = performance.now() - loginStartedAt
      if (loginResponse.status !== 200) {
        throw new Error(`Login returned HTTP ${loginResponse.status}: ${loginText.slice(0, 240)}`)
      }
      const login = JSON.parse(loginText)
      const token = login.data.token
      if (mode === 'login') {
        result = {
          mode,
          loginMs: loginElapsedMs,
          loginResponseBytes: Buffer.byteLength(loginText, 'utf8'),
        }
      } else {
        const bootstrapStartedAt = performance.now()
        const bootstrapResponse = await fetch(
          `http://127.0.0.1:${address.port}/api/workspace/bootstrap/stream`,
          {
            headers: { authorization: `Bearer ${token}` },
          },
        )
        const bootstrapText = await bootstrapResponse.text()
        const bootstrapMs = performance.now() - bootstrapStartedAt
        if (bootstrapResponse.status !== 200) {
          throw new Error(`Bootstrap returned HTTP ${bootstrapResponse.status}: ${bootstrapText.slice(0, 240)}`)
        }
        result = {
          mode,
          loginMs: loginElapsedMs,
          bootstrapMs,
          bootstrapResponseBytes: Buffer.byteLength(bootstrapText, 'utf8'),
        }
      }
    } else {
      throw new Error(`Unknown benchmark worker mode: ${mode}`)
    }
  } finally {
    await app?.locals?.stopRecurringTasks?.()
    await closeServer(server)
    await storage.shutdownStorage()
  }
  process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(result)}\n`)
}

function runChild(mode, storageRoot, credentials, { preserveLegacy = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
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
        ...(preserveLegacy
          ? { PHD_ATLAS_BENCHMARK_PRESERVE_LEGACY_DISCOVER_INDEX: '1' }
          : {}),
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
    }, 300_000)
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

function syntheticSourceIndex() {
  const schools = Array.from({ length: 250 }, (_, schoolIndex) => ({
    school: `Synthetic University ${schoolIndex}`,
    officialUrl: `https://synthetic-${schoolIndex}.example.edu/`,
    collectedAt: new Date(2026, 7, 1).toISOString(),
    pages: Array.from({ length: 180 }, (_, pageIndex) => ({
      url: `https://synthetic-${schoolIndex}.example.edu/pages/${pageIndex}`,
      types: pageIndex % 4 === 0 ? ['program'] : ['homepage'],
      fetched: pageIndex < 24,
      title: `Synthetic ${schoolIndex} ${pageIndex} `.repeat(48).trim(),
    })),
  }))
  return {
    schemaVersion: 1,
    generatedAt: '2026-08-04T00:00:00.000Z',
    sourceCount: schools.length,
    schools,
  }
}

async function prepareBenchmarkDatabase(source, target, userId, email, password) {
  await backupSqlite(source, target)
  const passwordHash = await bcryptHash(password, 12)
  const database = new Database(target)
  try {
    const sourceUser = database.prepare(
      'SELECT settings_json FROM users WHERE id = ? LIMIT 1',
    ).get(userId)
    let settings
    if (sourceUser) {
      settings = JSON.parse(sourceUser.settings_json)
    } else {
      settings = {}
    }
    if (!settings.discoverSourceIndex) {
      settings.discoverSourceIndex = syntheticSourceIndex()
    }
    const availableColumns = new Set(
      database.prepare('PRAGMA table_info(users)').all().map((row) => row.name),
    )
    if (sourceUser) {
      const set = [
        'password_hash = ?',
        'email = ?',
        'canonical_email = ?',
        'recovery_email = ?',
        'name = ?',
        'settings_json = ?',
      ]
      const values = [
        passwordHash,
        email,
        email,
        email,
        'Phase 19 benchmark',
        JSON.stringify(settings),
      ]
      if (availableColumns.has('disabled_at')) {
        set.push('disabled_at = NULL')
      }
      database.prepare(`UPDATE users SET ${set.join(', ')} WHERE id = ?`).run(...values, userId)
    } else {
      const now = new Date().toISOString()
      const insertValues = {
        id: userId,
        name: 'Phase 19 benchmark',
        email,
        canonical_email: email,
        recovery_email: email,
        language: settings.language ?? 'zh',
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
    }
  } finally {
    database.close()
  }
  return {
    id: userId,
    email,
    password,
  }
}

function durableSettingsBytes(root, userId) {
  const database = new Database(path.join(root, 'phd-atlas.sqlite'), {
    readonly: true,
    fileMustExist: true,
  })
  try {
    const row = database.prepare(
      'SELECT LENGTH(CAST(settings_json AS BLOB)) AS bytes FROM users WHERE id = ?',
    ).get(userId)
    return Number(row?.bytes ?? 0)
  } finally {
    database.close()
  }
}

function dedicatedIndexBytes(root, userId) {
  const database = new Database(path.join(root, 'phd-atlas.sqlite'), {
    readonly: true,
    fileMustExist: true,
  })
  try {
    const row = database.prepare(
      `SELECT payload_json
         FROM discover_source_indexes
        WHERE user_id = ? AND scope = 'personal'
        LIMIT 1`,
    ).get(userId)
    return row ? Buffer.byteLength(row.payload_json, 'utf8') : 0
  } finally {
    database.close()
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
  const userIdFlag = process.argv.indexOf('--user-id')
  const userId = userIdFlag >= 0
    ? process.argv[userIdFlag + 1]
    : 'user_6e681d010f7448'
  const email = `phase19-benchmark-${Date.now()}@example.test`
  const password = `Phase19 benchmark ${Date.now()}!`
  const temporaryBase = path.resolve(os.tmpdir())
  const temporaryRoot = await mkdtemp(path.join(temporaryBase, 'phd-atlas-phase19-benchmark-'))
  const resolvedTemporaryRoot = path.resolve(temporaryRoot)
  if (!resolvedTemporaryRoot.startsWith(`${temporaryBase}${path.sep}`)) {
    throw new Error('Refusing to create the benchmark outside the OS temporary directory.')
  }
  try {
    const baseRoot = await createStorageRoot(resolvedTemporaryRoot, 'base')
    const base = path.join(baseRoot, 'phd-atlas.sqlite')
    const credentials = await prepareBenchmarkDatabase(source, base, userId, email, password)
    const beforeRoot = await createStorageRoot(resolvedTemporaryRoot, 'before')
    const afterRoot = await createStorageRoot(resolvedTemporaryRoot, 'after')
    await backupSqlite(base, path.join(beforeRoot, 'phd-atlas.sqlite'))
    await backupSqlite(base, path.join(afterRoot, 'phd-atlas.sqlite'))

    await runChild('migrate', afterRoot, credentials)
    const before = {
      settingsJsonBytes: durableSettingsBytes(beforeRoot, credentials.id),
      readstore: await runChild('readstore', beforeRoot, credentials, { preserveLegacy: true }),
      login: await runChild('login', beforeRoot, credentials, { preserveLegacy: true }),
      bootstrap: await runChild('bootstrap', beforeRoot, credentials, { preserveLegacy: true }),
      dedicatedIndexBytes: dedicatedIndexBytes(beforeRoot, credentials.id),
    }
    const after = {
      settingsJsonBytes: durableSettingsBytes(afterRoot, credentials.id),
      readstore: await runChild('readstore', afterRoot, credentials),
      login: await runChild('login', afterRoot, credentials),
      bootstrap: await runChild('bootstrap', afterRoot, credentials),
      dedicatedIndexBytes: dedicatedIndexBytes(afterRoot, credentials.id),
    }
    process.stdout.write(`${JSON.stringify({
      source,
      userId: credentials.id,
      settingsJsonBytes: {
        before: before.settingsJsonBytes,
        after: after.settingsJsonBytes,
        reductionBytes: before.settingsJsonBytes - after.settingsJsonBytes,
      },
      dedicatedIndexBytes: {
        before: before.dedicatedIndexBytes,
        after: after.dedicatedIndexBytes,
      },
      readStoreMs: {
        before: before.readstore.elapsedMs,
        after: after.readstore.elapsedMs,
      },
      loginMs: {
        before: before.login.loginMs,
        after: after.login.loginMs,
      },
      bootstrapMs: {
        before: before.bootstrap.bootstrapMs,
        after: after.bootstrap.bootstrapMs,
      },
      bootstrapResponseBytes: {
        before: before.bootstrap.bootstrapResponseBytes,
        after: after.bootstrap.bootstrapResponseBytes,
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
