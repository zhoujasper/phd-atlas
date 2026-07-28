import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendSystemUpdateLog,
  createSystemUpdateStatus,
  flushSystemUpdateJournal,
  isSystemUpdateActivePhase,
  patchSystemUpdateStatus,
  readSystemUpdateLogs,
  readSystemUpdateStatus,
  writeSystemUpdateStatus,
} from './systemUpdateJournal.js'

const scratchRoots = new Set()

async function scratch(label) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `phd-atlas-${label}-`))
  scratchRoots.add(root)
  return root
}

afterEach(async () => {
  await Promise.all([...scratchRoots].map((root) => fs.rm(root, {
    recursive: true,
    force: true,
  })))
  scratchRoots.clear()
})

describe('system update journal', () => {
  it('persists background update state across server process lifetimes', async () => {
    const storageRoot = await scratch('update-journal-status')
    await writeSystemUpdateStatus(storageRoot, createSystemUpdateStatus({
      jobId: 'update-1',
      phase: 'resolving',
      targetVersion: '0.1.0-beta.7',
      operationInFlight: true,
      requestedAt: '2026-07-28T10:00:00.000Z',
    }))
    await patchSystemUpdateStatus(storageRoot, {
      phase: 'downloading',
      bytes: 512,
      total: 1024,
    })
    await flushSystemUpdateJournal(storageRoot)

    await expect(readSystemUpdateStatus(storageRoot)).resolves.toMatchObject({
      jobId: 'update-1',
      phase: 'downloading',
      targetVersion: '0.1.0-beta.7',
      bytes: 512,
      total: 1024,
      operationInFlight: true,
    })
    expect(isSystemUpdateActivePhase('downloading')).toBe(true)
    expect(isSystemUpdateActivePhase('error')).toBe(false)
  })

  it('stores bounded redacted installer output for administrator diagnostics', async () => {
    const storageRoot = await scratch('update-journal-log')
    await appendSystemUpdateLog(storageRoot, {
      jobId: 'update-2',
      level: 'error',
      phase: 'installing',
      errorCode: 'UPDATE_APPLY_FAILED',
      message: 'npm failed at https://alice:password@example.test/package.tgz',
      detail: 'authorization=Bearer abc.def password=hunter2',
    })

    const result = await readSystemUpdateLogs(storageRoot, { limit: 20 })

    expect(result.fileName).toBe('system-update.log.jsonl')
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]).toMatchObject({
      jobId: 'update-2',
      level: 'error',
      phase: 'installing',
      errorCode: 'UPDATE_APPLY_FAILED',
    })
    expect(result.entries[0].message).not.toContain('password')
    expect(result.entries[0].detail).not.toContain('hunter2')
    expect(result.entries[0].detail).not.toContain('abc.def')
  })
})
