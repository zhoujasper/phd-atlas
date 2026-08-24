import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  INTEGRITY_PATHS,
  buildIntegrityManifest,
  hashFile,
  verifyIntegrityManifest,
} from './integrity.mjs'

describe('desktop integrity manifest', () => {
  it('hashes the shipped desktop and server entry files', () => {
    const manifest = buildIntegrityManifest()
    expect(Object.keys(manifest.files).sort()).toEqual([...INTEGRITY_PATHS].sort())
    expect(manifest.files['desktop/main.mjs']).toBe(hashFile('desktop/main.mjs'))
    expect(manifest.files['server/desktopRuntime.js']).toHaveLength(64)
  })

  it('fails closed when a protected file changes', () => {
    const root = join(tmpdir(), `phd-atlas-integrity-${Date.now()}`)
    mkdirSync(join(root, 'desktop'), { recursive: true })
    mkdirSync(join(root, 'server'), { recursive: true })
    for (const relative of INTEGRITY_PATHS) {
      writeFileSync(join(root, relative), `source:${relative}\n`)
    }
    const manifest = buildIntegrityManifest(root)
    writeFileSync(join(root, 'desktop/main.mjs'), 'tampered\n')
    const verified = verifyIntegrityManifest(root, manifest)
    expect(verified.ok).toBe(false)
    expect(verified.mismatches).toContain('desktop/main.mjs')
    rmSync(root, { recursive: true, force: true })
  })
})
