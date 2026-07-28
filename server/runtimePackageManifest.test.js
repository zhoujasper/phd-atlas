import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  createRuntimePackageJson,
  createRuntimePackageLock,
  createVendoredRuntimePackageLock,
} from '../tools/runtime-package-manifest.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('release update runtime package manifest', () => {
  it('automatically retains every production dependency root and its locked graph', async () => {
    const [packageJson, packageLock] = await Promise.all([
      readFile(path.join(projectRoot, 'package.json'), 'utf8').then(JSON.parse),
      readFile(path.join(projectRoot, 'package-lock.json'), 'utf8').then(JSON.parse),
    ])
    const runtimePackage = createRuntimePackageJson(packageJson)
    const runtimeLock = createRuntimePackageLock(packageJson, packageLock)

    expect(runtimePackage.version).toBe(packageJson.version)
    expect(runtimePackage.dependencies).toEqual(packageJson.dependencies)
    expect(packageJson).not.toHaveProperty('phdAtlas.runtimeDependencies')
    expect(runtimePackage.dependencies).toMatchObject({
      express: packageJson.dependencies.express,
      'better-sqlite3': packageJson.dependencies['better-sqlite3'],
      'tar-fs': packageJson.dependencies['tar-fs'],
    })
    expect(runtimePackage.dependencies).not.toHaveProperty('xlsx')
    expect(runtimePackage.dependencies).not.toHaveProperty('react')
    expect(runtimeLock.packages[''].dependencies).toEqual(runtimePackage.dependencies)
    expect(runtimeLock.packages).toHaveProperty('node_modules/better-sqlite3')
    expect(runtimeLock.packages).not.toHaveProperty('node_modules/xlsx')
    expect(runtimeLock.packages).not.toHaveProperty('node_modules/react')
    expect(Object.values(runtimeLock.packages).some((entry) => entry.dev === true)).toBe(false)
  })

  it('rewrites every production archive to an integrity-pinned local Release payload', async () => {
    const [packageJson, packageLock] = await Promise.all([
      readFile(path.join(projectRoot, 'package.json'), 'utf8').then(JSON.parse),
      readFile(path.join(projectRoot, 'package-lock.json'), 'utf8').then(JSON.parse),
    ])
    const runtimeLock = createRuntimePackageLock(packageJson, packageLock)
    const vendored = createVendoredRuntimePackageLock(runtimeLock)

    expect(vendored.artifacts.length).toBe(Object.keys(runtimeLock.packages).length - 1)
    expect(vendored.artifacts.every((artifact) => (
      artifact.source.startsWith('https://')
      && artifact.integrity.length > 0
      && artifact.fileName.endsWith('.tgz')
    ))).toBe(true)
    expect(Object.entries(vendored.packageLock.packages).every(([packagePath, entry]) => (
      !packagePath || entry.resolved.startsWith('file:tools/runtime-packages/')
    ))).toBe(true)
  })

  it('includes a newly declared production extension without a second allowlist', () => {
    const packageJson = {
      name: 'phd-atlas',
      private: true,
      version: '1.2.3',
      type: 'module',
      dependencies: {
        'future-server-extension': '^4.0.0',
      },
    }
    const packageLock = {
      name: 'phd-atlas',
      version: '1.2.3',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': {
          name: 'phd-atlas',
          version: '1.2.3',
          dependencies: {
            'future-server-extension': '^4.0.0',
          },
        },
        'node_modules/future-server-extension': {
          version: '4.0.1',
          resolved: 'https://registry.npmjs.org/future-server-extension/-/future-server-extension-4.0.1.tgz',
          integrity: 'sha512-ZmFrZS1pbnRlZ3JpdHk=',
        },
      },
    }

    const runtimePackage = createRuntimePackageJson(packageJson)
    const runtimeLock = createRuntimePackageLock(packageJson, packageLock)

    expect(runtimePackage.dependencies).toEqual({
      'future-server-extension': '^4.0.0',
    })
    expect(runtimeLock.packages).toHaveProperty('node_modules/future-server-extension')
  })
})
