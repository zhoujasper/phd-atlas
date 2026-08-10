import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { hostname } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

const activeLeasePaths = new Map()

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? Math.min(maximum, Math.max(minimum, Math.floor(parsed)))
    : fallback
}

function publicOwner(owner) {
  if (!owner || typeof owner !== 'object') return null
  return {
    pid: Number(owner.pid) || null,
    hostname: String(owner.hostname ?? ''),
    acquiredAt: String(owner.acquiredAt ?? ''),
  }
}

function leaseHeldError(owner, cause = null) {
  const error = new Error('The encrypted SQLite workspace is already owned by another server process.')
  error.code = 'SQLITE_ENCRYPTED_PROCESS_LEASE_HELD'
  error.status = 503
  error.retryable = true
  error.owner = publicOwner(owner)
  if (cause) error.cause = cause
  return error
}

function leaseLostError(cause = null) {
  const error = new Error('The encrypted SQLite process lease is no longer owned by this server.')
  error.code = 'SQLITE_ENCRYPTED_PROCESS_LEASE_LOST'
  error.status = 503
  error.retryable = false
  if (cause) error.cause = cause
  return error
}

function leaseCancelledError(cause = null) {
  const error = new Error('Waiting for the encrypted SQLite process lease was cancelled.')
  error.code = 'SQLITE_ENCRYPTED_PROCESS_LEASE_CANCELLED'
  error.status = 503
  error.retryable = true
  if (cause) error.cause = cause
  return error
}

function unsafeLeasePathError(message) {
  const error = new Error(message)
  error.code = 'SQLITE_ENCRYPTED_PROCESS_LEASE_UNSAFE_PATH'
  error.status = 500
  error.retryable = false
  return error
}

function sqliteBusy(error) {
  const code = String(error?.code ?? '')
  return code === 'SQLITE_BUSY'
    || code.startsWith('SQLITE_BUSY_')
    || code === 'SQLITE_LOCKED'
    || code.startsWith('SQLITE_LOCKED_')
}

function delay(milliseconds, signal) {
  if (signal?.aborted) return Promise.reject(leaseCancelledError(signal.reason))
  return new Promise((resolve, reject) => {
    let settled = false
    const onAbort = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(leaseCancelledError(signal.reason))
    }
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    if (!signal) return
    signal.addEventListener('abort', onAbort, { once: true })
    // Abort events are not replayed. Close the check/register race without
    // waiting for the next poll when cancellation lands between the two.
    if (signal.aborted) onAbort()
  })
}

export function encryptedSqliteLeasePath(databasePath) {
  return `${path.resolve(databasePath)}.encrypted-process-lease.sqlite`
}

function ownerMetadataPath(leasePath) {
  return `${leasePath}.owner.json`
}

