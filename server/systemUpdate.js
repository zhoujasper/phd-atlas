import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { createGunzip } from 'node:zlib'
import { pathToFileURL } from 'node:url'
import tar from 'tar-fs'

export const UPDATE_MANIFEST_NAME = 'update-manifest.json'
export const UPDATE_LOCK_NAME = '.update-in-progress.json'
export const UPDATE_RESULT_NAME = 'last-update-result.json'
export const UPDATE_RUNTIME_INVALID_NAME = '.update-runtime-invalid.json'
export const UPDATE_BOOT_PENDING_NAME = '.update-boot-pending.json'
export const ACTIVE_UPDATE_DIRECTORY_NAME = 'active-update'
export const ACTIVE_UPDATE_POINTER_NAME = 'active.json'

const REQUIRED_RUNTIME_FILES = new Set([
  'dist/index.html',
  'server/index.js',
  'tools/start-server.mjs',
  'tools/apply-update.mjs',
  'tools/container-entrypoint.mjs',
  'package.json',
  'package-lock.json',
])
const ALLOWED_UNMANIFESTED_FILES = new Set([
  UPDATE_MANIFEST_NAME,
  'UPDATE_PACKAGE_README.txt',
])
const ROLLBACK_REQUIRED_RUNTIME_FILES = new Set([
  'dist/index.html',
  'server/index.js',
  'tools/start-server.mjs',
  'tools/apply-update.mjs',
  'tools/container-entrypoint.mjs',
  'package.json',
  'package-lock.json',
])
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/
const MAX_UPDATE_ENTRY_COUNT = 20_000
const MAX_UPDATE_FILE_SIZE = 128 * 1024 * 1024
const MAX_UPDATE_EXTRACTED_SIZE = 256 * 1024 * 1024
const MAX_UPDATE_PATH_LENGTH = 1_024
const MAX_UPDATE_PATH_DEPTH = 32
const MAX_UPDATE_TAR_STREAM_SIZE = 320 * 1024 * 1024
const RUNTIME_PREFLIGHT_TIMEOUT_MS = 60_000
const PREVIOUS_ACTIVE_BACKUP_NAME = '.previous-active-update.tar.gz'

function normalizedArchivePath(value) {
  const normalized = path.posix.normalize(String(value ?? '').replaceAll('\\', '/').replace(/^\.\/+/, ''))
  if (!normalized || normalized === '.' || normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) {
    throw Object.assign(new Error('Update package contains an unsafe path.'), { code: 'INVALID_UPDATE_PACKAGE' })
  }
  return normalized
}

function parseSemanticVersion(value) {
  const source = String(value ?? '')
  const match = SEMVER_PATTERN.exec(source)
  if (!match) {
    throw Object.assign(new Error(`Invalid semantic version: ${source || '(empty)'}`), { code: 'INVALID_UPDATE_PACKAGE' })
  }
  return {
    source,
    core: [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])],
    prerelease: match[4] ? match[4].split('.') : [],
  }
}

export function compareSemanticVersions(left, right) {
  const leftVersion = parseSemanticVersion(left)
  const rightVersion = parseSemanticVersion(right)
  for (let index = 0; index < leftVersion.core.length; index += 1) {
    if (leftVersion.core[index] > rightVersion.core[index]) return 1
    if (leftVersion.core[index] < rightVersion.core[index]) return -1
  }
  if (!leftVersion.prerelease.length && !rightVersion.prerelease.length) return 0
  if (!leftVersion.prerelease.length) return 1
  if (!rightVersion.prerelease.length) return -1
  const length = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = leftVersion.prerelease[index]
    const rightIdentifier = rightVersion.prerelease[index]
    if (leftIdentifier === undefined) return -1
    if (rightIdentifier === undefined) return 1
    if (leftIdentifier === rightIdentifier) continue
    const leftNumeric = /^\d+$/.test(leftIdentifier)
    const rightNumeric = /^\d+$/.test(rightIdentifier)
    if (leftNumeric && rightNumeric) {
      return BigInt(leftIdentifier) > BigInt(rightIdentifier) ? 1 : -1
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return leftIdentifier > rightIdentifier ? 1 : -1
  }
  return 0
}

function isManagedRuntimePath(value) {
  const name = normalizedArchivePath(value)
  return name === 'package.json'
    || name === 'package-lock.json'
    || name.startsWith('dist/')
    || name.startsWith('server/')
    || name.startsWith('tools/')
}

