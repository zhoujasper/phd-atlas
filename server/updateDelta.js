import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import tar from 'tar-fs'
import {
  compareSemanticVersions,
  extractTarGzip,
  listExtractedFiles,
  manifestDigest,
  normalizedArchivePath,
  sha256File,
  UPDATE_MANIFEST_NAME,
  validateUpdatePackage,
} from './systemUpdate.js'
import { REQUIRED_RUNTIME_FILES } from './sharedConstants.js'

export const UPDATE_DELTA_MANIFEST_NAME = 'update-delta-manifest.json'
export const UPDATE_DELTA_README_NAME = 'UPDATE_DELTA_README.txt'

const DELTA_PAYLOAD_ROOT = 'payload'
const MAX_DELTA_MANIFEST_BYTES = 16 * 1024 * 1024
const MAX_MANIFEST_FILE_COUNT = 20_000
const MAX_MANIFEST_FILE_SIZE = 128 * 1024 * 1024

function deltaError(message, code = 'INVALID_UPDATE_DELTA') {
  return Object.assign(new Error(message), { code })
}

function compareArchivePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function isManagedRuntimePath(value) {
  const name = normalizedArchivePath(value)
  return name === 'package.json'
    || name === 'package-lock.json'
    || name.startsWith('dist/')
    || name.startsWith('server/')
    || name.startsWith('tools/')
}

function normalizedManifestFiles(files, label) {
  if (!Array.isArray(files) || files.length > MAX_MANIFEST_FILE_COUNT) {
    throw deltaError(`${label} contains an invalid file list.`)
  }
  const normalized = files.map((entry) => {
    const relativePath = normalizedArchivePath(entry?.path)
    if (
      entry?.path !== relativePath
      || !isManagedRuntimePath(relativePath)
      || !/^[a-f0-9]{64}$/.test(String(entry?.sha256 ?? ''))
      || !Number.isSafeInteger(entry?.size)
      || entry.size < 0
      || entry.size > MAX_MANIFEST_FILE_SIZE
    ) {
      throw deltaError(`${label} contains an invalid file entry: ${relativePath}`)
    }
    return {
      path: relativePath,
      sha256: entry.sha256,
      size: entry.size,
    }
  }).sort((left, right) => compareArchivePaths(left.path, right.path))
  if (new Set(normalized.map((entry) => entry.path)).size !== normalized.length) {
    throw deltaError(`${label} contains duplicate file entries.`)
  }
  return normalized
}

function normalizedRemovedFiles(files) {
  if (!Array.isArray(files) || files.length > MAX_MANIFEST_FILE_COUNT) {
    throw deltaError('The update delta contains an invalid removed-file list.')
  }
  const normalized = files.map((value) => {
    const relativePath = normalizedArchivePath(value)
    if (value !== relativePath || !isManagedRuntimePath(relativePath)) {
      throw deltaError(`The update delta contains an invalid removed path: ${relativePath}`)
    }
    return relativePath
  }).sort(compareArchivePaths)
  if (new Set(normalized).size !== normalized.length) {
    throw deltaError('The update delta contains duplicate removed paths.')
  }
  return normalized
}

function validateTargetManifest(value, toVersion) {
  if (
    value?.formatVersion !== 1
    || value?.appId !== 'phd-atlas'
    || value?.version !== toVersion
    || !/^[a-f0-9]{64}$/.test(String(value?.contentSha256 ?? ''))
  ) {
    throw deltaError('The update delta target manifest is invalid.')
  }
  const files = normalizedManifestFiles(value.files, 'The update delta target manifest')
  for (const required of REQUIRED_RUNTIME_FILES) {
    if (!files.some((entry) => entry.path === required)) {
      throw deltaError(`The update delta target manifest is missing ${required}.`)
    }
  }
  if (manifestDigest(files) !== value.contentSha256) {
    throw deltaError(
      'The update delta target fingerprint is invalid.',
      'UPDATE_DELTA_INTEGRITY_FAILED',
    )
  }
  return { ...value, files }
}