async function canonicalizeNewFilePath(filePath) {
  const resolved = path.resolve(filePath)
  let finalEntry = null
  try {
    finalEntry = await fs.lstat(resolved)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  if (finalEntry) {
    let canonical
    try {
      canonical = await fs.realpath(resolved)
    } catch (error) {
      if (finalEntry.isSymbolicLink() && error?.code === 'ENOENT') {
        throw unsafeLeasePathError('The SQLite database path is a dangling symbolic link.')
      }
      throw error
    }
    const target = await fs.lstat(canonical)
    if (!target.isFile()) {
      throw unsafeLeasePathError('The SQLite database path must resolve to a regular file.')
    }
    if (Number(target.nlink) !== 1) {
      throw unsafeLeasePathError('The SQLite database path must not be a hard-link alias.')
    }
    return canonical
  }
  const missingSegments = [path.basename(resolved)]
  let cursor = path.dirname(resolved)
  while (true) {
    try {
      const canonicalParent = await fs.realpath(cursor)
      return path.join(canonicalParent, ...missingSegments)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      const parent = path.dirname(cursor)
      if (parent === cursor) throw error
      missingSegments.unshift(path.basename(cursor))
      cursor = parent
    }
  }
}

function leaseFileIdentity(stat) {
  return `${String(stat.dev)}:${String(stat.ino)}`
}

async function inspectLeaseFile(leasePath) {
  let entry
  try {
    entry = await fs.lstat(leasePath)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
  if (entry.isSymbolicLink()) {
    throw unsafeLeasePathError('The encrypted SQLite process lease must not be a symbolic link.')
  }
  if (!entry.isFile()) {
    throw unsafeLeasePathError('The encrypted SQLite process lease must be a regular file.')
  }
  if (Number(entry.nlink) !== 1) {
    throw unsafeLeasePathError('The encrypted SQLite process lease must not be a hard-link alias.')
  }
  return leaseFileIdentity(entry)
}

export async function canonicalSqliteDatabasePath(databasePath) {
  return canonicalizeNewFilePath(databasePath)
}

async function readPublicOwner(leasePath) {
  try {
    return publicOwner(JSON.parse(await fs.readFile(ownerMetadataPath(leasePath), 'utf8')))
  } catch {
    return null
  }
}

async function writePublicOwner(leasePath, owner) {
  const target = ownerMetadataPath(leasePath)
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`
  try {
    await fs.writeFile(temporary, `${JSON.stringify(publicOwner(owner))}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    try {
      await fs.rename(temporary, target)
    } catch (error) {
      if (error?.code !== 'EEXIST' && error?.code !== 'EPERM') throw error
      await fs.rm(target, { force: true })
      await fs.rename(temporary, target)
    }
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
  }
}

/**
 * Hold an OS-backed SQLite EXCLUSIVE transaction for the encrypted workspace
 * lifetime. The companion database contains no workspace data. Process death
 * closes the descriptor and releases the lock automatically, including across
 * container hostname/PID changes; the owner sidecar is diagnostics only.
 */
export async function acquireEncryptedSqliteProcessLease(databasePath, options = {}) {
  const canonicalDatabasePath = await canonicalizeNewFilePath(databasePath)
  const leasePath = encryptedSqliteLeasePath(canonicalDatabasePath)
  const waitMs = boundedInteger(
    options.waitMs ?? process.env.PHD_ATLAS_ENCRYPTED_SQLITE_LEASE_WAIT_MS,
    30_000,
    0,
    120_000,
  )
  const pollMs = boundedInteger(options.pollMs, 50, 10, 1_000)
  const sleep = options.sleep ?? delay
  const signal = options.signal
  const deadline = performance.now() + waitMs
  while (activeLeasePaths.has(leasePath)) {
    if (signal?.aborted) throw leaseCancelledError(signal.reason)
    if (performance.now() >= deadline) throw leaseHeldError(activeLeasePaths.get(leasePath))
    await sleep(Math.min(pollMs, Math.max(1, deadline - performance.now())), signal)
  }
  const requestedToken = String(options.token ?? '')
  const token = /^[a-zA-Z0-9_-]{8,128}$/u.test(requestedToken) ? requestedToken : randomUUID()
  const owner = {
    token,
    pid: Number(options.pid ?? process.pid),
    hostname: String(options.hostname ?? hostname()),
    acquiredAt: new Date().toISOString(),
  }
  let database = null
  let leaseIdentity = null
  let lastBusyError = null
  while (!database) {
    let candidate = null
    try {
      const identityBeforeOpen = await inspectLeaseFile(leasePath)
      candidate = new Database(leasePath, { timeout: 0 })
      const identityAfterOpen = await inspectLeaseFile(leasePath)
      if (!identityAfterOpen || (identityBeforeOpen && identityBeforeOpen !== identityAfterOpen)) {
        throw unsafeLeasePathError('The encrypted SQLite process lease changed while it was being opened.')
      }
      candidate.pragma('busy_timeout = 0')
      candidate.pragma('journal_mode = DELETE')
      candidate.pragma('synchronous = FULL')
      candidate.exec(`
        CREATE TABLE IF NOT EXISTS lease_owner (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          token TEXT NOT NULL,
          pid INTEGER NOT NULL,
          hostname TEXT NOT NULL,
          acquired_at TEXT NOT NULL
        );
      `)
      candidate.exec('BEGIN EXCLUSIVE')
      candidate.prepare(
        `INSERT INTO lease_owner (id, token, pid, hostname, acquired_at)
         VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           token = excluded.token,
           pid = excluded.pid,
           hostname = excluded.hostname,
           acquired_at = excluded.acquired_at`,
      ).run(token, owner.pid, owner.hostname, owner.acquiredAt)
      const identityAfterLock = await inspectLeaseFile(leasePath)
      if (identityAfterLock !== identityAfterOpen) {
        throw unsafeLeasePathError('The encrypted SQLite process lease changed while it was being acquired.')
      }
      leaseIdentity = identityAfterLock
      database = candidate
    } catch (error) {
      try { candidate?.close() } catch { /* preserve acquisition error */ }
      if (!sqliteBusy(error)) throw error
      lastBusyError = error
      const remainingMs = deadline - performance.now()
      if (remainingMs <= 0) {
        throw leaseHeldError(await readPublicOwner(leasePath), lastBusyError)
      }
      await sleep(Math.min(pollMs, Math.max(1, remainingMs)), signal)
    }
  }
  activeLeasePaths.set(leasePath, { ...owner })

  await fs.chmod(leasePath, 0o600).catch(() => undefined)
  await writePublicOwner(leasePath, owner).catch(() => undefined)
  let released = false
  let valid = true

  const assertOwned = async () => {
    if (released || !valid || !database?.open || !database.inTransaction) {
      valid = false
      throw leaseLostError()
    }
    try {
      if (await inspectLeaseFile(leasePath) !== leaseIdentity) throw leaseLostError()
      const row = database.prepare('SELECT token FROM lease_owner WHERE id = 1').get()
      if (row?.token !== token) throw leaseLostError()
    } catch (error) {
      valid = false
      if (error?.code === 'SQLITE_ENCRYPTED_PROCESS_LEASE_LOST') throw error
      throw leaseLostError(error)
    }
  }

  return Object.freeze({
    path: leasePath,
    databasePath: canonicalDatabasePath,
    owner: Object.freeze(publicOwner(owner)),
    get valid() { return valid && !released && Boolean(database?.open && database.inTransaction) },
    assertOwned,
    async release() {
      if (released) return
      let releaseError = null
      try {
        await assertOwned()
        database.exec('ROLLBACK')
      } catch (error) {
        releaseError = error
      } finally {
        try { database.close() } catch { /* descriptor may already be closed */ }
        if (activeLeasePaths.get(leasePath)?.token === token) activeLeasePaths.delete(leasePath)
        released = true
        valid = false
      }
      if (releaseError) {
        if (releaseError?.code === 'SQLITE_ENCRYPTED_PROCESS_LEASE_LOST') throw releaseError
        throw leaseLostError(releaseError)
      }
    },
  })
}
