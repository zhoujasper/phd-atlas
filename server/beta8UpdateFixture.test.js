import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('rejects a modified historical updater before importing it or applying a candidate', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'phd-atlas-beta8-provenance-'))
  try {
    const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const fixtureRoot = path.join(root, 'fixture')
    const candidatePath = path.join(root, 'candidate.tar.gz')
    await mkdir(path.join(fixtureRoot, 'server'), { recursive: true })
    await writeFile(candidatePath, 'This candidate must never be opened.\n')
    await writeFile(
      path.join(fixtureRoot, 'server', 'systemUpdate.js'),
      'throw new Error("UNAUTHENTICATED_UPDATER_WAS_EXECUTED")\n',
    )
    const result = spawnSync(process.execPath, [
      path.join(sourceRoot, 'tools', 'verify-beta8-update-compatibility.mjs'),
      candidatePath,
      '--beta8-runtime', fixtureRoot,
    ], { encoding: 'utf8', timeout: 10_000, windowsHide: true })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Historical Beta.8 fixture does not match')
    expect(result.stderr).toContain('server/systemUpdate.js')
    expect(result.stderr).not.toContain('UNAUTHENTICATED_UPDATER_WAS_EXECUTED')
    expect(result.stdout).not.toContain('"ok":true')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
