import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  auditTrackedSource,
  excludeDeletedTrackedFiles,
  filesystemSourceFiles,
} from '../tools/security-source-audit.mjs'

describe('security source audit', () => {
  it('excludes only paths Git explicitly identifies as deleted', () => {
    expect(excludeDeletedTrackedFiles(
      ['src/live.ts', 'src/deleted.ts', 'src/unreadable.ts'],
      ['src/deleted.ts'],
    )).toEqual(['src/live.ts', 'src/unreadable.ts'])
  })

  it('still fails closed for an unreadable path supplied to the audit', async () => {
    await expect(auditTrackedSource(['does-not-exist/security-audit.ts'])).resolves.toEqual([{
      path: 'does-not-exist/security-audit.ts',
      rule: 'unreadable-tracked-file',
    }])
  })

  it('enumerates a Git-free public export while excluding installed dependencies', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'phd-atlas-security-export-'))
    try {
      await mkdir(path.join(root, 'src'), { recursive: true })
      await mkdir(path.join(root, 'node_modules', 'dependency'), { recursive: true })
      await writeFile(path.join(root, 'package.json'), '{}\n')
      await writeFile(path.join(root, 'src', 'app.js'), 'export {}\n')
      await writeFile(path.join(root, 'node_modules', 'dependency', 'index.js'), 'generated\n')

      await expect(filesystemSourceFiles(root)).resolves.toEqual([
        'package.json',
        'src/app.js',
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails closed on a symlink in a Git-free public export', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'phd-atlas-security-symlink-'))
    try {
      await mkdir(path.join(root, 'target'))
      await symlink(path.join(root, 'target'), path.join(root, 'linked'), 'junction')
      await expect(filesystemSourceFiles(root)).rejects.toThrow('Refusing to audit a symbolic link')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
