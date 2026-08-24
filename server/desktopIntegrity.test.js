import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  INTEGRITY_PATHS,
  buildIntegrityManifest,
  hashFile,
  verifyIntegrityManifest,
} from '../desktop/integrity.mjs'
import {
  desktopRuntimeChildEnv,
  resolveDesktopNodeBinary,
  resolveDesktopNodeWorkspace,
  unpackAsarFilesystemPath,
} from '../desktop/resolve-runtime-node.mjs'

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

describe('packaged desktop Node resolver', () => {
  it('uses the bundled Node binary and does not set ELECTRON_RUN_AS_NODE when packaged', () => {
    const resolved = resolveDesktopNodeBinary({
      packaged: true,
      resourcesPath: '/app/resources',
      execPath: '/app/PhD Atlas.exe',
      platform: 'win32',
      electronVersion: '37.0.0',
      exists: (candidate) => String(candidate).replaceAll('\\', '/').endsWith('runtime/node.exe'),
    })
    expect(resolved.usesBundledNode).toBe(true)
    expect(resolved.command.replaceAll('\\', '/')).toBe('/app/resources/runtime/node.exe')
    const childEnv = desktopRuntimeChildEnv({ ELECTRON_RUN_AS_NODE: '1', PATH: '/bin' }, resolved)
    expect(childEnv.ELECTRON_RUN_AS_NODE).toBeUndefined()
  })

  it('fails closed when a packaged app is missing the bundled Node binary', () => {
    expect(() => resolveDesktopNodeBinary({
      packaged: true,
      resourcesPath: '/app/resources',
      platform: 'win32',
      exists: () => false,
    })).toThrow(/bundled Node.js binary/)
  })

  it('points the packaged Node child at the unpacked asar tree', () => {
    expect(unpackAsarFilesystemPath('/app/resources/app.asar/desktop/launch-runtime.mjs').replaceAll('\\', '/'))
      .toBe('/app/resources/app.asar.unpacked/desktop/launch-runtime.mjs')
    expect(unpackAsarFilesystemPath('/app/resources/app.asar.unpacked/desktop/launch-runtime.mjs').replaceAll('\\', '/'))
      .toBe('/app/resources/app.asar.unpacked/desktop/launch-runtime.mjs')
    const workspace = resolveDesktopNodeWorkspace({
      packaged: true,
      projectRoot: '/app/resources/app.asar',
    })
    expect(workspace.projectRoot.replaceAll('\\', '/')).toBe('/app/resources/app.asar.unpacked')
    expect(workspace.entry.replaceAll('\\', '/')).toBe('/app/resources/app.asar.unpacked/desktop/launch-runtime.mjs')
  })
})
