import { describe, expect, it } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { REQUIRED_RUNTIME_FILES } from './sharedConstants.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtimeSharedNames = Object.freeze([
  'aiConcurrency.js',
  'aiKeyRouting.js',
  'applicationAuthorityFields.js',
  'applicationCanonical.js',
  'applicationPersistenceProtocol.js',
  'backupFrequency.js',
  'realtimeScopes.js',
  'teamLimits.js',
])

async function productionModuleFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await productionModuleFiles(fullPath))
    } else if (
      entry.isFile()
      && /\.(?:cjs|d\.ts|js|mjs)$/u.test(entry.name)
      && !entry.name.endsWith('.test.js')
    ) {
      files.push(fullPath)
    }
  }
  return files
}

function relativeModuleSpecifiers(source) {
  return [...source.matchAll(
    /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/gu,
  )]
    .map((match) => match[1])
    .filter((specifier) => specifier.startsWith('.'))
}

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

describe('legacy-compatible update runtime boundary', () => {
  it('keeps every server runtime import inside the legacy server archive root', async () => {
    const serverRoot = path.join(projectRoot, 'server')
    const offenders = []
    for (const filePath of await productionModuleFiles(serverRoot)) {
      const source = await readFile(filePath, 'utf8')
      for (const specifier of relativeModuleSpecifiers(source)) {
        const resolved = path.resolve(path.dirname(filePath), specifier)
        if (!inside(serverRoot, resolved)) {
          offenders.push(`${path.relative(projectRoot, filePath)} -> ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])

    for (const relativePath of [
      'tools/start-server.mjs',
      'tools/apply-update.mjs',
      'tools/container-entrypoint.mjs',
    ]) {
      const filePath = path.join(projectRoot, ...relativePath.split('/'))
      const source = await readFile(filePath, 'utf8')
      for (const specifier of relativeModuleSpecifiers(source)) {
        const resolved = path.resolve(path.dirname(filePath), specifier)
        expect(
          inside(path.join(projectRoot, 'server'), resolved)
          || inside(path.join(projectRoot, 'tools'), resolved),
          `${relativePath} escapes the legacy update roots through ${specifier}`,
        ).toBe(true)
      }
    }

    for (const name of runtimeSharedNames) {
      const rootWrapper = await readFile(path.join(projectRoot, 'shared', name), 'utf8')
      expect(rootWrapper).toContain(`export * from '../server/shared/${name}'`)
      expect(REQUIRED_RUNTIME_FILES.has(`server/shared/${name}`)).toBe(true)
    }
    const persistenceDeclarationWrapper = await readFile(
      path.join(projectRoot, 'shared', 'applicationPersistenceProtocol.d.ts'),
      'utf8',
    )
    expect(persistenceDeclarationWrapper).toContain(
      "export * from '../server/shared/applicationPersistenceProtocol.js'",
    )
  })

  it('builds only legacy-accepted roots and preflights the extracted runtime for real', async () => {
    const [builder, verifier, releasePreflight] = await Promise.all([
      readFile(path.join(projectRoot, 'tools', 'build-update-package.mjs'), 'utf8'),
      readFile(path.join(projectRoot, 'tools', 'verify-update-package.mjs'), 'utf8'),
      readFile(path.join(projectRoot, 'tools', 'release-preflight.mjs'), 'utf8'),
    ])

    expect(builder).toContain("for (const entry of ['dist', 'server'])")
    expect(builder).not.toMatch(/for \(const entry of \[[^\]]*'shared'/u)
    expect(verifier).toContain('await preflightRuntime(validation.extractRoot)')
    expect(releasePreflight).toContain('await verifyBeta8UpdateCompatibility(sourceRoot, packagePath)')
    expect(releasePreflight).toContain('await verifyBeta8UpdateCompatibility(root, packagePath)')
  })
})
