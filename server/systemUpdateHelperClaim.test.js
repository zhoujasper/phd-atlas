import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearUpdateLock,
  readUpdateLockState,
  writeUpdateLock,
} from './systemUpdate.js'

const scratchRoots = new Set()

async function scratch(label) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `phd-atlas-helper-claim-${label}-`))
  scratchRoots.add(root)
  return root
}

afterEach(async () => {
  await Promise.all([...scratchRoots].map((root) => fs.rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
  })))
  scratchRoots.clear()
})

describe('cross-process update helper claim', () => {
  it('authorizes exactly one helper and prevents the loser from clearing the winner lock', async () => {
    const storageRoot = await scratch('race')
    const packagePath = path.join(storageRoot, 'candidate.tar.gz')
    await writeUpdateLock(storageRoot, {
      updateId: 'claim-race-update',
      version: '0.2.0-beta.9',
      packagePath,
      previousPid: process.pid,
      requestedAt: '2026-08-03T12:00:00.000Z',
    })
    const childScript = path.join(storageRoot, 'claim-child.mjs')
    const systemUpdateUrl = pathToFileURL(path.resolve(
      process.cwd(),
      'server',
      'systemUpdate.js',
    )).href
    await fs.writeFile(childScript, `
      import {
        claimUpdateLock,
        clearUpdateLock,
        releaseUpdateHelperClaim,
      } from ${JSON.stringify(systemUpdateUrl)}
      const [storageRoot, packagePath, helperPid] = process.argv.slice(2)
      let claimed = null
      try {
        claimed = await claimUpdateLock(storageRoot, {
          packagePath,
          helperPid: Number(helperPid),
        })
        process.send({ ok: true, claim: claimed })
        process.on('message', (message) => {
          if (message !== 'release') return
          releaseUpdateHelperClaim(claimed)
          process.exit(0)
        })
      } catch (error) {
        const cleared = await clearUpdateLock(storageRoot, {
          packagePath,
          helperPid: Number(helperPid),
        }).catch(() => false)
        process.send({ ok: false, code: error?.code, cleared })
        process.exit(0)
      }
    `, 'utf8')

    const children = [91_101, 91_102].map((helperPid) => spawn(process.execPath, [
      childScript,
      storageRoot,
      packagePath,
      String(helperPid),
    ], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      windowsHide: true,
    }))
    const messages = await Promise.all(children.map(async (child) => {
      const [message] = await once(child, 'message')
      return { child, message }
    }))
    const winners = messages.filter(({ message }) => message.ok)
    const losers = messages.filter(({ message }) => !message.ok)

    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)
    expect(losers[0].message).toMatchObject({
      code: 'UPDATE_HELPER_ALREADY_CLAIMED',
      cleared: false,
    })
    await expect(readUpdateLockState(storageRoot)).resolves.toMatchObject({
      updateId: 'claim-race-update',
      helperPid: winners[0].message.claim.helperPid,
      helperClaimToken: winners[0].message.claim.helperClaimToken,
    })

    winners[0].child.send('release')
    await Promise.all(children.map((child) => child.exitCode === null
      ? once(child, 'exit')
      : undefined))
    await expect(clearUpdateLock(storageRoot, winners[0].message.claim)).resolves.toBe(true)
  })
})
