import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertDirectoryWritable,
  installPortableLayout,
  resolvePortableAppDirectory,
  resolvePortableStorageRoot,
  resolvePortableUserDataRoot,
} from '../desktop/portablePaths.mjs'

const scratchRoots: string[] = []

afterEach(() => {
  for (const root of scratchRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('portable desktop paths', () => {
  it('keeps packaged macOS data next to the .app instead of Application Support', () => {
    const execPath = '/Volumes/USB/PhD Atlas/PhD Atlas.app/Contents/MacOS/PhD Atlas'
    const options = {
      packaged: true,
      platform: 'darwin' as const,
      execPath,
      projectRoot: '/tmp/unpacked-asar',
    }
    expect(resolvePortableAppDirectory(options)).toBe('/Volumes/USB/PhD Atlas')
    expect(resolvePortableStorageRoot(options)).toBe('/Volumes/USB/PhD Atlas/User Data')
    expect(resolvePortableUserDataRoot(options)).toBe('/Volumes/USB/PhD Atlas/Cache')
  })

  it('keeps packaged Windows and Linux data next to the executable', () => {
    expect(resolvePortableAppDirectory({
      packaged: true,
      platform: 'win32',
      execPath: '/portable/PhD Atlas/PhD Atlas.exe',
    })).toBe('/portable/PhD Atlas')
    expect(resolvePortableStorageRoot({
      packaged: true,
      platform: 'linux',
      execPath: '/opt/phd-atlas/phd-atlas',
    })).toBe('/opt/phd-atlas/User Data')
  })

  it('uses the current project folder when unpackaged', () => {
    const projectRoot = '/Users/jasper/Jasper/PhD Application'
    expect(resolvePortableAppDirectory({
      packaged: false,
      platform: 'darwin',
      execPath: '/opt/homebrew/bin/node',
      projectRoot,
    })).toBe(projectRoot)
    expect(resolvePortableStorageRoot({
      packaged: false,
      projectRoot,
    })).toBe(`${projectRoot}/storage`)
  })

  it('honors an explicit storage root only for application files', () => {
    const execPath = '/Volumes/USB/PhD Atlas/PhD Atlas.app/Contents/MacOS/PhD Atlas'
    expect(resolvePortableStorageRoot({
      packaged: true,
      platform: 'darwin',
      execPath,
      envStorageRoot: '/tmp/custom-storage',
    })).toBe('/tmp/custom-storage')
    expect(resolvePortableUserDataRoot({
      packaged: true,
      platform: 'darwin',
      execPath,
    })).toBe('/Volumes/USB/PhD Atlas/Cache')
  })

  it('renames leftover storage and data folders into User Data and Cache', () => {
    const root = mkdtempSync(join(tmpdir(), 'phd-atlas-portable-layout-'))
    scratchRoots.push(root)
    mkdirSync(join(root, 'storage'))
    mkdirSync(join(root, 'data'))
    writeFileSync(join(root, 'storage', 'keep.txt'), 'ok')
    installPortableLayout(root)
    expect(existsSync(join(root, 'User Data', 'keep.txt'))).toBe(true)
    expect(existsSync(join(root, 'Cache'))).toBe(true)
    expect(existsSync(join(root, 'Read Me.txt'))).toBe(true)
  })

  it('proves a writable portable folder and rejects a file path', () => {
    const root = mkdtempSync(join(tmpdir(), 'phd-atlas-portable-'))
    scratchRoots.push(root)
    expect(assertDirectoryWritable(root)).toBe(root)
    const filePath = join(root, 'not-a-directory')
    writeFileSync(filePath, 'nope')
    expect(() => assertDirectoryWritable(filePath)).toThrow()
  })
})

describe('portable desktop source contracts', () => {
  it('redirects Electron and SQLite roots before the desktop lock is taken', () => {
    const main = readFileSync('desktop/main.mjs', 'utf8')
    const launch = readFileSync('desktop/launch-runtime.mjs', 'utf8')
    expect(main).toContain("app.setPath('userData'")
    expect(main).toContain("app.setPath('appData'")
    expect(main).not.toContain("app.getPath('userData')")
    expect(main).toContain('assertDirectoryWritable')
    expect(main).toContain('installPortableLayout')
    expect(readFileSync('desktop/portablePaths.mjs', 'utf8')).toContain("PORTABLE_STORAGE_DIRNAME = 'User Data'")
    expect(launch).not.toContain('homedir')
    expect(launch).toContain('resolvePortableStorageRoot')
    expect(readFileSync('desktop/integrity.mjs', 'utf8')).toContain("'desktop/portablePaths.mjs'")
  })
})
