import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import tar from 'tar-fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ACTIVE_UPDATE_DIRECTORY_NAME,
  ACTIVE_UPDATE_POINTER_NAME,
  applyUpdatePackage,
  claimPendingUpdateBoot,
  claimUpdateLock,
  clearUpdateLock,
  confirmPendingUpdateBoot,
  preflightRuntime,
  readActiveUpdatePackage,
  readPendingUpdateBoot,
  readUpdateLockState,
  recoverAbandonedPendingUpdateBoot,
  recoverAbandonedUpdateLock,
  replayActiveUpdateIfNeeded,
  UPDATE_BOOT_PENDING_NAME,
  UPDATE_RESULT_NAME,
  UPDATE_RUNTIME_INVALID_NAME,
  validateUpdatePackage,
  writeUpdateLock,
} from './systemUpdate.js'

const scratchRoots = new Set()

async function scratch(label) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `phd-atlas-${label}-`))
  scratchRoots.add(root)
  return root
}

afterEach(async () => {
  await Promise.all([...scratchRoots].map((root) => fs.rm(root, { recursive: true, force: true })))
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
      '': {
        name: 'phd-atlas',
        version,
        dependencies: {},
      },
    },
  }, null, 2)}\n`
}

function runtimeFiles(version) {
  return new Map([
    ['dist/index.html', `<title>PhD Atlas ${version}</title>\n`],
    ['dist/assets/Asset-Z.js', 'export const upperCaseAsset = true\n'],
    ['dist/assets/asset-a.js', 'export const lowerCaseAsset = true\n'],
    ['server/index.js', `export const runtimeVersion = '${version}'\n`],
    ['server/systemUpdate.js', `export const runtimeVersion = '${version}'\n`],
    ['tools/start-server.mjs', `export const runtimeVersion = '${version}'\n`],
    ['tools/apply-update.mjs', `export const runtimeVersion = '${version}'\n`],
    ['tools/container-entrypoint.mjs', `export const runtimeVersion = '${version}'\n`],
    ['package.json', packageJson(version)],
    ['package-lock.json', packageLock(version)],
  ])
}

async function writeRelative(root, relativePath, contents) {
  const target = path.join(root, ...relativePath.split('/'))
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, contents)
}

function compareArchivePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function contentFingerprint(files) {
  const hash = createHash('sha256')
  for (const file of [...files].sort((left, right) => compareArchivePaths(left.path, right.path))) {
    hash.update(`${file.path}\0${file.sha256}\0${file.size}\n`)
  }
  return hash.digest('hex')
}

async function createUpdatePackage(root, version, options = {}) {
  const stageRoot = path.join(root, `stage-${randomUUID()}`)
  const packagePath = path.join(root, `phd-atlas-${version}-${randomUUID()}.tar.gz`)
  const sources = runtimeFiles(version)
  if (options.omitSupervisor) sources.delete('tools/container-entrypoint.mjs')
  if (options.brokenStartServer) {
    sources.set('tools/start-server.mjs', 'export const broken =\n')
  }
  const files = []
  for (const [relativePath, contents] of sources) {
    await writeRelative(stageRoot, relativePath, contents)
    const payload = Buffer.from(contents)
    files.push({
      path: relativePath,
      size: payload.length,
      sha256: createHash('sha256').update(payload).digest('hex'),
    })
  }
  files.sort((left, right) => compareArchivePaths(left.path, right.path))
  await writeRelative(stageRoot, 'update-manifest.json', `${JSON.stringify({
    formatVersion: 1,
    appId: 'phd-atlas',
    version,
    contentSha256: contentFingerprint(files),
    files,
  }, null, 2)}\n`)
  await writeRelative(stageRoot, 'UPDATE_PACKAGE_README.txt', 'Verified PhD Atlas update package.\n')
  if (options.extraUnmanifestedFile) {
    await writeRelative(stageRoot, 'server/unmanifested.js', 'throw new Error("must not be installed")\n')
  }
  await pipeline(tar.pack(stageRoot), createGzip(), createWriteStream(packagePath))
  return packagePath
}

function createTarHeader(name, size, type = '0') {
  const header = Buffer.alloc(512)
  const writeText = (offset, length, value) => {
    header.write(value, offset, Math.min(length, Buffer.byteLength(value)), 'ascii')
  }
  const writeOctal = (offset, length, value) => {
    writeText(offset, length, `${value.toString(8).padStart(length - 1, '0')}\0`)
  }
  writeText(0, 100, name)
  writeOctal(100, 8, 0o644)
  writeOctal(108, 8, 0)
  writeOctal(116, 8, 0)
  writeOctal(124, 12, size)
  writeOctal(136, 12, 0)
  writeText(148, 8, '        ')
  writeText(156, 1, type)
  writeText(257, 6, 'ustar\0')
  writeText(263, 2, '00')
  const checksum = header.reduce((sum, value) => sum + value, 0)
  writeText(148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `)
  return header
}