async function sha256File(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

async function writeJsonAtomically(filePath, value) {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await fs.rename(temporaryPath, filePath)
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

async function listExtractedFiles(root, current = root) {
  const files = []
  for (const entry of await fs.readdir(current, { withFileTypes: true })) {
    const fullPath = path.join(current, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listExtractedFiles(root, fullPath))
      continue
    }
    if (!entry.isFile()) {
      throw Object.assign(new Error(`Update package contains an unsupported entry: ${entry.name}`), { code: 'INVALID_UPDATE_PACKAGE' })
    }
    files.push(path.relative(root, fullPath).split(path.sep).join('/'))
  }
  return files
}

async function extractTarGzip(packagePath, destination) {
  await fs.mkdir(destination, { recursive: true })
  let entryCount = 0
  let extractedSize = 0
  const seenPaths = new Set()
  const filePaths = new Set()
  const ancestorPaths = new Set()
  let tarStreamSize = 0
  let rootEntrySeen = false
  await pipeline(
    createReadStream(packagePath),
    createGunzip(),
    new Transform({
      transform(chunk, _encoding, callback) {
        tarStreamSize += chunk.length
        if (tarStreamSize > MAX_UPDATE_TAR_STREAM_SIZE) {
          callback(Object.assign(new Error('Update package decompressed tar stream exceeds the safety limit.'), {
            code: 'INVALID_UPDATE_PACKAGE',
          }))
          return
        }
        callback(null, chunk)
      },
    }),
    tar.extract(destination, {
      ignore(_name, header) {
        if (header.name === '.' || header.name === './') {
          entryCount += 1
          if (
            rootEntrySeen
            || entryCount > MAX_UPDATE_ENTRY_COUNT
            || header.type !== 'directory'
            || Number(header.size ?? 0) !== 0
          ) {
            throw Object.assign(new Error('Update package contains an invalid root archive entry.'), {
              code: 'INVALID_UPDATE_PACKAGE',
            })
          }
          rootEntrySeen = true
          return true
        }
        const relativePath = normalizedArchivePath(header.name)
        const segments = relativePath.split('/')
        entryCount += 1
        if (
          entryCount > MAX_UPDATE_ENTRY_COUNT
          || relativePath.length > MAX_UPDATE_PATH_LENGTH
          || segments.length > MAX_UPDATE_PATH_DEPTH
        ) {
          throw Object.assign(new Error('Update package archive structure exceeds the safety limits.'), {
            code: 'INVALID_UPDATE_PACKAGE',
          })
        }
        if (header.type !== 'file' && header.type !== 'directory') {
          throw Object.assign(new Error('Update packages can contain only regular files and directories.'), {
            code: 'INVALID_UPDATE_PACKAGE',
          })
        }
        if (seenPaths.has(relativePath)) {
          throw Object.assign(new Error(`Update package contains a duplicate archive entry: ${relativePath}`), {
            code: 'INVALID_UPDATE_PACKAGE',
          })
        }
        const prefixes = []
        for (let index = 1; index < segments.length; index += 1) {
          prefixes.push(segments.slice(0, index).join('/'))
        }
        if (prefixes.some((prefix) => filePaths.has(prefix))) {
          throw Object.assign(new Error(`Update package contains a file/directory path conflict: ${relativePath}`), {
            code: 'INVALID_UPDATE_PACKAGE',
          })
        }
        if (header.type === 'file') {
          const size = Number(header.size)
          if (
            !Number.isSafeInteger(size)
            || size < 0
            || size > MAX_UPDATE_FILE_SIZE
            || extractedSize + size > MAX_UPDATE_EXTRACTED_SIZE
            || ancestorPaths.has(relativePath)
          ) {
            throw Object.assign(new Error('Update package extracted content exceeds the safety limits.'), {
              code: 'INVALID_UPDATE_PACKAGE',
            })
          }
          extractedSize += size
          filePaths.add(relativePath)
        }
        seenPaths.add(relativePath)
        for (const prefix of prefixes) ancestorPaths.add(prefix)
        return false
      },
    }),
  )
}

function compareArchivePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function manifestDigest(files) {
  const hash = createHash('sha256')
  for (const file of [...files].sort((left, right) => compareArchivePaths(left.path, right.path))) {
    hash.update(`${file.path}\0${file.sha256}\0${file.size}\n`)
  }
  return hash.digest('hex')
}

export async function validateUpdatePackage(packagePath, workRoot) {
  const extractRoot = path.join(workRoot, `validated-${randomUUID()}`)
  try {
    await extractTarGzip(packagePath, extractRoot)
    const manifestPath = path.join(extractRoot, UPDATE_MANIFEST_NAME)
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    if (manifest.formatVersion !== 1 || manifest.appId !== 'phd-atlas' || !Array.isArray(manifest.files)) {
      throw Object.assign(new Error('This is not a supported PhD Atlas update package.'), { code: 'INVALID_UPDATE_PACKAGE' })
    }
    if (!SEMVER_PATTERN.test(String(manifest.version ?? ''))) {
      throw Object.assign(new Error('The update package version is invalid.'), { code: 'INVALID_UPDATE_PACKAGE' })
    }

    const seen = new Set()
    for (const entry of manifest.files) {
      const relativePath = normalizedArchivePath(entry.path)
      if (
        entry.path !== relativePath
        || !isManagedRuntimePath(relativePath)
        || seen.has(relativePath)
        || !/^[a-f0-9]{64}$/.test(String(entry.sha256 ?? ''))
        || !Number.isSafeInteger(entry.size)
        || entry.size < 0
      ) {
        throw Object.assign(new Error(`Update package contains an unmanaged or duplicate file: ${relativePath}`), { code: 'INVALID_UPDATE_PACKAGE' })
      }
      seen.add(relativePath)
      const filePath = path.join(extractRoot, ...relativePath.split('/'))
      const stat = await fs.stat(filePath)
      if (!stat.isFile() || stat.size !== entry.size || await sha256File(filePath) !== entry.sha256) {
        throw Object.assign(new Error(`Update package integrity check failed: ${relativePath}`), { code: 'UPDATE_INTEGRITY_FAILED' })
      }
    }
    for (const required of REQUIRED_RUNTIME_FILES) {
      if (!seen.has(required)) {
        throw Object.assign(new Error(`Update package is missing ${required}.`), { code: 'INVALID_UPDATE_PACKAGE' })
      }
    }
    for (const relativePath of await listExtractedFiles(extractRoot)) {
      if (!seen.has(relativePath) && !ALLOWED_UNMANIFESTED_FILES.has(relativePath)) {
        throw Object.assign(new Error(`Update package contains an unmanifested file: ${relativePath}`), { code: 'INVALID_UPDATE_PACKAGE' })
      }
    }
    if (manifestDigest(manifest.files) !== manifest.contentSha256) {
      throw Object.assign(new Error('Update package content fingerprint does not match its manifest.'), { code: 'UPDATE_INTEGRITY_FAILED' })
    }
    const payloadPackage = JSON.parse(await fs.readFile(path.join(extractRoot, 'package.json'), 'utf8'))
    const payloadLock = JSON.parse(await fs.readFile(path.join(extractRoot, 'package-lock.json'), 'utf8'))
    if (
      payloadPackage?.version !== manifest.version
      || payloadLock?.version !== manifest.version
      || payloadLock?.packages?.['']?.version !== manifest.version
    ) {
      throw Object.assign(new Error('The update manifest, package.json, and package-lock.json versions do not match.'), {
        code: 'UPDATE_INTEGRITY_FAILED',
      })
    }
    return { manifest, extractRoot }
  } catch (error) {
    await fs.rm(extractRoot, { recursive: true, force: true })
    throw error
  }
}

async function copyPathIfPresent(source, destination) {
  try {
    await fs.cp(source, destination, { recursive: true, force: true })
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

async function replaceRuntimeTree(extractRoot, projectRoot) {
  for (const root of ['dist', 'server', 'tools']) {
    await fs.rm(path.join(projectRoot, root), { recursive: true, force: true })
    await fs.cp(path.join(extractRoot, root), path.join(projectRoot, root), { recursive: true, force: true })
  }
  for (const file of ['package.json', 'package-lock.json']) {
    await fs.copyFile(path.join(extractRoot, file), path.join(projectRoot, file))
  }
}

function activeUpdateRoot(storageRoot) {
  return path.join(storageRoot, ACTIVE_UPDATE_DIRECTORY_NAME)
}

function activeUpdatePointerPath(storageRoot) {
  return path.join(activeUpdateRoot(storageRoot), ACTIVE_UPDATE_POINTER_NAME)
}

function runtimeInvalidPath(storageRoot) {
  return path.join(storageRoot, UPDATE_RUNTIME_INVALID_NAME)
}

function pendingBootPath(storageRoot) {
  return path.join(storageRoot, UPDATE_BOOT_PENDING_NAME)
}

function updateLockPath(storageRoot) {
  return path.join(storageRoot, UPDATE_LOCK_NAME)
}

function normalizedManifestFiles(files) {
  return [...files]
    .map((file) => ({
      path: normalizedArchivePath(file.path),
      sha256: String(file.sha256),
      size: Number(file.size),
    }))
    .sort((left, right) => compareArchivePaths(left.path, right.path))
}

function activePointerMetadata(activeUpdate) {
  if (!activeUpdate) return null
  const {
    packagePath: _packagePath,
    ...metadata
  } = activeUpdate
  return metadata
}

async function persistActiveUpdatePackage({ packagePath, storageRoot, manifest }) {
  const packageSha256 = await sha256File(packagePath)
  const packageStat = await fs.stat(packagePath)
  const root = activeUpdateRoot(storageRoot)
  const packageDirectory = path.join(root, 'packages')
  const packageName = `${packageSha256}.tar.gz`
  const activePackagePath = path.join(packageDirectory, packageName)
  await fs.mkdir(packageDirectory, { recursive: true })

  if (path.resolve(packagePath) !== path.resolve(activePackagePath)) {
    const temporaryPackagePath = path.join(packageDirectory, `.${packageName}.tmp-${process.pid}-${randomUUID()}`)
    try {
      await fs.copyFile(packagePath, temporaryPackagePath)
      if (await sha256File(temporaryPackagePath) !== packageSha256) {
        throw Object.assign(new Error('The active update package copy failed its integrity check.'), { code: 'UPDATE_INTEGRITY_FAILED' })
      }
      await fs.rename(temporaryPackagePath, activePackagePath)
    } finally {
      await fs.rm(temporaryPackagePath, { force: true }).catch(() => undefined)
    }
  }

  const metadata = {
    formatVersion: 1,
    appId: 'phd-atlas',
    version: manifest.version,
    contentSha256: manifest.contentSha256,
    packageSha256,
    packageSize: packageStat.size,
    packageFile: `packages/${packageName}`,
    files: normalizedManifestFiles(manifest.files),
    activatedAt: new Date().toISOString(),
  }
  await writeJsonAtomically(activeUpdatePointerPath(storageRoot), metadata)
  return { ...metadata, packagePath: activePackagePath }
}

function previousActiveBackupPath(rollbackRoot) {
  return path.join(rollbackRoot, PREVIOUS_ACTIVE_BACKUP_NAME)
}

async function backupPreviousActivePackage(storageRoot, rollbackRoot, previousActive) {
  if (!previousActive) return null
  const resolved = await validateActiveUpdateMetadata(storageRoot, previousActive)
  const backupPath = previousActiveBackupPath(rollbackRoot)
  const temporaryPath = `${backupPath}.tmp-${process.pid}-${randomUUID()}`
  try {
    await fs.copyFile(resolved.packagePath, temporaryPath)
    const stat = await fs.stat(temporaryPath)
    if (
      !stat.isFile()
      || stat.size !== resolved.packageSize
      || await sha256File(temporaryPath) !== resolved.packageSha256
    ) {
      throw Object.assign(new Error('The previous active update backup failed its integrity check.'), {
        code: 'UPDATE_INTEGRITY_FAILED',
      })
    }
    await fs.rename(temporaryPath, backupPath)
    return backupPath
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

async function restorePreviousActivePackageBackup(storageRoot, rollbackRoot, previousActive) {
  const backupPath = previousActiveBackupPath(rollbackRoot)
  const stat = await fs.stat(backupPath)
  if (
    !stat.isFile()
    || stat.size !== previousActive.packageSize
    || await sha256File(backupPath) !== previousActive.packageSha256
  ) {
    throw Object.assign(new Error('The previous active update backup failed its integrity check.'), {
      code: 'UPDATE_INTEGRITY_FAILED',
    })
  }

  const backupValidation = await validateStoredActiveUpdatePackage(storageRoot, {
    ...previousActive,
    packagePath: backupPath,
  })
  await fs.rm(backupValidation.extractRoot, { recursive: true, force: true })

  await fs.mkdir(path.dirname(previousActive.packagePath), { recursive: true })
  const temporaryPath = `${previousActive.packagePath}.restore-${process.pid}-${randomUUID()}`
  try {
    await fs.copyFile(backupPath, temporaryPath)
    if (await sha256File(temporaryPath) !== previousActive.packageSha256) {
      throw Object.assign(new Error('The previous active update restore failed its integrity check.'), {
        code: 'UPDATE_INTEGRITY_FAILED',
      })
    }
    await fs.rm(previousActive.packagePath, { force: true })
    await fs.rename(temporaryPath, previousActive.packagePath)
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
  }
  return validateActiveUpdateMetadata(storageRoot, previousActive)
}

async function deactivateStaleActiveUpdate(storageRoot, activeUpdate, baseVersion) {
  const root = activeUpdateRoot(storageRoot)
  const historyRoot = path.join(root, 'history')
  const ignoredAt = new Date().toISOString()
  const safeVersion = activeUpdate.version.replace(/[^0-9A-Za-z.-]/g, '_')
  const archivedPointer = path.join(historyRoot, `ignored-${Date.now()}-${safeVersion}-${randomUUID().slice(0, 8)}.json`)
  await fs.mkdir(historyRoot, { recursive: true })
  await writeJsonAtomically(path.join(root, 'last-ignored.json'), {
    formatVersion: 1,
    appId: 'phd-atlas',
    activeVersion: activeUpdate.version,
    baseVersion,
    packageSha256: activeUpdate.packageSha256,
    packageFile: activeUpdate.packageFile,
    ignoredAt,
    reason: 'The container image version is equal to or newer than the persisted active update.',
  })
  try {
    await fs.rename(activeUpdatePointerPath(storageRoot), archivedPointer)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  await fs.rm(activeUpdate.packagePath, { force: true }).catch((error) => {
    console.error('[system-update] Failed to remove a stale active update package:', error)
  })
  return { ignoredAt, archivedPointer }
}

async function validateActiveUpdateMetadata(storageRoot, metadata, options = {}) {
  const packageSha256 = String(metadata?.packageSha256 ?? '')
  const packageFile = String(metadata?.packageFile ?? '')
  const expectedPackageFile = `packages/${packageSha256}.tar.gz`
  if (
    metadata?.formatVersion !== 1
    || metadata?.appId !== 'phd-atlas'
    || !SEMVER_PATTERN.test(String(metadata?.version ?? ''))
    || !/^[a-f0-9]{64}$/.test(packageSha256)
    || packageFile !== expectedPackageFile
    || !Array.isArray(metadata?.files)
    || !Number.isSafeInteger(metadata?.packageSize)
    || metadata.packageSize < 0
    || !/^[a-f0-9]{64}$/.test(String(metadata?.contentSha256 ?? ''))
  ) {
    throw Object.assign(new Error('The active update pointer is invalid.'), { code: 'ACTIVE_UPDATE_INVALID' })
  }

  const files = normalizedManifestFiles(metadata.files)
  if (files.some((file) => (
    !isManagedRuntimePath(file.path)
    || !/^[a-f0-9]{64}$/.test(file.sha256)
    || !Number.isSafeInteger(file.size)
    || file.size < 0
  )) || new Set(files.map((file) => file.path)).size !== files.length) {
    throw Object.assign(new Error('The active update file metadata is invalid.'), { code: 'ACTIVE_UPDATE_INVALID' })
  }
  if (manifestDigest(files) !== metadata.contentSha256) {
    throw Object.assign(new Error('The active update file metadata fingerprint is invalid.'), { code: 'ACTIVE_UPDATE_INVALID' })
  }
  const packagePath = path.join(activeUpdateRoot(storageRoot), ...packageFile.split('/'))
  if (options.verifyPackage === false) {
    return { ...metadata, files, packagePath }
  }
  let stat
  try {
    stat = await fs.stat(packagePath)
  } catch (error) {
    throw Object.assign(new Error('The active update package is missing.'), {
      code: 'ACTIVE_UPDATE_MISSING',
      cause: error,
    })
  }
  if (!stat.isFile() || stat.size !== Number(metadata.packageSize) || await sha256File(packagePath) !== packageSha256) {
    throw Object.assign(new Error('The active update package failed its integrity check.'), { code: 'UPDATE_INTEGRITY_FAILED' })
  }
  return { ...metadata, files, packagePath }
}

export async function readActiveUpdatePackage(storageRoot, options = {}) {
  let metadata
  try {
    metadata = JSON.parse(await fs.readFile(activeUpdatePointerPath(storageRoot), 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw Object.assign(new Error(`The active update pointer is unreadable: ${error?.message ?? error}`), {
      code: 'ACTIVE_UPDATE_INVALID',
      cause: error,
    })
  }
  return validateActiveUpdateMetadata(storageRoot, metadata, options)
}

export async function readRuntimeInvalidMarker(storageRoot) {
  try {
    return JSON.parse(await fs.readFile(runtimeInvalidPath(storageRoot), 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw Object.assign(new Error(`The runtime-invalid marker is unreadable: ${error?.message ?? error}`), {
      code: 'UPDATE_RUNTIME_INVALID',
      cause: error,
    })
  }
}

function isPathInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

async function runtimeMatchesManifestFiles(projectRoot, files) {
  try {
    const actualPaths = []
    for (const root of ['dist', 'server', 'tools']) {
      actualPaths.push(...(await listExtractedFiles(path.join(projectRoot, root)))
        .map((relativePath) => `${root}/${relativePath}`))
    }
    actualPaths.push('package.json', 'package-lock.json')
    const expectedPaths = files.map((file) => file.path)
    actualPaths.sort(compareArchivePaths)
    expectedPaths.sort(compareArchivePaths)
    if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) return false
    for (const file of files) {
      const filePath = path.join(projectRoot, ...file.path.split('/'))
      const stat = await fs.stat(filePath)
      if (!stat.isFile() || stat.size !== file.size || await sha256File(filePath) !== file.sha256) {
        return false
      }
    }
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function validateStoredActiveUpdatePackage(storageRoot, activeUpdate) {
  const validationRoot = path.join(storageRoot, 'active-update-validation')
  const validated = await validateUpdatePackage(activeUpdate.packagePath, validationRoot)
  const expectedFiles = JSON.stringify(activeUpdate.files)
  const actualFiles = JSON.stringify(normalizedManifestFiles(validated.manifest.files))
  if (
    validated.manifest.version !== activeUpdate.version
    || validated.manifest.contentSha256 !== activeUpdate.contentSha256
    || actualFiles !== expectedFiles
  ) {
    await fs.rm(validated.extractRoot, { recursive: true, force: true })
    throw Object.assign(new Error('The active update pointer does not match its package manifest.'), {
      code: 'ACTIVE_UPDATE_INVALID',
    })
  }
  return validated
}

async function replaceRuntimeFromActiveUpdate({
  projectRoot,
  storageRoot,
  activeUpdate,
}) {
  const validated = await validateStoredActiveUpdatePackage(storageRoot, activeUpdate)
  try {
    await replaceRuntimeTree(validated.extractRoot, projectRoot)
  } finally {
    await fs.rm(validated.extractRoot, { recursive: true, force: true })
  }
}

async function restoreRuntimeFromActiveUpdate({
  projectRoot,
  storageRoot,
  activeUpdate,
  installDependencies,
}) {
  await replaceRuntimeFromActiveUpdate({
    projectRoot,
    storageRoot,
    activeUpdate,
  })
  await installDependencies(projectRoot)
}

function validatePendingBootMarker(storageRoot, marker) {
  const rollbackRoot = path.resolve(String(marker?.rollbackRoot ?? ''))
  const expectedRollbackParent = path.join(storageRoot, 'update-rollbacks')
  if (
    marker?.formatVersion !== 1
    || marker?.appId !== 'phd-atlas'
    || !/^[0-9]+-[a-f0-9]{8}$/.test(String(marker?.updateId ?? ''))
    || !SEMVER_PATTERN.test(String(marker?.fromVersion ?? ''))
    || !SEMVER_PATTERN.test(String(marker?.toVersion ?? ''))
    || !isPathInside(expectedRollbackParent, rollbackRoot)
    || (marker.bootPid !== null && (!Number.isSafeInteger(marker.bootPid) || marker.bootPid <= 0))
    || (marker.previousActive !== null && typeof marker.previousActive !== 'object')
  ) {
    throw Object.assign(new Error('The pending update boot marker is invalid.'), {
      code: 'UPDATE_BOOT_MARKER_INVALID',
    })
  }
  return {
    ...marker,
    rollbackRoot,
    bootPid: marker.bootPid ?? null,
    previousActive: marker.previousActive ?? null,
  }
}

export async function readPendingUpdateBoot(storageRoot) {
  try {
    const marker = JSON.parse(await fs.readFile(pendingBootPath(storageRoot), 'utf8'))
    return validatePendingBootMarker(storageRoot, marker)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    if (error?.code === 'UPDATE_BOOT_MARKER_INVALID') throw error
    throw Object.assign(new Error(`The pending update boot marker is unreadable: ${error?.message ?? error}`), {
      code: 'UPDATE_BOOT_MARKER_INVALID',
      cause: error,
    })
  }
}

async function archivePendingBootMarker(storageRoot, marker, disposition) {
  const historyRoot = path.join(activeUpdateRoot(storageRoot), 'history')
  const archivedPath = path.join(
    historyRoot,
    `boot-${disposition}-${Date.now()}-${marker.updateId}-${randomUUID().slice(0, 8)}.json`,
  )
  await fs.mkdir(historyRoot, { recursive: true })
  try {
    await fs.rename(pendingBootPath(storageRoot), archivedPath)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return archivedPath
}

async function cleanupSupersededActivePackage(storageRoot, marker) {
  if (!marker.previousActive) return
  try {
    const previousActive = await validateActiveUpdateMetadata(storageRoot, marker.previousActive)
    const currentActive = await readActiveUpdatePackage(storageRoot, { verifyPackage: false })
    if (currentActive && !sameActivePackage(currentActive, previousActive)) {
      await fs.rm(previousActive.packagePath, { force: true })
    }
  } catch (error) {
    console.error('[system-update] Failed to clean up the superseded active update package:', error)
  }
}

async function cleanupConfirmedRollbackRoot(marker) {
  try {
    await fs.rm(marker.rollbackRoot, { recursive: true, force: true })
  } catch (error) {
    console.error('[system-update] Failed to clean up a confirmed update rollback snapshot:', error)
  }
}

async function supersedePendingBootForUpdate(storageRoot, previousVersion, targetVersion) {
  const marker = await readPendingUpdateBoot(storageRoot)
  if (!marker) return null
  if (marker.toVersion === targetVersion) {
    return {
      marker,
      archivedPath: null,
      replayingPendingTarget: true,
    }
  }
  if (marker.toVersion !== previousVersion) {
    throw Object.assign(new Error(
      `A pending boot for ${marker.toVersion} cannot be superseded by runtime ${previousVersion}.`,
    ), { code: 'UPDATE_BOOT_MARKER_INVALID' })
  }
  const archivedPath = await archivePendingBootMarker(storageRoot, marker, 'superseded')
  await writeJsonAtomically(path.join(activeUpdateRoot(storageRoot), 'last-boot-success.json'), {
    ...marker,
    confirmedAt: new Date().toISOString(),
    disposition: 'superseded-by-next-update',
    archivedPath,
  }).catch((error) => {
    console.error('[system-update] Failed to write superseded boot confirmation:', error)
  })
  await cleanupSupersededActivePackage(storageRoot, marker)
  await cleanupConfirmedRollbackRoot(marker)
  return {
    marker,
    archivedPath,
    replayingPendingTarget: false,
  }
}

async function supersedePendingBootByImage(storageRoot, activeVersion, baseVersion) {
  const marker = await readPendingUpdateBoot(storageRoot)
  if (!marker) return null
  if (marker.toVersion !== activeVersion) {
    throw Object.assign(new Error(
      `Pending boot ${marker.toVersion} does not match stale active update ${activeVersion}.`,
    ), { code: 'UPDATE_BOOT_MARKER_INVALID' })
  }
  const archivedPath = await archivePendingBootMarker(storageRoot, marker, 'superseded-by-image')
  await writeJsonAtomically(path.join(activeUpdateRoot(storageRoot), 'last-boot-success.json'), {
    ...activePointerMetadata(marker),
    confirmedAt: new Date().toISOString(),
    disposition: 'superseded-by-newer-image',
    supersedingImageVersion: baseVersion,
    archivedPath,
  }).catch((error) => {
    console.error('[system-update] Failed to write image supersession record:', error)
  })
  await cleanupSupersededActivePackage(storageRoot, marker)
  await cleanupConfirmedRollbackRoot(marker)
  return { marker, archivedPath }
}

export async function claimPendingUpdateBoot(storageRoot, processId, options = {}) {
  const marker = await readPendingUpdateBoot(storageRoot)
  if (!marker) return null
  if (!Number.isSafeInteger(processId) || processId <= 0) {
    throw new Error('A valid boot process id is required.')
  }
  if (marker.bootPid && marker.bootPid !== processId) {
    const processExists = options.processExists ?? (() => false)
    if (await processExists(marker.bootPid)) {
      throw Object.assign(new Error(`Update boot process ${marker.bootPid} is still running.`), {
        code: 'UPDATE_BOOT_IN_PROGRESS',
      })
    }
    throw Object.assign(new Error(`Update boot process ${marker.bootPid} exited before confirmation.`), {
      code: 'UPDATE_BOOT_ABANDONED',
    })
  }
  if (marker.bootPid === processId) return marker
  const claimed = {
    ...activePointerMetadata(marker),
    bootPid: processId,
    bootClaimedAt: new Date().toISOString(),
  }
  await writeJsonAtomically(pendingBootPath(storageRoot), claimed)
  return validatePendingBootMarker(storageRoot, claimed)
}

export async function releasePendingUpdateBootClaim(storageRoot, processId) {
  const marker = await readPendingUpdateBoot(storageRoot)
  if (!marker || marker.bootPid !== processId) return false
  await writeJsonAtomically(pendingBootPath(storageRoot), {
    ...activePointerMetadata(marker),
    bootPid: null,
    bootReleasedAt: new Date().toISOString(),
  })
  return true
}

export async function confirmPendingUpdateBoot(storageRoot, processId) {
  const marker = await readPendingUpdateBoot(storageRoot)
  if (!marker) return null
  if (marker.bootPid !== processId) {
    throw Object.assign(new Error('Only the process that claimed the pending update boot can confirm it.'), {
      code: 'UPDATE_BOOT_CONFIRMATION_MISMATCH',
    })
  }
  const archivedPath = await archivePendingBootMarker(storageRoot, marker, 'confirmed')
  const result = {
    ...activePointerMetadata(marker),
    confirmedAt: new Date().toISOString(),
    disposition: 'confirmed',
    archivedPath,
  }
  await writeJsonAtomically(path.join(activeUpdateRoot(storageRoot), 'last-boot-success.json'), result)
    .catch((error) => console.error('[system-update] Failed to write boot confirmation:', error))
  await cleanupSupersededActivePackage(storageRoot, marker)
  await cleanupConfirmedRollbackRoot(marker)
  return result
}

async function archiveRuntimeInvalidMarker(storageRoot, baseVersion) {
  const marker = await readRuntimeInvalidMarker(storageRoot)
  if (!marker) return null
  const historyRoot = path.join(activeUpdateRoot(storageRoot), 'history')
  const archivedAt = new Date().toISOString()
  const archivedPath = path.join(historyRoot, `runtime-recovered-${Date.now()}-${randomUUID().slice(0, 8)}.json`)
  await fs.mkdir(historyRoot, { recursive: true })
  await writeJsonAtomically(path.join(activeUpdateRoot(storageRoot), 'last-runtime-recovery.json'), {
    formatVersion: 1,
    appId: 'phd-atlas',
    baseVersion,
    archivedAt,
    previousFailure: marker,
    reason: 'The immutable container-image runtime was verified and production dependencies were repaired.',
  })
  try {
    await fs.rename(runtimeInvalidPath(storageRoot), archivedPath)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return { archivedAt, archivedPath }
}

function defaultProcessExists(processId) {
  if (!Number.isSafeInteger(processId) || processId <= 0) return false
  try {
    process.kill(processId, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

async function validateRollbackRuntime(rollbackRoot, expectedVersion) {
  for (const relativePath of ROLLBACK_REQUIRED_RUNTIME_FILES) {
    const filePath = path.join(rollbackRoot, ...relativePath.split('/'))
    const stat = await fs.lstat(filePath)
    if (!stat.isFile()) {
      throw new Error(`Rollback runtime entry is not a regular file: ${relativePath}`)
    }
  }
  const inspectTree = async (current) => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await inspectTree(fullPath)
      } else if (!entry.isFile()) {
        throw new Error(`Rollback runtime contains an unsupported entry: ${path.relative(rollbackRoot, fullPath)}`)
      }
    }
  }
  for (const directory of ['dist', 'server', 'tools']) {
    await inspectTree(path.join(rollbackRoot, directory))
  }
  const rollbackPackage = JSON.parse(await fs.readFile(path.join(rollbackRoot, 'package.json'), 'utf8'))
  if (rollbackPackage?.version !== expectedVersion) {
    throw new Error(`Rollback runtime version ${rollbackPackage?.version ?? 'unknown'} does not match ${expectedVersion}.`)
  }
}

async function restoreRuntimeSnapshot(snapshotRoot, projectRoot) {
  for (const directory of ['dist', 'server', 'tools']) {
    await fs.rm(path.join(projectRoot, directory), { recursive: true, force: true })
    await fs.cp(path.join(snapshotRoot, directory), path.join(projectRoot, directory), {
      recursive: true,
      force: true,
    })
  }
  for (const file of ['package.json', 'package-lock.json']) {
    await fs.copyFile(path.join(snapshotRoot, file), path.join(projectRoot, file))
  }
}

function runNodePreflight(args, projectRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: projectRoot,
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < 16_384) stderr += chunk.toString()
    })
    let settled = false
    let timer
    const finish = (callback) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback()
    }
    timer = setTimeout(() => finish(() => {
      child.kill()
      reject(Object.assign(new Error(`Runtime preflight timed out: ${args.join(' ')}`), {
        code: 'UPDATE_PREFLIGHT_FAILED',
      }))
    }), RUNTIME_PREFLIGHT_TIMEOUT_MS)
    child.once('error', (error) => finish(() => reject(Object.assign(error, {
      code: 'UPDATE_PREFLIGHT_FAILED',
    }))))
    child.once('exit', (code, signal) => finish(() => {
      if (code === 0) {
        resolve()
        return
      }
      reject(Object.assign(new Error(
        `Runtime preflight failed (${signal ? `signal ${signal}` : `exit ${code}`}): ${stderr.trim() || args.join(' ')}`,
      ), { code: 'UPDATE_PREFLIGHT_FAILED' }))
    }))
  })
}

export async function preflightRuntime(projectRoot) {
  const codeFiles = []
  const collect = async (current) => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await collect(fullPath)
      } else if (entry.isFile() && ['.js', '.mjs', '.cjs'].includes(path.extname(entry.name))) {
        codeFiles.push(fullPath)
      }
    }
  }
  await collect(path.join(projectRoot, 'server'))
  await collect(path.join(projectRoot, 'tools'))

  let nextIndex = 0
  const workers = Array.from({ length: Math.min(8, codeFiles.length) }, async () => {
    while (nextIndex < codeFiles.length) {
      const filePath = codeFiles[nextIndex]
      nextIndex += 1
      await runNodePreflight(['--check', filePath], projectRoot)
    }
  })
  await Promise.all(workers)

  const importTargets = [
    path.join(projectRoot, 'server', 'index.js'),
    path.join(projectRoot, 'server', 'systemUpdate.js'),
    path.join(projectRoot, 'tools', 'start-server.mjs'),
    path.join(projectRoot, 'tools', 'container-entrypoint.mjs'),
  ].map((filePath) => pathToFileURL(filePath).href)
  const importScript = `await Promise.all(${JSON.stringify(importTargets)}.map((target) => import(target)))`
  await runNodePreflight(['--input-type=module', '--eval', importScript], projectRoot)
}

function sameActivePackage(left, right) {
  return Boolean(
    left
    && right
    && left.version === right.version
    && left.packageSha256 === right.packageSha256,
  )
}

async function restoreActivePointerAfterFailedBoot(storageRoot, marker, currentActive, previousActive) {
  const historyRoot = path.join(activeUpdateRoot(storageRoot), 'history')
  await fs.mkdir(historyRoot, { recursive: true })
  if (currentActive && currentActive.version === marker.toVersion && !sameActivePackage(currentActive, previousActive)) {
    await writeJsonAtomically(path.join(
      historyRoot,
      `failed-boot-${Date.now()}-${marker.updateId}-${randomUUID().slice(0, 8)}.json`,
    ), {
      ...activePointerMetadata(currentActive),
      failedBootAt: new Date().toISOString(),
      failureUpdateId: marker.updateId,
    })
  }
  if (previousActive) {
    await writeJsonAtomically(activeUpdatePointerPath(storageRoot), activePointerMetadata(previousActive))
  } else if (currentActive) {
    const archivedPointer = path.join(
      historyRoot,
      `inactive-failed-boot-${Date.now()}-${marker.updateId}-${randomUUID().slice(0, 8)}.json`,
    )
    try {
      await fs.rename(activeUpdatePointerPath(storageRoot), archivedPointer)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
}

async function rollbackPendingUpdateBoot({
  projectRoot,
  storageRoot,
  installDependencies,
  marker,
}) {
  let previousActive = null
  if (marker.previousActive) {
    const previousActiveMetadata = await validateActiveUpdateMetadata(
      storageRoot,
      marker.previousActive,
      { verifyPackage: false },
    )
    if (previousActiveMetadata.version !== marker.fromVersion) {
      throw Object.assign(new Error('The previous active update does not match the rollback runtime.'), {
        code: 'UPDATE_BOOT_MARKER_INVALID',
      })
    }
    try {
      previousActive = await validateActiveUpdateMetadata(storageRoot, previousActiveMetadata)
    } catch (packageError) {
      try {
        previousActive = await restorePreviousActivePackageBackup(
          storageRoot,
          marker.rollbackRoot,
          previousActiveMetadata,
        )
      } catch (backupError) {
        throw Object.assign(new Error(
          `The previous active update and its rollback backup are unavailable: ${backupError?.message ?? backupError}`,
        ), {
          code: packageError?.code ?? 'ACTIVE_UPDATE_MISSING',
          cause: backupError,
        })
      }
    }
  }
  const currentActive = await readActiveUpdatePackage(storageRoot, { verifyPackage: false })
  if (
    currentActive
    && currentActive.version !== marker.toVersion
    && !sameActivePackage(currentActive, previousActive)
  ) {
    throw Object.assign(new Error('The active update changed while startup rollback was pending.'), {
      code: 'UPDATE_BOOT_MARKER_INVALID',
    })
  }

  if (previousActive) {
    await restoreRuntimeFromActiveUpdate({
      projectRoot,
      storageRoot,
      activeUpdate: previousActive,
      installDependencies,
    })
  } else {
    await validateRollbackRuntime(marker.rollbackRoot, marker.fromVersion)
    await restoreRuntimeSnapshot(marker.rollbackRoot, projectRoot)
    await installDependencies(projectRoot)
  }
  await restoreActivePointerAfterFailedBoot(storageRoot, marker, currentActive, previousActive)
  await fs.rm(runtimeInvalidPath(storageRoot), { force: true })

  const archivedPath = await archivePendingBootMarker(storageRoot, marker, 'rolled-back')
  const result = {
    ok: false,
    fromVersion: marker.fromVersion,
    toVersion: marker.toVersion,
    failedAt: new Date().toISOString(),
    error: 'The updated runtime exited before its first boot was confirmed.',
    rollbackRoot: marker.rollbackRoot,
    rollbackFailed: false,
    rollbackError: null,
    startupRollback: true,
    archivedPath,
  }
  await writeJsonAtomically(path.join(storageRoot, UPDATE_RESULT_NAME), result)
  return {
    rolledBack: true,
    version: marker.fromVersion,
    marker,
    previousActiveVersion: previousActive?.version ?? null,
    result,
  }
}

export async function recoverAbandonedPendingUpdateBoot({
  projectRoot,
  storageRoot,
  installDependencies,
  processExists = defaultProcessExists,
  force = false,
  currentProcessId = null,
}) {
  const marker = await readPendingUpdateBoot(storageRoot)
  if (!marker) return { rolledBack: false, pending: false }
  if (marker.bootPid !== null && marker.bootPid === currentProcessId) {
    return { rolledBack: false, pending: true, claimed: true, marker }
  }
  if (!force && marker.bootPid === null) {
    return { rolledBack: false, pending: true, marker }
  }
  if (marker.bootPid !== null && await processExists(marker.bootPid)) {
    throw Object.assign(new Error(`Update boot process ${marker.bootPid} is still running.`), {
      code: 'UPDATE_BOOT_IN_PROGRESS',
    })
  }
  try {
    return await rollbackPendingUpdateBoot({
      projectRoot,
      storageRoot,
      installDependencies,
      marker,
    })
  } catch (error) {
    const invalid = {
      formatVersion: 1,
      appId: 'phd-atlas',
      failedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      fromVersion: marker.fromVersion,
      toVersion: marker.toVersion,
      rollbackRoot: marker.rollbackRoot,
      rollbackFailed: true,
      reason: 'The updated runtime failed its first boot and automatic rollback did not complete.',
    }
    try {
      await writeJsonAtomically(runtimeInvalidPath(storageRoot), invalid)
    } catch (markerError) {
      throw Object.assign(new Error(
        `Startup rollback failed and the invalid-runtime marker could not be written: ${invalid.error}; ${markerError?.message ?? markerError}`,
      ), {
        code: 'UPDATE_BOOT_ROLLBACK_FAILED',
        cause: error,
      })
    }
    throw Object.assign(new Error(`Startup rollback failed: ${invalid.error}`), {
      code: 'UPDATE_BOOT_ROLLBACK_FAILED',
      cause: error,
    })
  }
}

export async function replayActiveUpdateIfNeeded({
  projectRoot,
  storageRoot,
  installDependencies,
  baseVersion,
  baseRuntimeVerified = false,
  requireVerifiedBase = false,
  runtimePreflight = preflightRuntime,
}) {
  const [activeUpdate, runtimeInvalid, pendingBoot, currentPackage] = await Promise.all([
    readActiveUpdatePackage(storageRoot, { verifyPackage: false }),
    readRuntimeInvalidMarker(storageRoot),
    readPendingUpdateBoot(storageRoot),
    fs.readFile(path.join(projectRoot, 'package.json'), 'utf8')
      .then((value) => JSON.parse(value)),
  ])
  if (!activeUpdate) {
    if (pendingBoot) {
      throw Object.assign(new Error(
        `Pending update ${pendingBoot.toVersion} has no active package pointer.`,
      ), { code: 'ACTIVE_UPDATE_MISSING' })
    }
    if (runtimeInvalid) {
      if (baseRuntimeVerified) {
        await installDependencies(projectRoot)
        const recovery = await archiveRuntimeInvalidMarker(storageRoot, baseVersion ?? currentPackage.version)
        return {
          replayed: false,
          version: baseVersion ?? currentPackage.version,
          recoveredBaseRuntime: true,
          recovery,
        }
      }
      throw Object.assign(new Error('The runtime is marked invalid and no active update package is available for repair.'), {
        code: 'UPDATE_RUNTIME_INVALID',
      })
    }
    if (requireVerifiedBase && !baseRuntimeVerified) {
      throw Object.assign(new Error('The container image runtime failed its immutable manifest verification.'), {
        code: 'BASE_RUNTIME_UNVERIFIED',
      })
    }
    return { replayed: false, version: currentPackage.version ?? 'unknown' }
  }
  const imageVersion = baseVersion ?? currentPackage.version
  if (
    baseVersion === undefined
    && !runtimeInvalid
    && currentPackage.version === activeUpdate.version
    && await runtimeMatchesManifestFiles(projectRoot, activeUpdate.files)
  ) {
    await validateActiveUpdateMetadata(storageRoot, activeUpdate)
    return { replayed: false, version: activeUpdate.version, runtimeVerified: true }
  }
  const activeVsImage = compareSemanticVersions(activeUpdate.version, imageVersion)
  if (activeVsImage < 0 || (activeVsImage === 0 && !runtimeInvalid && baseVersion !== undefined)) {
    if (runtimeInvalid && activeVsImage < 0) {
      if (!baseRuntimeVerified) {
        throw Object.assign(new Error(
          `The runtime is marked invalid; refusing to downgrade image ${imageVersion} to active update ${activeUpdate.version}.`,
        ), { code: 'UPDATE_RUNTIME_INVALID' })
      }
      await installDependencies(projectRoot)
      await archiveRuntimeInvalidMarker(storageRoot, imageVersion)
    } else if (!baseRuntimeVerified && baseVersion !== undefined) {
      throw Object.assign(new Error(
        `The container image runtime ${imageVersion} could not be verified; refusing to discard active update ${activeUpdate.version}.`,
      ), { code: 'BASE_RUNTIME_UNVERIFIED' })
    }
    await supersedePendingBootByImage(storageRoot, activeUpdate.version, imageVersion)
    const ignored = await deactivateStaleActiveUpdate(storageRoot, activeUpdate, imageVersion)
    return {
      replayed: false,
      version: imageVersion,
      ignoredActiveVersion: activeUpdate.version,
      recoveredBaseRuntime: Boolean(runtimeInvalid),
      ignored,
    }
  }
  if (activeVsImage === 0 && runtimeInvalid && baseRuntimeVerified) {
    await installDependencies(projectRoot)
    const recovery = await archiveRuntimeInvalidMarker(storageRoot, imageVersion)
    await supersedePendingBootByImage(storageRoot, activeUpdate.version, imageVersion)
    const ignored = await deactivateStaleActiveUpdate(storageRoot, activeUpdate, imageVersion)
    return {
      replayed: false,
      version: imageVersion,
      ignoredActiveVersion: activeUpdate.version,
      recoveredBaseRuntime: true,
      recovery,
      ignored,
    }
  }
  if (
    !runtimeInvalid
    && currentPackage.version === activeUpdate.version
    && await runtimeMatchesManifestFiles(projectRoot, activeUpdate.files)
  ) {
    await validateActiveUpdateMetadata(storageRoot, activeUpdate)
    return { replayed: false, version: activeUpdate.version, runtimeVerified: true }
  }

  const validationRoot = path.join(storageRoot, 'active-update-validation')
  const validated = await validateUpdatePackage(activeUpdate.packagePath, validationRoot)
  try {
    const expectedFiles = JSON.stringify(activeUpdate.files)
    const actualFiles = JSON.stringify(normalizedManifestFiles(validated.manifest.files))
    if (
      validated.manifest.version !== activeUpdate.version
      || validated.manifest.contentSha256 !== activeUpdate.contentSha256
      || actualFiles !== expectedFiles
    ) {
      throw Object.assign(new Error('The active update pointer does not match its package manifest.'), { code: 'ACTIVE_UPDATE_INVALID' })
    }
  } finally {
    await fs.rm(validated.extractRoot, { recursive: true, force: true })
  }

  const result = await applyUpdatePackage({
    packagePath: activeUpdate.packagePath,
    projectRoot,
    storageRoot,
    installDependencies,
    runtimePreflight,
    allowSameVersion: true,
  })
  return { replayed: true, version: result.toVersion, result }
}

async function readUpdateLock(storageRoot) {
  try {
    return JSON.parse(await fs.readFile(updateLockPath(storageRoot), 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw Object.assign(new Error(`The update lock is unreadable: ${error?.message ?? error}`), {
      code: 'UPDATE_LOCK_INVALID',
      cause: error,
    })
  }
}

async function patchUpdateLockIfPresent(storageRoot, patch, expectedPackagePath) {
  const lock = await readUpdateLock(storageRoot)
  if (!lock) return false
  if (
    expectedPackagePath
    && path.resolve(String(lock.packagePath ?? '')) !== path.resolve(expectedPackagePath)
  ) {
    throw Object.assign(new Error('The update lock belongs to a different package.'), {
      code: 'UPDATE_LOCK_CHANGED',
    })
  }
  await writeJsonAtomically(updateLockPath(storageRoot), {
    ...lock,
    ...patch,
    updatedAt: new Date().toISOString(),
  })
  return true
}

async function clearPendingBootForUpdate(storageRoot, updateId, targetVersion) {
  const marker = await readPendingUpdateBoot(storageRoot)
  if (!marker || (marker.updateId !== updateId && marker.toVersion !== targetVersion)) return false
  await archivePendingBootMarker(storageRoot, marker, 'apply-failed')
  return true
}

export async function applyUpdatePackage({
  packagePath,
  projectRoot,
  storageRoot,
  installDependencies,
  runtimePreflight = preflightRuntime,
  allowSameVersion = false,
}) {
  const updateId = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const workRoot = path.join(storageRoot, 'update-work')
  const rollbackRoot = path.join(storageRoot, 'update-rollbacks', updateId)
  const resultPath = path.join(storageRoot, UPDATE_RESULT_NAME)
  await fs.mkdir(workRoot, { recursive: true })
  const { manifest, extractRoot } = await validateUpdatePackage(packagePath, workRoot)
  let previousPackage
  let previousActive
  let rollbackVersion
  try {
    previousPackage = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'))
    const versionComparison = compareSemanticVersions(manifest.version, previousPackage.version)
    if (versionComparison < 0 || (versionComparison === 0 && !allowSameVersion)) {
      throw Object.assign(new Error(
        versionComparison < 0
          ? `Refusing to downgrade ${previousPackage.version} to ${manifest.version}.`
          : `Version ${manifest.version} is already installed.`,
      ), { code: 'UPDATE_VERSION_NOT_NEWER' })
    }
    const pendingContext = await supersedePendingBootForUpdate(
      storageRoot,
      previousPackage.version,
      manifest.version,
    )
    const existingActive = await readActiveUpdatePackage(storageRoot)
    previousActive = pendingContext?.replayingPendingTarget
      ? pendingContext.marker.previousActive
      : existingActive?.version === previousPackage.version
        ? activePointerMetadata(existingActive)
        : null
    rollbackVersion = previousActive?.version ?? previousPackage.version
    await patchUpdateLockIfPresent(storageRoot, {
      phase: 'preparing',
      helperPid: process.pid,
      updateId,
      fromVersion: rollbackVersion,
      toVersion: manifest.version,
    }, packagePath)

    await fs.mkdir(rollbackRoot, { recursive: true })
    for (const entry of ['dist', 'server', 'tools', 'package.json', 'package-lock.json']) {
      await copyPathIfPresent(path.join(projectRoot, entry), path.join(rollbackRoot, entry))
    }
    await validateRollbackRuntime(rollbackRoot, previousPackage.version)
    await backupPreviousActivePackage(storageRoot, rollbackRoot, previousActive)
    await patchUpdateLockIfPresent(storageRoot, {
      phase: 'applying',
      helperPid: process.pid,
      updateId,
      fromVersion: rollbackVersion,
      toVersion: manifest.version,
      rollbackRoot,
      previousActive,
    }, packagePath)
  } catch (error) {
    await fs.rm(extractRoot, { recursive: true, force: true })
    throw error
  }

  try {
    await replaceRuntimeTree(extractRoot, projectRoot)
    await installDependencies(projectRoot)
    await runtimePreflight(projectRoot)
    await writeJsonAtomically(pendingBootPath(storageRoot), {
      formatVersion: 1,
      appId: 'phd-atlas',
      updateId,
      fromVersion: rollbackVersion,
      toVersion: manifest.version,
      rollbackRoot,
      previousActive,
      bootPid: null,
      createdAt: new Date().toISOString(),
    })
    // Publishing the content-addressed package and its atomic pointer is the
    // final fallible success step. Nothing after this point may roll back the
    // runtime while leaving the new active pointer committed.
    const activeUpdate = await persistActiveUpdatePackage({ packagePath, storageRoot, manifest })
    await fs.rm(runtimeInvalidPath(storageRoot), { force: true }).catch((error) => {
      console.error('[system-update] Failed to clear the previous invalid-runtime marker:', error)
    })
    const result = {
      ok: true,
      fromVersion: previousPackage.version ?? 'unknown',
      toVersion: manifest.version,
      appliedAt: new Date().toISOString(),
      rollbackRoot,
      activeUpdate: {
        packageFile: activeUpdate.packageFile,
        packageSha256: activeUpdate.packageSha256,
        packageSize: activeUpdate.packageSize,
        contentSha256: activeUpdate.contentSha256,
      },
    }
    await writeJsonAtomically(resultPath, result).catch((error) => {
      console.error('[system-update] Failed to write the success result:', error)
    })
    return result
  } catch (error) {
    let rollbackTreeError = null
    let rollbackDependencyError = null
    let rollbackCoordinationError = null
    try {
      if (previousActive) {
        const resolvedPreviousActive = await validateActiveUpdateMetadata(storageRoot, previousActive)
        await replaceRuntimeFromActiveUpdate({
          projectRoot,
          storageRoot,
          activeUpdate: resolvedPreviousActive,
        })
        await writeJsonAtomically(
          activeUpdatePointerPath(storageRoot),
          activePointerMetadata(resolvedPreviousActive),
        )
      } else {
        await restoreRuntimeSnapshot(rollbackRoot, projectRoot)
      }
    } catch (rollbackError) {
      rollbackTreeError = rollbackError
    }
    try {
      await installDependencies(projectRoot)
    } catch (rollbackError) {
      rollbackDependencyError = rollbackError
    }
    try {
      await clearPendingBootForUpdate(storageRoot, updateId, manifest.version)
    } catch (rollbackError) {
      rollbackCoordinationError = rollbackError
    }
    const rollbackFailed = Boolean(rollbackTreeError || rollbackDependencyError || rollbackCoordinationError)
    const rollbackErrors = [
      rollbackTreeError ? `runtime restore: ${rollbackTreeError instanceof Error ? rollbackTreeError.message : String(rollbackTreeError)}` : '',
      rollbackDependencyError ? `dependency restore: ${rollbackDependencyError instanceof Error ? rollbackDependencyError.message : String(rollbackDependencyError)}` : '',
      rollbackCoordinationError ? `boot marker cleanup: ${rollbackCoordinationError instanceof Error ? rollbackCoordinationError.message : String(rollbackCoordinationError)}` : '',
    ].filter(Boolean)
    const result = {
      ok: false,
      fromVersion: previousPackage.version ?? 'unknown',
      toVersion: manifest.version,
      failedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      rollbackRoot,
      rollbackFailed,
      rollbackError: rollbackErrors.join('; ') || null,
    }
    if (rollbackFailed) {
      try {
        await writeJsonAtomically(runtimeInvalidPath(storageRoot), {
          ...result,
          reason: 'The update failed and rollback did not restore a runnable dependency tree.',
        })
      } catch (markerError) {
        throw Object.assign(new Error(
          `Update rollback failed and the invalid-runtime marker could not be written: ${result.rollbackError}; ${markerError?.message ?? markerError}`,
        ), {
          code: 'UPDATE_ROLLBACK_FAILED',
          cause: error,
          rollbackFailed: true,
        })
      }
    }
    await writeJsonAtomically(resultPath, result).catch((resultError) => {
      console.error('[system-update] Failed to write the update failure result:', resultError)
    })
    const message = rollbackFailed
      ? `Update failed and rollback is incomplete: ${result.error}; ${result.rollbackError}`
      : `Update failed and the previous runtime was restored: ${result.error}`
    throw Object.assign(new Error(message), {
      code: rollbackFailed ? 'UPDATE_ROLLBACK_FAILED' : 'UPDATE_APPLY_FAILED',
      cause: error,
      rollbackFailed,
    })
  } finally {
    await fs.rm(extractRoot, { recursive: true, force: true })
  }
}

export async function writeUpdateLock(storageRoot, data) {
  const filePath = updateLockPath(storageRoot)
  await writeJsonAtomically(filePath, {
    formatVersion: 1,
    updateId: data.updateId ?? `${Date.now()}-${randomUUID().slice(0, 8)}`,
    phase: data.phase ?? 'scheduled',
    requestedAt: data.requestedAt ?? new Date().toISOString(),
    ...data,
  })
  return filePath
}

export async function claimUpdateLock(storageRoot, {
  packagePath,
  helperPid,
}) {
  const lock = await readUpdateLock(storageRoot)
  if (!lock) {
    throw Object.assign(new Error('The scheduled update lock is missing.'), {
      code: 'UPDATE_LOCK_MISSING',
    })
  }
  if (
    path.resolve(String(lock.packagePath ?? '')) !== path.resolve(packagePath)
    || !Number.isSafeInteger(helperPid)
    || helperPid <= 0
    || (lock.helperPid && lock.helperPid !== helperPid)
  ) {
    throw Object.assign(new Error('The scheduled update lock belongs to another update helper.'), {
      code: 'UPDATE_LOCK_CHANGED',
    })
  }
  const claimed = {
    ...lock,
    phase: lock.phase === 'applying' ? 'applying' : 'claimed',
    helperPid,
    claimedAt: lock.claimedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  await writeJsonAtomically(updateLockPath(storageRoot), claimed)
  return claimed
}

export async function clearUpdateLock(storageRoot, expected = null) {
  if (expected) {
    const lock = await readUpdateLock(storageRoot)
    if (!lock) return false
    if (
      expected.updateId && lock.updateId !== expected.updateId
      || expected.packagePath
        && path.resolve(String(lock.packagePath ?? '')) !== path.resolve(expected.packagePath)
      || expected.helperPid
        && lock.helperPid
        && lock.helperPid !== expected.helperPid
    ) {
      return false
    }
  }
  await fs.rm(updateLockPath(storageRoot), { force: true })
  return true
}

export async function readUpdateLockState(storageRoot) {
  return readUpdateLock(storageRoot)
}

export async function isUpdateLockAbandoned(lock, options = {}) {
  if (!lock) return false
  const processExists = options.processExists ?? defaultProcessExists
  if (Number.isSafeInteger(lock.helperPid) && lock.helperPid > 0) {
    return !(await processExists(lock.helperPid))
  }
  if (Number.isSafeInteger(lock.previousPid) && lock.previousPid > 0 && await processExists(lock.previousPid)) {
    return false
  }
  const requestedAt = Date.parse(String(lock.requestedAt ?? ''))
  const claimGraceMs = options.claimGraceMs ?? 30_000
  if (!Number.isFinite(requestedAt)) return true
  return (options.now?.() ?? Date.now()) - requestedAt >= claimGraceMs
}

async function archiveAbandonedUpdateLock(storageRoot, lock, disposition) {
  const current = await readUpdateLock(storageRoot)
  if (!current) return null
  if (
    current.requestedAt !== lock.requestedAt
    || current.packagePath !== lock.packagePath
    || current.updateId !== lock.updateId
    || current.phase !== lock.phase
    || current.helperPid !== lock.helperPid
  ) {
    throw Object.assign(new Error('The update lock changed while recovery was starting.'), {
      code: 'UPDATE_LOCK_CHANGED',
    })
  }
  const historyRoot = path.join(storageRoot, 'update-lock-history')
  const archivedPath = path.join(
    historyRoot,
    `${disposition}-${Date.now()}-${randomUUID().slice(0, 8)}.json`,
  )
  await fs.mkdir(historyRoot, { recursive: true })
  await fs.rename(updateLockPath(storageRoot), archivedPath)
  return archivedPath
}

export async function recoverAbandonedUpdateLock({
  projectRoot,
  storageRoot,
  installDependencies,
  processExists = defaultProcessExists,
  claimGraceMs = 30_000,
  now = Date.now,
}) {
  const lock = await readUpdateLock(storageRoot)
  if (!lock) return { recovered: false, lockPresent: false }
  if (!await isUpdateLockAbandoned(lock, { processExists, claimGraceMs, now })) {
    return { recovered: false, lockPresent: true, active: true }
  }

  if (lock.phase !== 'applying') {
    const archivedPath = await archiveAbandonedUpdateLock(storageRoot, lock, 'abandoned-before-mutation')
    return {
      recovered: true,
      runtimeChanged: false,
      archivedPath,
    }
  }

  let pendingBoot = await readPendingUpdateBoot(storageRoot)
  const currentActive = await readActiveUpdatePackage(storageRoot, { verifyPackage: false })
  if (
    pendingBoot
    && (pendingBoot.updateId !== lock.updateId || pendingBoot.toVersion !== lock.toVersion)
  ) {
    throw Object.assign(new Error('The pending boot marker does not belong to the abandoned update lock.'), {
      code: 'UPDATE_LOCK_INVALID',
    })
  }
  if (
    pendingBoot
    && pendingBoot.toVersion === lock.toVersion
    && currentActive?.version === lock.toVersion
    && pendingBoot.bootPid === null
  ) {
    try {
      await validateActiveUpdateMetadata(storageRoot, currentActive)
      const archivedPath = await archiveAbandonedUpdateLock(storageRoot, lock, 'completed-before-lock-clear')
      return {
        recovered: true,
        runtimeChanged: true,
        updateCompleted: true,
        archivedPath,
      }
    } catch {
      // A boot trial without a durable candidate package cannot survive
      // container recreation. Fall through to the previous-runtime rollback.
    }
  }

  if (!pendingBoot) {
    try {
      const candidate = {
        formatVersion: 1,
        appId: 'phd-atlas',
        updateId: lock.updateId,
        fromVersion: lock.fromVersion,
        toVersion: lock.toVersion,
        rollbackRoot: lock.rollbackRoot,
        previousActive: lock.previousActive ?? null,
        bootPid: null,
        createdAt: lock.updatedAt ?? lock.requestedAt ?? new Date(now()).toISOString(),
      }
      pendingBoot = validatePendingBootMarker(storageRoot, candidate)
      await writeJsonAtomically(pendingBootPath(storageRoot), candidate)
    } catch (error) {
      const invalid = {
        formatVersion: 1,
        appId: 'phd-atlas',
        failedAt: new Date(now()).toISOString(),
        error: error instanceof Error ? error.message : String(error),
        lock,
        rollbackFailed: true,
        reason: 'An abandoned update lock indicates possible runtime mutation, but no safe rollback snapshot was available.',
      }
      await writeJsonAtomically(runtimeInvalidPath(storageRoot), invalid)
      const archivedPath = await archiveAbandonedUpdateLock(storageRoot, lock, 'abandoned-runtime-invalid')
      return {
        recovered: true,
        runtimeChanged: true,
        runtimeInvalid: true,
        archivedPath,
      }
    }
  }

  const rollback = await recoverAbandonedPendingUpdateBoot({
    projectRoot,
    storageRoot,
    installDependencies,
    processExists,
    force: true,
  })
  const latestLock = await readUpdateLock(storageRoot)
  const archivedPath = latestLock
    ? await archiveAbandonedUpdateLock(storageRoot, latestLock, 'abandoned-rolled-back')
    : null
  return {
    recovered: true,
    runtimeChanged: true,
    rollback,
    archivedPath,
  }
}
