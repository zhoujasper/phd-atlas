import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  acquireEncryptedSqliteProcessLease,
  canonicalSqliteDatabasePath,
  encryptedSqliteLeasePath,
} from './sqliteProcessLease.js'

const temporaryRoots = []
const children = new Set()

async function temporaryDatabasePath() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-process-lease-'))
  temporaryRoots.push(root)
  return path.join(root, 'workspace.sqlite')
}

async function waitForExit(child, timeoutMs = 20_000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode }
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Child process exit timed out.')), timeoutMs)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal })
    })
  })
}

async function waitForOutput(child, marker, timeoutMs = 20_000) {
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Child output timed out: ${stderr}`)), timeoutMs)
    const check = () => {
      if (!stdout.includes(marker)) return
      clearTimeout(timer)
      resolve({ stdout, stderr })
    }
    child.stdout.on('data', check)
    check()
  })
}

function spawnLeaseOwner(databasePath, mode, ownerHostname = 'lease-test-container', waitMs = 0) {
  const moduleUrl = pathToFileURL(path.resolve('server/sqliteProcessLease.js')).href
  const source = `
    import { acquireEncryptedSqliteProcessLease } from ${JSON.stringify(moduleUrl)};
    try {
      if (Number(process.argv[4]) > 0) process.stdout.write('LEASE_WAITING\\n');
      const lease = await acquireEncryptedSqliteProcessLease(process.argv[1], {
        waitMs: Number(process.argv[4]),
        hostname: process.argv[3],
      });
      process.stdout.write('LEASE_ACQUIRED\\n');
      if (process.argv[2] === 'hold') await new Promise(() => setInterval(() => {}, 1000));
      await lease.release();
    } catch (error) {
      process.stderr.write(String(error?.code || error?.message || error) + '\\n');
      process.exitCode = 23;
    }
  `
  const child = spawn(process.execPath, [
    '--input-type=module',
    '-e',
    source,
    databasePath,
    mode,
    ownerHostname,
    String(waitMs),
  ], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  children.add(child)
  child.once('exit', () => children.delete(child))
  return child
}

afterEach(async () => {
  for (const child of children) child.kill('SIGKILL')
  await Promise.all([...children].map((child) => waitForExit(child).catch(() => undefined)))
  children.clear()
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('encrypted SQLite process lease', () => {
  it('rejects a second live owner and redacts the lease token and process identity', async () => {
    const databasePath = await temporaryDatabasePath()
    const probe = async (pid) => ({ alive: pid === 101, identity: pid === 101 ? 'boot-a:10' : null })
    const first = await acquireEncryptedSqliteProcessLease(databasePath, {
      pid: 101,
      hostname: 'same-host',
      processIdentity: 'boot-a:10',
      probeProcessIdentity: probe,
      waitMs: 0,
    })

    await expect(acquireEncryptedSqliteProcessLease(databasePath, {
      pid: 202,
      hostname: 'same-host',
      processIdentity: 'boot-a:20',
      probeProcessIdentity: probe,
      waitMs: 0,
    })).rejects.toMatchObject({
      code: 'SQLITE_ENCRYPTED_PROCESS_LEASE_HELD',
      status: 503,
      retryable: true,
      owner: { pid: 101, hostname: 'same-host' },
    })
    await expect(acquireEncryptedSqliteProcessLease(databasePath, {
      pid: 202,
      hostname: 'same-host',
      processIdentity: 'boot-a:20',
      probeProcessIdentity: probe,
      waitMs: 0,
    })).rejects.not.toHaveProperty('owner.processIdentity')

    await first.release()
  })

  it('does not let PID or hostname reuse metadata bypass the OS-backed lock', async () => {
    const databasePath = await temporaryDatabasePath()
    const first = await acquireEncryptedSqliteProcessLease(databasePath, {
      pid: 303,
      hostname: 'old-container',
      waitMs: 0,
    })

    await expect(acquireEncryptedSqliteProcessLease(databasePath, {
      pid: 303,
      hostname: 'new-container',
      waitMs: 0,
    })).rejects.toMatchObject({ code: 'SQLITE_ENCRYPTED_PROCESS_LEASE_HELD' })

    await first.release()
    const replacement = await acquireEncryptedSqliteProcessLease(databasePath, {
      pid: 404,
      hostname: 'new-container',
      waitMs: 0,
    })
    expect(replacement.owner.pid).toBe(404)
    await replacement.release()
    await expect(fs.stat(encryptedSqliteLeasePath(databasePath))).resolves.toBeDefined()
  })

  it('waits for a normal shutdown handoff and ignores non-authoritative owner metadata', async () => {
    const databasePath = await temporaryDatabasePath()
    const first = await acquireEncryptedSqliteProcessLease(databasePath, {
      pid: 505,
      hostname: 'same-host',
      processIdentity: 'boot-a:first',
      probeProcessIdentity: async () => ({ alive: true, identity: 'boot-a:first' }),
      waitMs: 0,
    })
    const secondPromise = acquireEncryptedSqliteProcessLease(databasePath, {
      pid: 606,
      hostname: 'same-host',
      waitMs: 1_000,
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    const ownerPath = `${encryptedSqliteLeasePath(databasePath)}.owner.json`
    await fs.writeFile(ownerPath, JSON.stringify({ pid: 999, hostname: 'tampered-diagnostic' }))
    await first.release()
    const second = await secondPromise
    expect(second.owner.pid).toBe(606)
    await second.release()
  })

  it('cancels a lease handoff promptly without leaving an FD or registry owner', async () => {
    const databasePath = await temporaryDatabasePath()
    const first = await acquireEncryptedSqliteProcessLease(databasePath, { waitMs: 0 })
    const controller = new AbortController()
    const startedAt = Date.now()
    const waiting = acquireEncryptedSqliteProcessLease(databasePath, {
      waitMs: 30_000,
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(new Error('stop requested')), 20)
    await expect(waiting).rejects.toMatchObject({
      code: 'SQLITE_ENCRYPTED_PROCESS_LEASE_CANCELLED',
      status: 503,
    })
    expect(Date.now() - startedAt).toBeLessThan(2_000)

    await first.release()
    const replacement = await acquireEncryptedSqliteProcessLease(databasePath, { waitMs: 0 })
    await replacement.release()
  })

  it('closes the AbortSignal check/register race without waiting for another poll', async () => {
    const databasePath = await temporaryDatabasePath()
    const first = await acquireEncryptedSqliteProcessLease(databasePath, { waitMs: 0 })
    let abortedReads = 0
    const signal = {
      reason: new Error('abort during listener registration'),
      get aborted() {
        abortedReads += 1
        return abortedReads >= 3
      },
      addEventListener() {},
      removeEventListener() {},
    }
    const startedAt = Date.now()
    await expect(acquireEncryptedSqliteProcessLease(databasePath, {
      waitMs: 1_000,
      pollMs: 1_000,
      signal,
    })).rejects.toMatchObject({ code: 'SQLITE_ENCRYPTED_PROCESS_LEASE_CANCELLED' })
    expect(Date.now() - startedAt).toBeLessThan(250)
    await first.release()
  })

  it('allows only one winner for simultaneous in-process acquisition', async () => {
    const databasePath = await temporaryDatabasePath()
    const outcomes = await Promise.allSettled([
      acquireEncryptedSqliteProcessLease(databasePath, { waitMs: 0 }),
      acquireEncryptedSqliteProcessLease(databasePath, { waitMs: 0 }),
    ])
    const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled')
    const rejected = outcomes.filter((outcome) => outcome.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toMatchObject({ code: 'SQLITE_ENCRYPTED_PROCESS_LEASE_HELD' })
    await fulfilled[0].value.release()
  })

  it('fails fast for a live process and reclaims its lease after a hard crash', async () => {
    const databasePath = await temporaryDatabasePath()
    const first = spawnLeaseOwner(databasePath, 'hold', 'old-container')
    await waitForOutput(first, 'LEASE_ACQUIRED')

    const blocked = spawnLeaseOwner(databasePath, 'once', 'new-container')
    const blockedOutput = waitForOutput(blocked, 'never', 1_000).catch(() => null)
    const blockedExit = await waitForExit(blocked)
    await blockedOutput
    expect(blockedExit.code).toBe(23)

    const waiting = spawnLeaseOwner(databasePath, 'once', 'new-container', 5_000)
    const waitingReady = waitForOutput(waiting, 'LEASE_WAITING')
    const waitingAcquired = waitForOutput(waiting, 'LEASE_ACQUIRED')
    await waitingReady
    const handoffStartedAt = performance.now()
    first.kill('SIGKILL')
    await waitForExit(first)
    await waitingAcquired
    expect(performance.now() - handoffStartedAt).toBeLessThan(2_000)
    expect((await waitForExit(waiting)).code).toBe(0)
    await expect(fs.stat(encryptedSqliteLeasePath(databasePath))).resolves.toBeDefined()
  }, 60_000)

  it('canonicalizes an existing final database symlink to the real database', async () => {
    const aliasPath = await temporaryDatabasePath()
    const realPath = path.join(path.dirname(aliasPath), 'real-workspace.sqlite')
    await fs.writeFile(realPath, '')
    try {
      await fs.symlink(realPath, aliasPath, 'file')
    } catch (error) {
      if (error?.code === 'EPERM' || error?.code === 'EACCES') return
      throw error
    }
    expect(await canonicalSqliteDatabasePath(aliasPath)).toBe(await fs.realpath(realPath))
  })

  it('rejects database and companion hard-link aliases', async () => {
    const databasePath = await temporaryDatabasePath()
    await fs.writeFile(databasePath, '')
    await fs.link(databasePath, `${databasePath}.alias`)
    await expect(acquireEncryptedSqliteProcessLease(databasePath, { waitMs: 0 })).rejects.toMatchObject({
      code: 'SQLITE_ENCRYPTED_PROCESS_LEASE_UNSAFE_PATH',
      status: 500,
    })

    const separateDatabasePath = path.join(path.dirname(databasePath), 'separate.sqlite')
    const lease = await acquireEncryptedSqliteProcessLease(separateDatabasePath, { waitMs: 0 })
    await lease.release()
    const leasePath = encryptedSqliteLeasePath(separateDatabasePath)
    await fs.link(leasePath, `${leasePath}.alias`)
    await expect(acquireEncryptedSqliteProcessLease(separateDatabasePath, { waitMs: 0 })).rejects.toMatchObject({
      code: 'SQLITE_ENCRYPTED_PROCESS_LEASE_UNSAFE_PATH',
      status: 500,
    })
  })

  it('rejects a symbolic-link companion instead of following it', async () => {
    const databasePath = await temporaryDatabasePath()
    const leasePath = encryptedSqliteLeasePath(databasePath)
    const redirectTarget = `${leasePath}.redirect`
    await fs.writeFile(redirectTarget, '')
    try {
      await fs.symlink(redirectTarget, leasePath, 'file')
    } catch (error) {
      if (error?.code === 'EPERM' || error?.code === 'EACCES') return
      throw error
    }
    await expect(acquireEncryptedSqliteProcessLease(databasePath, { waitMs: 0 })).rejects.toMatchObject({
      code: 'SQLITE_ENCRYPTED_PROCESS_LEASE_UNSAFE_PATH',
      status: 500,
    })
  })
})