async function createOversizedHeaderArchive(root) {
  const header = createTarHeader('server/oversized.bin', 129 * 1024 * 1024)
  const packagePath = path.join(root, 'oversized-header.tar.gz')
  await pipeline(
    Readable.from([header, Buffer.alloc(1_024)]),
    createGzip(),
    createWriteStream(packagePath),
  )
  return packagePath
}

async function createPaxGzipBomb(root) {
  const payloadSize = 321 * 1024 * 1024
  const header = createTarHeader('pax-extensions', payloadSize, 'x')
  const zeroChunk = Buffer.alloc(1024 * 1024)
  async function* tarPayload() {
    yield header
    for (let index = 0; index < 321; index += 1) yield zeroChunk
    yield Buffer.alloc(1_024)
  }
  const packagePath = path.join(root, 'pax-gzip-bomb.tar.gz')
  await pipeline(
    Readable.from(tarPayload()),
    createGzip(),
    createWriteStream(packagePath),
  )
  return packagePath
}

async function createDuplicateRootArchive(root) {
  const packagePath = path.join(root, 'duplicate-root.tar.gz')
  await pipeline(
    Readable.from([
      createTarHeader('./', 0, '5'),
      createTarHeader('./', 0, '5'),
      Buffer.alloc(1_024),
    ]),
    createGzip(),
    createWriteStream(packagePath),
  )
  return packagePath
}

async function createRuntime(root, version, options = {}) {
  for (const [relativePath, contents] of runtimeFiles(version)) {
    await writeRelative(root, relativePath, contents)
  }
  await writeRelative(root, 'server/pre-update-sentinel.txt', `runtime-${version}\n`)
  if (options.staleTool) {
    await writeRelative(root, 'tools/stale-tool.mjs', 'throw new Error("stale tool")\n')
  }
  await fs.mkdir(path.join(root, 'storage'), { recursive: true })
  return root
}