function calculateManifestDifference(baseFiles, targetFiles) {
  const baseByPath = new Map(baseFiles.map((entry) => [entry.path, entry]))
  const targetByPath = new Map(targetFiles.map((entry) => [entry.path, entry]))
  const changedFiles = targetFiles.filter((target) => {
    const base = baseByPath.get(target.path)
    return !base || base.sha256 !== target.sha256 || base.size !== target.size
  })
  const removedFiles = baseFiles
    .filter((base) => !targetByPath.has(base.path))
    .map((base) => base.path)
  return { changedFiles, removedFiles }
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

async function readDeltaManifest(deltaRoot) {
  const manifestPath = path.join(deltaRoot, UPDATE_DELTA_MANIFEST_NAME)
  const stat = await fs.stat(manifestPath)
  if (!stat.isFile() || stat.size < 1 || stat.size > MAX_DELTA_MANIFEST_BYTES) {
    throw deltaError('The update delta manifest exceeds the supported size.')
  }
  try {
    return JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  } catch (error) {
    if (error?.code === 'INVALID_UPDATE_DELTA') throw error
    throw deltaError('The update delta manifest is not valid JSON.')
  }
}

async function validateDeltaAgainstBase(deltaRoot, baseManifest) {
  const value = await readDeltaManifest(deltaRoot)
  if (
    value?.formatVersion !== 1
    || value?.appId !== 'phd-atlas'
    || value?.fromVersion !== baseManifest.version
    || value?.baseContentSha256 !== baseManifest.contentSha256
    || typeof value?.toVersion !== 'string'
  ) {
    throw deltaError('The update delta does not match the installed base package.')
  }
  try {
    if (compareSemanticVersions(value.toVersion, value.fromVersion) <= 0) {
      throw deltaError('The update delta target must be newer than its base package.')
    }
  } catch (error) {
    if (error?.code === 'INVALID_UPDATE_DELTA') throw error
    throw deltaError('The update delta contains an invalid semantic version.')
  }

  const baseFiles = normalizedManifestFiles(baseManifest.files, 'The installed base manifest')
  const targetManifest = validateTargetManifest(value.targetManifest, value.toVersion)
  const changedFiles = normalizedManifestFiles(value.changedFiles, 'The update delta')
  const removedFiles = normalizedRemovedFiles(value.removedFiles)
  const expected = calculateManifestDifference(baseFiles, targetManifest.files)
  if (
    !sameJson(changedFiles, expected.changedFiles)
    || !sameJson(removedFiles, expected.removedFiles)
  ) {
    throw deltaError(
      'The update delta file set does not match its base and target manifests.',
      'UPDATE_DELTA_INTEGRITY_FAILED',
    )
  }

  const expectedArchiveFiles = new Set([
    UPDATE_DELTA_MANIFEST_NAME,
    UPDATE_DELTA_README_NAME,
    ...changedFiles.map((entry) => `${DELTA_PAYLOAD_ROOT}/${entry.path}`),
  ])
  const archiveFiles = await listExtractedFiles(deltaRoot)
  if (
    archiveFiles.length !== expectedArchiveFiles.size
    || archiveFiles.some((relativePath) => !expectedArchiveFiles.has(relativePath))
  ) {
    throw deltaError('The update delta contains an unexpected or missing payload file.')
  }
  for (const entry of changedFiles) {
    const payloadPath = path.join(deltaRoot, DELTA_PAYLOAD_ROOT, ...entry.path.split('/'))
    const stat = await fs.stat(payloadPath)
    if (
      !stat.isFile()
      || stat.size !== entry.size
      || await sha256File(payloadPath) !== entry.sha256
    ) {
      throw deltaError(
        `The update delta payload failed its integrity check: ${entry.path}`,
        'UPDATE_DELTA_INTEGRITY_FAILED',
      )
    }
  }
  return {
    manifest: {
      ...value,
      changedFiles,
      removedFiles,
      targetManifest,
    },
    changedFiles,
    removedFiles,
    targetManifest,
  }
}

function deterministicDate(manifest) {
  const parsed = Date.parse(String(manifest?.createdAt ?? ''))
  return new Date(Number.isFinite(parsed) && parsed >= 0 ? parsed : 0)
}

async function packDirectory(sourceRoot, outputPath, manifest) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.rm(outputPath, { force: true })
  const mtime = deterministicDate(manifest)
  await pipeline(
    tar.pack(sourceRoot, {
      sort: true,
      map(header) {
        return {
          ...header,
          uid: 0,
          gid: 0,
          mode: header.type === 'directory' ? 0o755 : 0o644,
          mtime,
        }
      },
    }),
    createGzip({ level: 9 }),
    createWriteStream(outputPath, { flags: 'wx', mode: 0o600 }),
  )
}

