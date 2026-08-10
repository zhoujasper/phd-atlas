import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  claimUpdateLock,
  readUpdateLockState,
  releaseUpdateHelperClaim,
  requireUpdateSafeShutdownMarker,
  UPDATE_SAFE_SHUTDOWN_NAME,
  writeUpdateLock,
  writeUpdateSafeShutdownMarker,
} from './systemUpdate.js'

const scratchRoots = new Set()
const activeClaims = new Set()

async function scratch(label) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `phd-atlas-update-handoff-${label}-`))
  scratchRoots.add(root)
  return root
}

afterEach(async () => {
  for (const claim of activeClaims) releaseUpdateHelperClaim(claim)
  activeClaims.clear()
  await Promise.all([...scratchRoots].map((root) => fs.rm(root, {
    recursive: true,
    force: true,
  })))
  scratchRoots.clear()
})

async function scheduledUpdate(storageRoot, suffix = 'first') {
  const packagePath = path.join(storageRoot, `${suffix}.tar.gz`)
  await writeUpdateLock(storageRoot, {
    updateId: `update-${suffix}`,
    version: '0.2.0-beta.9',
    packagePath,
    previousPid: 90_001,
    requestedAt: '2026-08-03T12:00:00.000Z',
  })
  const claim = await claimUpdateLock(storageRoot, { packagePath, helperPid: 90_002 })
  activeClaims.add(claim)
  return claim
}

describe('system update durable safe-exit marker', () => {
  it('survives helper claim handoff and verifies every stable update identity field', async () => {
    const storageRoot = await scratch('claim-race')
    const packagePath = path.join(storageRoot, 'candidate.tar.gz')
    await writeUpdateLock(storageRoot, {
      updateId: 'update-claim-race',
      version: '0.2.0-beta.9',
      packagePath,
      previousPid: 90_001,
      requestedAt: '2026-08-03T12:00:00.000Z',
    })
    const claimed = await claimUpdateLock(storageRoot, {
      packagePath,
      helperPid: 90_002,
    })
    activeClaims.add(claimed)
    const marker = await writeUpdateSafeShutdownMarker(storageRoot, {
      previousPid: 90_001,
      expectedExitCode: 75,
      reason: 'system-update',
    })

    await expect(requireUpdateSafeShutdownMarker(storageRoot, claimed))
      .resolves.toEqual(marker)
    await expect(readUpdateLockState(storageRoot)).resolves.toMatchObject({
      updateId: marker.updateId,
      handoffNonce: marker.handoffNonce,
      previousPid: marker.previousPid,
      helperPid: 90_002,
    })
  })

  it('rejects missing, forged, stale-nonce, wrong-package, and wrong-PID markers', async () => {
    const storageRoot = await scratch('forged')
    const claimed = await scheduledUpdate(storageRoot)
    await expect(requireUpdateSafeShutdownMarker(storageRoot, claimed))
      .rejects.toMatchObject({ code: 'UPDATE_SAFE_SHUTDOWN_MISSING' })
    await expect(writeUpdateSafeShutdownMarker(storageRoot, {
      previousPid: 99_999,
      expectedExitCode: 75,
      reason: 'system-update',
    })).rejects.toMatchObject({ code: 'UPDATE_LOCK_CHANGED' })

    const marker = await writeUpdateSafeShutdownMarker(storageRoot, {
      previousPid: 90_001,
      expectedExitCode: 75,
      reason: 'system-update',
    })
    const markerPath = path.join(storageRoot, UPDATE_SAFE_SHUTDOWN_NAME)
    for (const patch of [
      { handoffNonce: 'stale-nonce' },
      { packagePath: path.join(storageRoot, 'wrong.tar.gz') },
      { previousPid: 99_999 },
      { durabilityPreserved: false },
    ]) {
      await fs.writeFile(markerPath, `${JSON.stringify({ ...marker, ...patch })}\n`, 'utf8')
      await expect(requireUpdateSafeShutdownMarker(storageRoot, claimed))
        .rejects.toMatchObject({ code: 'UPDATE_SAFE_SHUTDOWN_MISSING' })
    }

    const oldMarker = marker
    releaseUpdateHelperClaim(claimed)
    activeClaims.delete(claimed)
    const successor = await scheduledUpdate(storageRoot, 'successor')
    await fs.writeFile(markerPath, `${JSON.stringify(oldMarker)}\n`, 'utf8')
    await expect(requireUpdateSafeShutdownMarker(storageRoot, successor))
      .rejects.toMatchObject({ code: 'UPDATE_SAFE_SHUTDOWN_MISSING' })
  })

  it('publishes no authorization marker when file or parent-directory sync fails', async () => {
    for (const [label, durability] of [
      ['file-sync', {
        syncFile: async () => { throw new Error('file sync failed') },
      }],
      ['directory-sync', {
        platform: 'linux',
        syncDirectory: async () => { throw new Error('directory sync failed') },
      }],
    ]) {
      const storageRoot = await scratch(label)
      const claimed = await scheduledUpdate(storageRoot, label)
      await expect(writeUpdateSafeShutdownMarker(storageRoot, {
        previousPid: 90_001,
        expectedExitCode: 75,
        reason: 'system-update',
      }, { durability })).rejects.toThrow(`${label.replace('-', ' ')} failed`)
      await expect(fs.access(path.join(storageRoot, UPDATE_SAFE_SHUTDOWN_NAME)))
        .rejects.toMatchObject({ code: 'ENOENT' })
      await expect(requireUpdateSafeShutdownMarker(storageRoot, claimed))
        .rejects.toMatchObject({ code: 'UPDATE_SAFE_SHUTDOWN_MISSING' })
    }
  })
})