describe('system update package safety', () => {
  it('validates content fingerprints with locale-independent archive ordering', async () => {
    const root = await scratch('update-fingerprint-order')
    const packagePath = await createUpdatePackage(root, '0.2.0-beta.1')
    const validated = await validateUpdatePackage(packagePath, path.join(root, 'work'))

    try {
      expect(validated.manifest.files.map((file) => file.path)).toEqual(
        [...validated.manifest.files.map((file) => file.path)].sort(compareArchivePaths),
      )
      expect(validated.manifest.files).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: 'dist/assets/Asset-Z.js' }),
        expect.objectContaining({ path: 'dist/assets/asset-a.js' }),
      ]))
    } finally {
      await fs.rm(validated.extractRoot, { recursive: true, force: true })
    }
  })

  it('rejects missing supervisors and unmanifested runtime files', async () => {
    const root = await scratch('update-validation')
    const missingSupervisor = await createUpdatePackage(root, '0.2.0-beta.1', { omitSupervisor: true })
    const unmanifested = await createUpdatePackage(root, '0.2.0-beta.1', { extraUnmanifestedFile: true })

    await expect(validateUpdatePackage(missingSupervisor, path.join(root, 'missing-work')))
      .rejects.toMatchObject({ code: 'INVALID_UPDATE_PACKAGE' })
    await expect(validateUpdatePackage(unmanifested, path.join(root, 'extra-work')))
      .rejects.toMatchObject({ code: 'INVALID_UPDATE_PACKAGE' })
  })

  it('rejects oversized archive headers before extraction and removes partial work', async () => {
    const root = await scratch('update-archive-limits')
    const packagePath = await createOversizedHeaderArchive(root)
    const duplicateRootPackage = await createDuplicateRootArchive(root)
    const workRoot = path.join(root, 'work')

    await expect(validateUpdatePackage(packagePath, workRoot))
      .rejects.toMatchObject({ code: 'INVALID_UPDATE_PACKAGE' })
    await expect(validateUpdatePackage(duplicateRootPackage, workRoot))
      .rejects.toMatchObject({ code: 'INVALID_UPDATE_PACKAGE' })
    const remaining = await fs.readdir(workRoot).catch((error) => {
      if (error?.code === 'ENOENT') return []
      throw error
    })
    expect(remaining).toEqual([])
  })

  it('bounds the decompressed tar stream before tar extensions can buffer a gzip bomb', async () => {
    const root = await scratch('update-gzip-bomb')
    const packagePath = await createPaxGzipBomb(root)
    const workRoot = path.join(root, 'work')

    await expect(validateUpdatePackage(packagePath, workRoot))
      .rejects.toMatchObject({ code: 'INVALID_UPDATE_PACKAGE' })
    const remaining = await fs.readdir(workRoot).catch((error) => {
      if (error?.code === 'ENOENT') return []
      throw error
    })
    expect(remaining).toEqual([])
  }, 45_000)

  it('persists an independent active package and replays it over an old image runtime', async () => {
    const root = await scratch('active-update')
    const sourcePackage = await createUpdatePackage(root, '0.2.0-beta.2')
    const installedRoot = await createRuntime(path.join(root, 'installed'), '0.1.0-beta.1', {
      staleTool: true,
    })
    const storageRoot = path.join(installedRoot, 'storage')
    const stagingRoot = path.join(storageRoot, 'update-packages')
    const stagedPackage = path.join(stagingRoot, 'candidate.tar.gz')
    await fs.mkdir(stagingRoot, { recursive: true })
    await fs.copyFile(sourcePackage, stagedPackage)

    const applied = await applyUpdatePackage({
      packagePath: stagedPackage,
      projectRoot: installedRoot,
      storageRoot,
      installDependencies: async () => {},
    })
    expect(applied).toMatchObject({ ok: true, toVersion: '0.2.0-beta.2' })
    await expect(fs.access(path.join(installedRoot, 'tools', 'stale-tool.mjs')))
      .rejects.toMatchObject({ code: 'ENOENT' })

    const activeBeforeDeletion = await readActiveUpdatePackage(storageRoot)
    expect(activeBeforeDeletion).toMatchObject({
      version: '0.2.0-beta.2',
      packageSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      packageSize: expect.any(Number),
      files: expect.arrayContaining([
        expect.objectContaining({ path: 'tools/container-entrypoint.mjs' }),
      ]),
    })
    await fs.rm(stagingRoot, { recursive: true, force: true })
    await expect(fs.access(activeBeforeDeletion.packagePath)).resolves.toBeUndefined()
    await expect(fs.access(path.join(
      storageRoot,
      ACTIVE_UPDATE_DIRECTORY_NAME,
      ACTIVE_UPDATE_POINTER_NAME,
    ))).resolves.toBeUndefined()

    const oldImageRoot = await createRuntime(path.join(root, 'old-image'), '0.1.0-beta.1')
    let dependencyInstalls = 0
    const replayed = await replayActiveUpdateIfNeeded({
      projectRoot: oldImageRoot,
      storageRoot,
      installDependencies: async () => {
        dependencyInstalls += 1
      },
    })
    const replayedPackage = JSON.parse(await fs.readFile(path.join(oldImageRoot, 'package.json'), 'utf8'))
    expect(replayed).toMatchObject({ replayed: true, version: '0.2.0-beta.2' })
    expect(replayedPackage.version).toBe('0.2.0-beta.2')
    expect(dependencyInstalls).toBe(1)
  })

  it('keeps a newer container image instead of replaying an older active beta', async () => {
    const root = await scratch('active-no-downgrade')
    const activePackage = await createUpdatePackage(root, '0.2.0-beta.2')
    const initialRoot = await createRuntime(path.join(root, 'initial'), '0.1.0-beta.1')
    const storageRoot = path.join(initialRoot, 'storage')
    await applyUpdatePackage({
      packagePath: activePackage,
      projectRoot: initialRoot,
      storageRoot,
      installDependencies: async () => {},
    })
    const staleActive = await readActiveUpdatePackage(storageRoot)
    const stalePending = await readPendingUpdateBoot(storageRoot)
    await fs.rm(staleActive.packagePath)

    const newerImageRoot = await createRuntime(path.join(root, 'newer-image'), '0.2.0-beta.3')
    const installDependencies = vi.fn(async () => {
      throw new Error('an older active package must not be installed')
    })
    const result = await replayActiveUpdateIfNeeded({
      projectRoot: newerImageRoot,
      storageRoot,
      baseVersion: '0.2.0-beta.3',
      baseRuntimeVerified: true,
      installDependencies,
    })
    const retainedPackage = JSON.parse(await fs.readFile(path.join(newerImageRoot, 'package.json'), 'utf8'))

    expect(result).toMatchObject({
      replayed: false,
      version: '0.2.0-beta.3',
      ignoredActiveVersion: '0.2.0-beta.2',
    })
    expect(retainedPackage.version).toBe('0.2.0-beta.3')
    expect(installDependencies).not.toHaveBeenCalled()
    await expect(readActiveUpdatePackage(storageRoot)).resolves.toBeNull()
    await expect(readPendingUpdateBoot(storageRoot)).resolves.toBeNull()
    await expect(fs.access(stalePending.rollbackRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    const ignoredRecord = JSON.parse(await fs.readFile(
      path.join(storageRoot, ACTIVE_UPDATE_DIRECTORY_NAME, 'last-ignored.json'),
      'utf8',
    ))
    expect(ignoredRecord).toMatchObject({
      activeVersion: '0.2.0-beta.2',
      baseVersion: '0.2.0-beta.3',
    })
  })

  it('repairs and clears an old invalid marker only after verifying a clean image runtime', async () => {
    const root = await scratch('clean-image-recovery')
    const projectRoot = await createRuntime(path.join(root, 'runtime'), '0.2.0-beta.3')
    const storageRoot = path.join(projectRoot, 'storage')
    await fs.writeFile(path.join(storageRoot, UPDATE_RUNTIME_INVALID_NAME), JSON.stringify({
      reason: 'previous writable layer failed',
    }))
    const installDependencies = vi.fn(async () => {})

    const result = await replayActiveUpdateIfNeeded({
      projectRoot,
      storageRoot,
      baseVersion: '0.2.0-beta.3',
      baseRuntimeVerified: true,
      requireVerifiedBase: true,
      installDependencies,
    })

    expect(result).toMatchObject({
      replayed: false,
      version: '0.2.0-beta.3',
      recoveredBaseRuntime: true,
    })
    expect(installDependencies).toHaveBeenCalledOnce()
    await expect(fs.access(path.join(storageRoot, UPDATE_RUNTIME_INVALID_NAME)))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('confirms a healthy first boot and restores the previous active package after a failed next boot', async () => {
    const root = await scratch('boot-rollback')
    const firstPackage = await createUpdatePackage(root, '0.2.0-beta.2')
    const nextPackage = await createUpdatePackage(root, '0.2.0-beta.3')
    const projectRoot = await createRuntime(path.join(root, 'runtime'), '0.1.0-beta.1')
    const storageRoot = path.join(projectRoot, 'storage')

    await applyUpdatePackage({
      packagePath: firstPackage,
      projectRoot,
      storageRoot,
      installDependencies: async () => {},
    })
    const firstBoot = await readPendingUpdateBoot(storageRoot)
    await claimPendingUpdateBoot(storageRoot, 101)
    await confirmPendingUpdateBoot(storageRoot, 101)
    await expect(fs.access(firstBoot.rollbackRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    const knownGood = await readActiveUpdatePackage(storageRoot)

    await applyUpdatePackage({
      packagePath: nextPackage,
      projectRoot,
      storageRoot,
      installDependencies: async () => {},
    })
    const pending = await readPendingUpdateBoot(storageRoot)
    expect(pending).toMatchObject({
      fromVersion: '0.2.0-beta.2',
      toVersion: '0.2.0-beta.3',
      previousActive: expect.objectContaining({
        packageSha256: knownGood.packageSha256,
      }),
      bootPid: null,
    })
    const failedCandidate = await readActiveUpdatePackage(storageRoot)
    await fs.rm(failedCandidate.packagePath)
    await claimPendingUpdateBoot(storageRoot, 202)

    const recovered = await recoverAbandonedPendingUpdateBoot({
      projectRoot,
      storageRoot,
      installDependencies: async () => {},
      processExists: async () => false,
    })
    const restoredPackage = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'))
    const restoredActive = await readActiveUpdatePackage(storageRoot)

    expect(recovered).toMatchObject({
      rolledBack: true,
      version: '0.2.0-beta.2',
      previousActiveVersion: '0.2.0-beta.2',
    })
    expect(restoredPackage.version).toBe('0.2.0-beta.2')
    expect(restoredActive.packageSha256).toBe(knownGood.packageSha256)
    await expect(readPendingUpdateBoot(storageRoot)).resolves.toBeNull()
  })

  it('restores a missing previous active package from the durable rollback backup', async () => {
    const root = await scratch('boot-rollback-missing-previous-package')
    const firstPackage = await createUpdatePackage(root, '0.2.0-beta.2')
    const nextPackage = await createUpdatePackage(root, '0.2.0-beta.3')
    const projectRoot = await createRuntime(path.join(root, 'runtime'), '0.1.0-beta.1')
    const storageRoot = path.join(projectRoot, 'storage')

    await applyUpdatePackage({
      packagePath: firstPackage,
      projectRoot,
      storageRoot,
      installDependencies: async () => {},
    })
    await claimPendingUpdateBoot(storageRoot, 301)
    await confirmPendingUpdateBoot(storageRoot, 301)
    const knownGood = await readActiveUpdatePackage(storageRoot)

    await applyUpdatePackage({
      packagePath: nextPackage,
      projectRoot,
      storageRoot,
      installDependencies: async () => {},
    })
    await fs.rm(knownGood.packagePath)
    await claimPendingUpdateBoot(storageRoot, 302)

    const recovered = await recoverAbandonedPendingUpdateBoot({
      projectRoot,
      storageRoot,
      installDependencies: async () => {},
      processExists: async () => false,
    })
    const restoredActive = await readActiveUpdatePackage(storageRoot)
    const nextPreparation = await replayActiveUpdateIfNeeded({
      projectRoot,
      storageRoot,
      baseVersion: '0.1.0-beta.1',
      baseRuntimeVerified: true,
      requireVerifiedBase: true,
      installDependencies: async () => {},
    })

    expect(recovered).toMatchObject({
      rolledBack: true,
      version: '0.2.0-beta.2',
      previousActiveVersion: '0.2.0-beta.2',
    })
    expect(restoredActive.packageSha256).toBe(knownGood.packageSha256)
    expect(nextPreparation).toMatchObject({
      replayed: false,
      version: '0.2.0-beta.2',
      runtimeVerified: true,
    })
    await expect(readPendingUpdateBoot(storageRoot)).resolves.toBeNull()
  })

  it('fails closed when first-boot rollback cannot restore dependencies', async () => {
    const root = await scratch('boot-rollback-failure')
    const updatePackage = await createUpdatePackage(root, '0.2.0-beta.2')
    const projectRoot = await createRuntime(path.join(root, 'runtime'), '0.1.0-beta.1')
    const storageRoot = path.join(projectRoot, 'storage')
    await applyUpdatePackage({
      packagePath: updatePackage,
      projectRoot,
      storageRoot,
      installDependencies: async () => {},
    })
    await claimPendingUpdateBoot(storageRoot, 303)

    await expect(recoverAbandonedPendingUpdateBoot({
      projectRoot,
      storageRoot,
      installDependencies: async () => {
        throw new Error('rollback dependencies unavailable')
      },
      processExists: async () => false,
    })).rejects.toMatchObject({ code: 'UPDATE_BOOT_ROLLBACK_FAILED' })

    await expect(fs.access(path.join(storageRoot, UPDATE_RUNTIME_INVALID_NAME))).resolves.toBeUndefined()
    await expect(fs.access(path.join(storageRoot, UPDATE_BOOT_PENDING_NAME))).resolves.toBeUndefined()
  })

  it('keeps the previous active package when a same-target replay fails before boot', async () => {
    const root = await scratch('pending-replay-failure')
    const firstPackage = await createUpdatePackage(root, '0.2.0-beta.2')
    const candidatePackage = await createUpdatePackage(root, '0.2.0-beta.3')
    const initialRoot = await createRuntime(path.join(root, 'initial'), '0.1.0-beta.1')
    const storageRoot = path.join(initialRoot, 'storage')
    await applyUpdatePackage({
      packagePath: firstPackage,
      projectRoot: initialRoot,
      storageRoot,
      installDependencies: async () => {},
    })
    await claimPendingUpdateBoot(storageRoot, 707)
    await confirmPendingUpdateBoot(storageRoot, 707)
    const knownGood = await readActiveUpdatePackage(storageRoot)
    await applyUpdatePackage({
      packagePath: candidatePackage,
      projectRoot: initialRoot,
      storageRoot,
      installDependencies: async () => {},
    })

    const recreatedRoot = await createRuntime(path.join(root, 'recreated'), '0.1.0-beta.1')
    await expect(replayActiveUpdateIfNeeded({
      projectRoot: recreatedRoot,
      storageRoot,
      installDependencies: async () => {},
      runtimePreflight: async () => {
        throw new Error('candidate import failed')
      },
    })).rejects.toMatchObject({
      code: 'UPDATE_APPLY_FAILED',
      rollbackFailed: false,
    })

    const restoredPackage = JSON.parse(await fs.readFile(path.join(recreatedRoot, 'package.json'), 'utf8'))
    const restoredActive = await readActiveUpdatePackage(storageRoot)
    expect(restoredPackage.version).toBe('0.2.0-beta.2')
    expect(restoredActive.packageSha256).toBe(knownGood.packageSha256)
    await expect(readPendingUpdateBoot(storageRoot)).resolves.toBeNull()
  })

  it('durably restores the previous package after a recreated same-target candidate fails boot', async () => {
    const root = await scratch('pending-replay-boot-rollback')
    const firstPackage = await createUpdatePackage(root, '0.2.0-beta.2')
    const candidatePackage = await createUpdatePackage(root, '0.2.0-beta.3')
    const initialRoot = await createRuntime(path.join(root, 'initial'), '0.1.0-beta.1')
    const storageRoot = path.join(initialRoot, 'storage')
    await applyUpdatePackage({
      packagePath: firstPackage,
      projectRoot: initialRoot,
      storageRoot,
      installDependencies: async () => {},
    })
    await claimPendingUpdateBoot(storageRoot, 801)
    await confirmPendingUpdateBoot(storageRoot, 801)
    const knownGood = await readActiveUpdatePackage(storageRoot)
    await applyUpdatePackage({
      packagePath: candidatePackage,
      projectRoot: initialRoot,
      storageRoot,
      installDependencies: async () => {},
    })

    const recreatedRoot = await createRuntime(path.join(root, 'recreated'), '0.1.0-beta.1')
    await expect(replayActiveUpdateIfNeeded({
      projectRoot: recreatedRoot,
      storageRoot,
      installDependencies: async () => {},
    })).resolves.toMatchObject({
      replayed: true,
      version: '0.2.0-beta.3',
    })
    await fs.rm(knownGood.packagePath)
    await claimPendingUpdateBoot(storageRoot, 802)

    await expect(recoverAbandonedPendingUpdateBoot({
      projectRoot: recreatedRoot,
      storageRoot,
      installDependencies: async () => {},
      processExists: async () => false,
    })).resolves.toMatchObject({
      rolledBack: true,
      version: '0.2.0-beta.2',
      previousActiveVersion: '0.2.0-beta.2',
    })
    const nextPreparation = await replayActiveUpdateIfNeeded({
      projectRoot: recreatedRoot,
      storageRoot,
      baseVersion: '0.1.0-beta.1',
      baseRuntimeVerified: true,
      requireVerifiedBase: true,
      installDependencies: async () => {},
    })
    const restoredActive = await readActiveUpdatePackage(storageRoot)
    expect(restoredActive.packageSha256).toBe(knownGood.packageSha256)
    expect(nextPreparation).toMatchObject({
      replayed: false,
      version: '0.2.0-beta.2',
      runtimeVerified: true,
    })
  })

  it('rejects direct downgrades and rolls back a runtime with broken launcher syntax', async () => {
    const root = await scratch('version-and-preflight')
    const olderPackage = await createUpdatePackage(root, '0.2.0-beta.2')
    const brokenPackage = await createUpdatePackage(root, '0.2.0-beta.4', {
      brokenStartServer: true,
    })
    const projectRoot = await createRuntime(path.join(root, 'runtime'), '0.2.0-beta.3')
    const storageRoot = path.join(projectRoot, 'storage')
    const installDependencies = vi.fn(async () => {})

    await expect(applyUpdatePackage({
      packagePath: olderPackage,
      projectRoot,
      storageRoot,
      installDependencies,
    })).rejects.toMatchObject({ code: 'UPDATE_VERSION_NOT_NEWER' })
    expect(installDependencies).not.toHaveBeenCalled()

    await expect(applyUpdatePackage({
      packagePath: brokenPackage,
      projectRoot,
      storageRoot,
      installDependencies,
      runtimePreflight: preflightRuntime,
    })).rejects.toMatchObject({
      code: 'UPDATE_APPLY_FAILED',
      rollbackFailed: false,
    })
    const restoredPackage = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'))
    expect(restoredPackage.version).toBe('0.2.0-beta.3')
    await expect(readPendingUpdateBoot(storageRoot)).resolves.toBeNull()
  })

  it('recovers abandoned locks by phase and prevents an old helper from clearing its successor', async () => {
    const root = await scratch('stale-locks')
    const projectRoot = await createRuntime(path.join(root, 'runtime'), '0.1.0-beta.1')
    const storageRoot = path.join(projectRoot, 'storage')
    const firstPackagePath = path.join(storageRoot, 'first.tar.gz')
    const successorPackagePath = path.join(storageRoot, 'successor.tar.gz')

    await writeUpdateLock(storageRoot, {
      packagePath: firstPackagePath,
      previousPid: 9001,
      requestedAt: '2020-01-01T00:00:00.000Z',
    })
    const beforeMutation = await recoverAbandonedUpdateLock({
      projectRoot,
      storageRoot,
      installDependencies: async () => {},
      processExists: async () => false,
      now: () => Date.parse('2020-01-01T00:01:00.000Z'),
    })
    expect(beforeMutation).toMatchObject({ recovered: true, runtimeChanged: false })
    await expect(readUpdateLockState(storageRoot)).resolves.toBeNull()

    await writeUpdateLock(storageRoot, {
      packagePath: firstPackagePath,
      requestedAt: '2020-01-01T00:00:00.000Z',
    })
    await claimUpdateLock(storageRoot, { packagePath: firstPackagePath, helperPid: 606 })
    const liveHelper = await recoverAbandonedUpdateLock({
      projectRoot,
      storageRoot,
      installDependencies: async () => {},
      processExists: async (processId) => processId === 606,
      now: () => Date.parse('2020-01-01T00:05:00.000Z'),
    })
    expect(liveHelper).toMatchObject({ recovered: false, lockPresent: true, active: true })
    await clearUpdateLock(storageRoot)

    await writeUpdateLock(storageRoot, {
      packagePath: firstPackagePath,
      requestedAt: '2020-01-01T00:00:00.000Z',
    })
    await claimUpdateLock(storageRoot, { packagePath: firstPackagePath, helperPid: 404 })
    await writeUpdateLock(storageRoot, {
      packagePath: successorPackagePath,
      requestedAt: '2020-01-01T00:00:01.000Z',
    })
    await expect(clearUpdateLock(storageRoot, {
      packagePath: firstPackagePath,
      helperPid: 404,
    })).resolves.toBe(false)
    await expect(readUpdateLockState(storageRoot)).resolves.toMatchObject({
      packagePath: successorPackagePath,
    })
    await clearUpdateLock(storageRoot)

    const updateId = '1700000000000-deadbeef'
    const rollbackRoot = path.join(storageRoot, 'update-rollbacks', updateId)
    for (const entry of ['dist', 'server', 'tools', 'package.json', 'package-lock.json']) {
      await fs.cp(path.join(projectRoot, entry), path.join(rollbackRoot, entry), { recursive: true })
    }
    await writeUpdateLock(storageRoot, {
      updateId,
      phase: 'applying',
      helperPid: 505,
      packagePath: firstPackagePath,
      requestedAt: '2020-01-01T00:00:00.000Z',
      fromVersion: '0.1.0-beta.1',
      toVersion: '0.2.0-beta.2',
      rollbackRoot,
      previousActive: null,
    })
    await writeRelative(projectRoot, 'package.json', packageJson('0.2.0-beta.2'))
    await writeRelative(projectRoot, 'server/index.js', 'throw new Error("partial update")\n')

    const midApply = await recoverAbandonedUpdateLock({
      projectRoot,
      storageRoot,
      installDependencies: async () => {},
      processExists: async () => false,
    })
    const recoveredPackage = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'))
    expect(midApply).toMatchObject({
      recovered: true,
      runtimeChanged: true,
      rollback: expect.objectContaining({ rolledBack: true }),
    })
    expect(recoveredPackage.version).toBe('0.1.0-beta.1')
    await expect(readUpdateLockState(storageRoot)).resolves.toBeNull()
  })

  it('fails closed when an abandoned-update rollback snapshot lacks the Docker supervisor', async () => {
    const root = await scratch('rollback-supervisor-required')
    const projectRoot = await createRuntime(path.join(root, 'runtime'), '0.1.0-beta.1')
    const storageRoot = path.join(projectRoot, 'storage')
    const updateId = '1700000000000-cafebabe'
    const rollbackRoot = path.join(storageRoot, 'update-rollbacks', updateId)
    for (const entry of ['dist', 'server', 'tools', 'package.json', 'package-lock.json']) {
      await fs.cp(path.join(projectRoot, entry), path.join(rollbackRoot, entry), { recursive: true })
    }
    await fs.rm(path.join(rollbackRoot, 'tools', 'container-entrypoint.mjs'))
    await writeUpdateLock(storageRoot, {
      updateId,
      phase: 'applying',
      helperPid: 808,
      packagePath: path.join(storageRoot, 'candidate.tar.gz'),
      requestedAt: '2020-01-01T00:00:00.000Z',
      fromVersion: '0.1.0-beta.1',
      toVersion: '0.2.0-beta.2',
      rollbackRoot,
      previousActive: null,
    })

    await expect(recoverAbandonedUpdateLock({
      projectRoot,
      storageRoot,
      installDependencies: async () => {},
      processExists: async () => false,
    })).rejects.toMatchObject({ code: 'UPDATE_BOOT_ROLLBACK_FAILED' })
    await expect(fs.access(path.join(storageRoot, UPDATE_RUNTIME_INVALID_NAME))).resolves.toBeUndefined()
  })

  it('reports a successful dependency rollback without marking the runtime invalid', async () => {
    const root = await scratch('update-rollback')
    const updatePackage = await createUpdatePackage(root, '0.2.0-beta.2')
    const projectRoot = await createRuntime(path.join(root, 'runtime'), '0.1.0-beta.1')
    const storageRoot = path.join(projectRoot, 'storage')
    let installCalls = 0

    await expect(applyUpdatePackage({
      packagePath: updatePackage,
      projectRoot,
      storageRoot,
      installDependencies: async () => {
        installCalls += 1
        if (installCalls === 1) throw new Error('new dependency install failed')
      },
    })).rejects.toMatchObject({
      code: 'UPDATE_APPLY_FAILED',
      rollbackFailed: false,
    })

    const restoredPackage = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'))
    const result = JSON.parse(await fs.readFile(path.join(storageRoot, UPDATE_RESULT_NAME), 'utf8'))
    expect(restoredPackage.version).toBe('0.1.0-beta.1')
    expect(await fs.readFile(path.join(projectRoot, 'server', 'pre-update-sentinel.txt'), 'utf8')).toBe('runtime-0.1.0-beta.1\n')
    expect(result).toMatchObject({ ok: false, rollbackFailed: false, rollbackError: null })
    expect(installCalls).toBe(2)
    await expect(fs.access(path.join(storageRoot, UPDATE_RUNTIME_INVALID_NAME))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('fails closed on dependency rollback failure and repairs by replaying the previous active package', async () => {
    const root = await scratch('failed-rollback')
    const currentPackage = await createUpdatePackage(root, '0.1.0-beta.1')
    const brokenUpdate = await createUpdatePackage(root, '0.2.0-beta.2')
    const projectRoot = await createRuntime(path.join(root, 'runtime'), '0.1.0-beta.1')
    const storageRoot = path.join(projectRoot, 'storage')

    await applyUpdatePackage({
      packagePath: currentPackage,
      projectRoot,
      storageRoot,
      installDependencies: async () => {},
      allowSameVersion: true,
    })
    await expect(applyUpdatePackage({
      packagePath: brokenUpdate,
      projectRoot,
      storageRoot,
      installDependencies: async () => {
        throw new Error('dependency tree is unavailable')
      },
    })).rejects.toMatchObject({
      code: 'UPDATE_ROLLBACK_FAILED',
      rollbackFailed: true,
    })

    const failedResult = JSON.parse(await fs.readFile(path.join(storageRoot, UPDATE_RESULT_NAME), 'utf8'))
    expect(failedResult.rollbackFailed).toBe(true)
    expect(failedResult.rollbackError).toContain('dependency restore')
    await expect(fs.access(path.join(storageRoot, UPDATE_RUNTIME_INVALID_NAME))).resolves.toBeUndefined()

    const repaired = await replayActiveUpdateIfNeeded({
      projectRoot,
      storageRoot,
      installDependencies: async () => {},
    })
    expect(repaired).toMatchObject({ replayed: true, version: '0.1.0-beta.1' })
    await expect(fs.access(path.join(storageRoot, UPDATE_RUNTIME_INVALID_NAME))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