async function writeReconstructedPackageRoot({
  baseExtractRoot,
  deltaRoot,
  targetRoot,
  changedFiles,
  targetManifest,
  fromVersion,
}) {
  const changedPaths = new Set(changedFiles.map((entry) => entry.path))
  await fs.mkdir(targetRoot, { recursive: true })
  for (const entry of targetManifest.files) {
    const sourcePath = changedPaths.has(entry.path)
      ? path.join(deltaRoot, DELTA_PAYLOAD_ROOT, ...entry.path.split('/'))
      : path.join(baseExtractRoot, ...entry.path.split('/'))
    const destinationPath = path.join(targetRoot, ...entry.path.split('/'))
    await fs.mkdir(path.dirname(destinationPath), { recursive: true })
    await fs.copyFile(sourcePath, destinationPath)
  }
  await fs.writeFile(
    path.join(targetRoot, UPDATE_MANIFEST_NAME),
    `${JSON.stringify(targetManifest, null, 2)}\n`,
    'utf8',
  )
  await fs.writeFile(
    path.join(targetRoot, 'UPDATE_PACKAGE_README.txt'),
    [
      'PhD Atlas update package',
      `version=${targetManifest.version}`,
      `createdAt=${targetManifest.createdAt ?? ''}`,
      `materializedFromDelta=${fromVersion}`,
      '',
      'This complete local package was reconstructed from an integrity-checked base package',
      'and a signed Release delta. It remains the durable replay and rollback source.',
    ].join('\n'),
    'utf8',
  )
}

