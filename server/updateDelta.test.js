import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGunzip, createGzip } from 'node:zlib'
import tar from 'tar-fs'
import { afterEach, describe, expect, it } from 'vitest'
import { manifestDigest, validateUpdatePackage } from './systemUpdate.js'
import { REQUIRED_RUNTIME_FILES } from './sharedConstants.js'
import {
  createUpdateDeltaPackage,
  materializeUpdateDelta,
  UPDATE_DELTA_MANIFEST_NAME,
} from './updateDelta.js'

const scratchRoots = new Set()
const commonAsset = randomBytes(256 * 1024)

async function scratch(label) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `phd-atlas-${label}-`))
  scratchRoots.add(root)
  return root
}

afterEach(async () => {
  await Promise.all([...scratchRoots].map((root) => fs.rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  })))
  scratchRoots.clear()
})

function packageJson(version) {
  return `${JSON.stringify({
    name: 'phd-atlas',
    version,
    private: true,
    type: 'module',
    dependencies: {},
  }, null, 2)}\n`
}

function packageLock(version) {
  return `${JSON.stringify({
    name: 'phd-atlas',
    version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: 'phd-atlas', version, dependencies: {} },
    },
  }, null, 2)}\n`
}

function runtimeFiles(version, options = {}) {
  const runtimeSharedFiles = options.legacyRuntime
    ? []
    : [...REQUIRED_RUNTIME_FILES]
        .filter((relativePath) => relativePath.startsWith('server/shared/'))
        .map((relativePath) => [relativePath, 'export const runtimeSharedContract = true\n'])
  const files = new Map([
    ['dist/index.html', `<title>PhD Atlas ${version}</title>\n`],
    ['dist/assets/vendor.bin', commonAsset],
    ['server/index.js', `export const runtimeVersion = '${version}'\n`],
    ['server/systemUpdate.js', 'export const updateRuntime = true\n'],
    ...runtimeSharedFiles,
    ['tools/start-server.mjs', 'export const startServer = true\n'],
    ['tools/apply-update.mjs', 'export const applyUpdate = true\n'],
    ['tools/container-entrypoint.mjs', 'export const supervise = true\n'],
    ['package.json', packageJson(version)],
    ['package-lock.json', packageLock(version)],
  ])
  if (options.obsolete) files.set('server/obsolete.js', 'export const obsolete = true\n')
  if (options.added) files.set('server/added.js', 'export const added = true\n')
  if (options.variant) files.set('server/systemUpdate.js', `export const variant = '${options.variant}'\n`)
  if (options.omitHistoricalSupervisor) files.delete('tools/container-entrypoint.mjs')
  return files
}

async function writeRelative(root, relativePath, contents) {
  const destination = path.join(root, ...relativePath.split('/'))
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.writeFile(destination, contents)
}