export async function createUpdateDeltaPackage({
  basePackagePath,
  targetPackagePath,
  outputPath,
  workRoot,
}) {
  const operationRoot = path.join(workRoot, `build-delta-${randomUUID()}`)
  let baseValidation
  let targetValidation
  try {
    baseValidation = await validateUpdatePackage(basePackagePath, path.join(operationRoot, 'base-validation'))
    targetValidation = await validateUpdatePackage(targetPackagePath, path.join(operationRoot, 'target-validation'))
    if (compareSemanticVersions(targetValidation.manifest.version, baseValidation.manifest.version) <= 0) {
      throw deltaError('The target update package must be newer than the base package.')
    }
    const baseFiles = normalizedManifestFiles(baseValidation.manifest.files, 'The base update manifest')
    const targetFiles = normalizedManifestFiles(targetValidation.manifest.files, 'The target update manifest')
    const { changedFiles, removedFiles } = calculateManifestDifference(baseFiles, targetFiles)
    const stageRoot = path.join(operationRoot, 'delta-stage')
    await fs.mkdir(stageRoot, { recursive: true })
    for (const entry of changedFiles) {
      const sourcePath = path.join(targetValidation.extractRoot, ...entry.path.split('/'))
      const destinationPath = path.join(stageRoot, DELTA_PAYLOAD_ROOT, ...entry.path.split('/'))
      await fs.mkdir(path.dirname(destinationPath), { recursive: true })
      await fs.copyFile(sourcePath, destinationPath)
    }
    const deltaManifest = {
      formatVersion: 1,
      appId: 'phd-atlas',
      fromVersion: baseValidation.manifest.version,
      toVersion: targetValidation.manifest.version,
      createdAt: targetValidation.manifest.createdAt ?? '',
      baseContentSha256: baseValidation.manifest.contentSha256,
      targetManifest: {
        ...targetValidation.manifest,
        files: targetFiles,
      },
      changedFiles,
      removedFiles,
    }
    await fs.writeFile(
      path.join(stageRoot, UPDATE_DELTA_MANIFEST_NAME),
      `${JSON.stringify(deltaManifest, null, 2)}\n`,
      'utf8',
    )
    await fs.writeFile(
      path.join(stageRoot, UPDATE_DELTA_README_NAME),
      [
        'PhD Atlas differential update package',
        `fromVersion=${deltaManifest.fromVersion}`,
        `toVersion=${deltaManifest.toVersion}`,
        `changedFiles=${changedFiles.length}`,
        `removedFiles=${removedFiles.length}`,
        '',
        'The updater accepts this package only when the persisted base package fingerprint matches.',
        'Any unavailable or invalid delta falls back to the complete Release update package.',
      ].join('\n'),
      'utf8',
    )
    await packDirectory(stageRoot, outputPath, targetValidation.manifest)

    const inspectionRoot = path.join(operationRoot, 'delta-inspection')
    await extractTarGzip(outputPath, inspectionRoot)
    await validateDeltaAgainstBase(inspectionRoot, baseValidation.manifest)
    const [deltaStat, targetStat] = await Promise.all([
      fs.stat(outputPath),
      fs.stat(targetPackagePath),
    ])
    return {
      outputPath,
      fromVersion: deltaManifest.fromVersion,
      toVersion: deltaManifest.toVersion,
      baseContentSha256: deltaManifest.baseContentSha256,
      targetContentSha256: deltaManifest.targetManifest.contentSha256,
      changedFileCount: changedFiles.length,
      removedFileCount: removedFiles.length,
      size: deltaStat.size,
      fullSize: targetStat.size,
    }
  } catch (error) {
    await fs.rm(outputPath, { force: true }).catch(() => undefined)
    throw error
  } finally {
    await fs.rm(operationRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function materializeUpdateDelta({
  deltaPackagePath,
  basePackagePath,
  outputPackagePath,
  workRoot,
  expectedFromVersion = '',
  expectedToVersion = '',
}) {
  const operationRoot = path.join(workRoot, `materialize-delta-${randomUUID()}`)
  let baseValidation
  try {
    baseValidation = await validateUpdatePackage(basePackagePath, path.join(operationRoot, 'base-validation'))
    const deltaRoot = path.join(operationRoot, 'delta')
    await extractTarGzip(deltaPackagePath, deltaRoot)
    const delta = await validateDeltaAgainstBase(deltaRoot, baseValidation.manifest)
    if (
      (expectedFromVersion && delta.manifest.fromVersion !== expectedFromVersion)
      || (expectedToVersion && delta.manifest.toVersion !== expectedToVersion)
    ) {
      throw deltaError('The downloaded update delta does not match the requested Release transition.')
    }
    const targetRoot = path.join(operationRoot, 'target')
    await writeReconstructedPackageRoot({
      baseExtractRoot: baseValidation.extractRoot,
      deltaRoot,
      targetRoot,
      changedFiles: delta.changedFiles,
      targetManifest: delta.targetManifest,
      fromVersion: delta.manifest.fromVersion,
    })
    await packDirectory(targetRoot, outputPackagePath, delta.targetManifest)
    const validation = await validateUpdatePackage(
      outputPackagePath,
      path.join(operationRoot, 'reconstructed-validation'),
    )
    try {
      if (
        validation.manifest.version !== delta.targetManifest.version
        || validation.manifest.contentSha256 !== delta.targetManifest.contentSha256
      ) {
        throw deltaError(
          'The reconstructed update package does not match the delta target.',
          'UPDATE_DELTA_INTEGRITY_FAILED',
        )
      }
    } finally {
      await fs.rm(validation.extractRoot, { recursive: true, force: true }).catch(() => undefined)
    }
    const stat = await fs.stat(outputPackagePath)
    return {
      packagePath: outputPackagePath,
      size: stat.size,
      manifest: delta.targetManifest,
      fromVersion: delta.manifest.fromVersion,
      toVersion: delta.manifest.toVersion,
      changedFileCount: delta.changedFiles.length,
      removedFileCount: delta.removedFiles.length,
    }
  } catch (error) {
    await fs.rm(outputPackagePath, { force: true }).catch(() => undefined)
    throw error
  } finally {
    await fs.rm(operationRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}