async function createFullPackage(root, version, options = {}) {
  const stageRoot = path.join(root, `stage-${randomUUID()}`)
  const packagePath = path.join(root, `phd-atlas-update-${version}-${randomUUID()}.tar.gz`)
  const files = []
  for (const [relativePath, contents] of runtimeFiles(version, options)) {
    await writeRelative(stageRoot, relativePath, contents)
    const payload = Buffer.isBuffer(contents) ? contents : Buffer.from(contents)
    files.push({
      path: relativePath,
      size: payload.length,
      sha256: createHash('sha256').update(payload).digest('hex'),
    })
  }
  files.sort((left, right) => left.path.localeCompare(right.path, 'en'))
  const manifest = {
    formatVersion: 1,
    appId: 'phd-atlas',
    version,
    createdAt: '2026-08-01T00:00:00.000Z',
    contentSha256: manifestDigest(files),
    files,
  }
  await writeRelative(stageRoot, 'update-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)
  await writeRelative(stageRoot, 'UPDATE_PACKAGE_README.txt', 'Complete test update.\n')
  await pipeline(tar.pack(stageRoot), createGzip({ level: 9 }), createWriteStream(packagePath))
  return { packagePath, manifest }
}

async function tamperDeltaPayload(root, deltaPath) {
  const extractRoot = path.join(root, 'tampered-delta')
  const outputPath = path.join(root, 'tampered-delta.tar.gz')
  await pipeline(createReadStream(deltaPath), createGunzip(), tar.extract(extractRoot))
  const manifest = JSON.parse(await fs.readFile(path.join(extractRoot, UPDATE_DELTA_MANIFEST_NAME), 'utf8'))
  const changed = manifest.changedFiles[0]
  await fs.appendFile(path.join(extractRoot, 'payload', ...changed.path.split('/')), 'tampered')
  await pipeline(tar.pack(extractRoot), createGzip({ level: 9 }), createWriteStream(outputPath))
  return outputPath
}

describe('differential system updates', () => {
  it('ships changed files only and reconstructs a complete validated target package', async () => {
    const root = await scratch('update-delta-roundtrip')
    const base = await createFullPackage(root, '0.1.0-beta.8', { obsolete: true })
    const target = await createFullPackage(root, '0.1.0-beta.9', { added: true })
    const deltaPath = path.join(root, 'delta.tar.gz')
    const built = await createUpdateDeltaPackage({
      basePackagePath: base.packagePath,
      targetPackagePath: target.packagePath,
      outputPath: deltaPath,
      workRoot: path.join(root, 'build-work'),
    })

    expect(built).toMatchObject({
      fromVersion: '0.1.0-beta.8',
      toVersion: '0.1.0-beta.9',
      removedFileCount: 1,
    })
    expect(built.changedFileCount).toBeGreaterThan(0)
    expect(built.size).toBeLessThan(built.fullSize)
    const secondDeltaPath = path.join(root, 'delta-second.tar.gz')
    await createUpdateDeltaPackage({
      basePackagePath: base.packagePath,
      targetPackagePath: target.packagePath,
      outputPath: secondDeltaPath,
      workRoot: path.join(root, 'second-build-work'),
    })
    expect(await fs.readFile(secondDeltaPath)).toEqual(await fs.readFile(deltaPath))

    const materializedPath = path.join(root, 'materialized.tar.gz')
    const materialized = await materializeUpdateDelta({
      deltaPackagePath: deltaPath,
      basePackagePath: base.packagePath,
      outputPackagePath: materializedPath,
      workRoot: path.join(root, 'materialize-work'),
      expectedFromVersion: '0.1.0-beta.8',
      expectedToVersion: '0.1.0-beta.9',
    })
    expect(materialized).toMatchObject({
      fromVersion: '0.1.0-beta.8',
      toVersion: '0.1.0-beta.9',
    })
    const validated = await validateUpdatePackage(materializedPath, path.join(root, 'validation'))
    try {
      expect(validated.manifest.contentSha256).toBe(target.manifest.contentSha256)
      await expect(fs.access(path.join(validated.extractRoot, 'server', 'added.js')))
        .resolves.toBeUndefined()
      await expect(fs.access(path.join(validated.extractRoot, 'server', 'obsolete.js')))
        .rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await fs.rm(validated.extractRoot, { recursive: true, force: true })
    }
  })

  it('accepts an integrity-valid legacy Release only as a delta base', async () => {
    const root = await scratch('update-delta-legacy-base')
    const base = await createFullPackage(root, '0.1.1', { legacyRuntime: true })
    const target = await createFullPackage(root, '0.1.3', { added: true })
    const deltaPath = path.join(root, 'legacy-base-delta.tar.gz')

    await expect(validateUpdatePackage(base.packagePath, path.join(root, 'strict-base-validation')))
      .rejects.toMatchObject({ code: 'INVALID_UPDATE_PACKAGE' })

    const built = await createUpdateDeltaPackage({
      basePackagePath: base.packagePath,
      targetPackagePath: target.packagePath,
      outputPath: deltaPath,
      workRoot: path.join(root, 'build-work'),
    })
    expect(built).toMatchObject({ fromVersion: '0.1.1', toVersion: '0.1.3' })

    const materializedPath = path.join(root, 'materialized-update.tar.gz')
    await materializeUpdateDelta({
      deltaPackagePath: deltaPath,
      basePackagePath: base.packagePath,
      outputPackagePath: materializedPath,
      workRoot: path.join(root, 'materialize-work'),
      expectedFromVersion: '0.1.1',
      expectedToVersion: '0.1.3',
    })

    const validated = await validateUpdatePackage(materializedPath, path.join(root, 'target-validation'))
    try {
      for (const required of REQUIRED_RUNTIME_FILES) {
        expect(validated.manifest.files).toContainEqual(expect.objectContaining({ path: required }))
      }
    } finally {
      await fs.rm(validated.extractRoot, { recursive: true, force: true })
    }
  })

  it('keeps historical delta bases fail-closed and never accepts a legacy target', async () => {
    const root = await scratch('update-delta-legacy-boundaries')
    const incompleteBase = await createFullPackage(root, '0.1.1', {
      legacyRuntime: true,
      omitHistoricalSupervisor: true,
    })
    const currentBase = await createFullPackage(root, '0.1.2')
    const currentTarget = await createFullPackage(root, '0.1.3')
    const legacyTarget = await createFullPackage(root, '0.1.3', { legacyRuntime: true })

    await expect(createUpdateDeltaPackage({
      basePackagePath: incompleteBase.packagePath,
      targetPackagePath: currentTarget.packagePath,
      outputPath: path.join(root, 'incomplete-base-delta.tar.gz'),
      workRoot: path.join(root, 'incomplete-base-work'),
    })).rejects.toMatchObject({ code: 'INVALID_UPDATE_PACKAGE' })

    await expect(createUpdateDeltaPackage({
      basePackagePath: currentBase.packagePath,
      targetPackagePath: legacyTarget.packagePath,
      outputPath: path.join(root, 'legacy-target-delta.tar.gz'),
      workRoot: path.join(root, 'legacy-target-work'),
    })).rejects.toMatchObject({ code: 'INVALID_UPDATE_PACKAGE' })
  })

  it('rejects a mismatched base fingerprint and a modified delta payload', async () => {
    const root = await scratch('update-delta-integrity')
    const base = await createFullPackage(root, '0.1.0-beta.8')
    const wrongBase = await createFullPackage(root, '0.1.0-beta.8', { variant: 'wrong-base' })
    const target = await createFullPackage(root, '0.1.0-beta.9', { added: true })
    const deltaPath = path.join(root, 'delta.tar.gz')
    await createUpdateDeltaPackage({
      basePackagePath: base.packagePath,
      targetPackagePath: target.packagePath,
      outputPath: deltaPath,
      workRoot: path.join(root, 'build-work'),
    })

    await expect(materializeUpdateDelta({
      deltaPackagePath: deltaPath,
      basePackagePath: wrongBase.packagePath,
      outputPackagePath: path.join(root, 'wrong-base-output.tar.gz'),
      workRoot: path.join(root, 'wrong-base-work'),
    })).rejects.toMatchObject({ code: 'INVALID_UPDATE_DELTA' })

    const tamperedDelta = await tamperDeltaPayload(root, deltaPath)
    await expect(materializeUpdateDelta({
      deltaPackagePath: tamperedDelta,
      basePackagePath: base.packagePath,
      outputPackagePath: path.join(root, 'tampered-output.tar.gz'),
      workRoot: path.join(root, 'tampered-work'),
    })).rejects.toMatchObject({ code: 'UPDATE_DELTA_INTEGRITY_FAILED' })
  })
})
