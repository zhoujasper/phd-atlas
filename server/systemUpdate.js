import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import tar from 'tar-fs'

export const UPDATE_MANIFEST_NAME = 'update-manifest.json'
export const UPDATE_LOCK_NAME = '.update-in-progress.json'
export const UPDATE_RESULT_NAME = 'last-update-result.json'

const REQUIRED_RUNTIME_FILES = new Set([
  'dist/index.html',
  'server/index.js',
  'tools/start-server.mjs',
  'tools/apply-update.mjs',
  'package.json',
  'package-lock.json',
])

function normalizedArchivePath(value) {
  const normalized = path.posix.normalize(String(value ?? '').replaceAll('\\', '/').replace(/^\.\/+/, ''))
  if (!normalized || normalized === '.' || normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) {
    throw Object.assign(new Error('Update package contains an unsafe path.'), { code: 'INVALID_UPDATE_PACKAGE' })
  }
  return normalized
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

async function extractTarGzip(packagePath, destination) {
  await fs.mkdir(destination, { recursive: true })
  await pipeline(
    createReadStream(packagePath),
    createGunzip(),
    tar.extract(destination, {
      ignore(_name, header) {
        if (header.name === '.' || header.name === './') return true
        normalizedArchivePath(header.name)
        if (header.type === 'symlink' || header.type === 'link') {
          throw Object.assign(new Error('Update packages cannot contain links.'), { code: 'INVALID_UPDATE_PACKAGE' })
        }
        return false
      },
    }),
  )
}

function manifestDigest(files) {
  const hash = createHash('sha256')
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(`${file.path}\0${file.sha256}\0${file.size}\n`)
  }
  return hash.digest('hex')
}

export async function validateUpdatePackage(packagePath, workRoot) {
  const extractRoot = path.join(workRoot, `validated-${randomUUID()}`)
  await extractTarGzip(packagePath, extractRoot)
  try {
    const manifestPath = path.join(extractRoot, UPDATE_MANIFEST_NAME)
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    if (manifest.formatVersion !== 1 || manifest.appId !== 'phd-atlas' || !Array.isArray(manifest.files)) {
      throw Object.assign(new Error('This is not a supported PhD Atlas update package.'), { code: 'INVALID_UPDATE_PACKAGE' })
    }
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(manifest.version ?? ''))) {
      throw Object.assign(new Error('The update package version is invalid.'), { code: 'INVALID_UPDATE_PACKAGE' })
    }

    const seen = new Set()
    for (const entry of manifest.files) {
      const relativePath = normalizedArchivePath(entry.path)
      if (!isManagedRuntimePath(relativePath) || seen.has(relativePath)) {
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
    if (manifestDigest(manifest.files) !== manifest.contentSha256) {
      throw Object.assign(new Error('Update package content fingerprint does not match its manifest.'), { code: 'UPDATE_INTEGRITY_FAILED' })
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
  for (const root of ['dist', 'server']) {
    await fs.rm(path.join(projectRoot, root), { recursive: true, force: true })
    await fs.cp(path.join(extractRoot, root), path.join(projectRoot, root), { recursive: true, force: true })
  }
  for (const file of ['package.json', 'package-lock.json']) {
    await fs.copyFile(path.join(extractRoot, file), path.join(projectRoot, file))
  }
  const toolsRoot = path.join(extractRoot, 'tools')
  for (const entry of await fs.readdir(toolsRoot, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    await fs.copyFile(path.join(toolsRoot, entry.name), path.join(projectRoot, 'tools', entry.name))
  }
}

export async function applyUpdatePackage({
  packagePath,
  projectRoot,
  storageRoot,
  installDependencies,
}) {
  const updateId = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const workRoot = path.join(storageRoot, 'update-work')
  const rollbackRoot = path.join(storageRoot, 'update-rollbacks', updateId)
  const resultPath = path.join(storageRoot, UPDATE_RESULT_NAME)
  await fs.mkdir(workRoot, { recursive: true })
  const { manifest, extractRoot } = await validateUpdatePackage(packagePath, workRoot)
  const previousPackage = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'))

  await fs.mkdir(rollbackRoot, { recursive: true })
  for (const entry of ['dist', 'server', 'tools', 'package.json', 'package-lock.json']) {
    await copyPathIfPresent(path.join(projectRoot, entry), path.join(rollbackRoot, entry))
  }

  try {
    await replaceRuntimeTree(extractRoot, projectRoot)
    await installDependencies(projectRoot)
    const result = {
      ok: true,
      fromVersion: previousPackage.version ?? 'unknown',
      toVersion: manifest.version,
      appliedAt: new Date().toISOString(),
      rollbackRoot,
    }
    await fs.writeFile(resultPath, JSON.stringify(result, null, 2), 'utf8')
    return result
  } catch (error) {
    for (const entry of ['dist', 'server', 'tools']) {
      await fs.rm(path.join(projectRoot, entry), { recursive: true, force: true })
      await copyPathIfPresent(path.join(rollbackRoot, entry), path.join(projectRoot, entry))
    }
    for (const file of ['package.json', 'package-lock.json']) {
      await copyPathIfPresent(path.join(rollbackRoot, file), path.join(projectRoot, file))
    }
    try {
      await installDependencies(projectRoot)
    } catch {
      // Preserve the original update error; the result file records rollback failure below.
    }
    const result = {
      ok: false,
      fromVersion: previousPackage.version ?? 'unknown',
      toVersion: manifest.version,
      failedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      rollbackRoot,
    }
    await fs.writeFile(resultPath, JSON.stringify(result, null, 2), 'utf8')
    throw Object.assign(new Error(`Update failed and the previous runtime was restored: ${result.error}`), {
      code: 'UPDATE_APPLY_FAILED',
      cause: error,
    })
  } finally {
    await fs.rm(extractRoot, { recursive: true, force: true })
  }
}

export async function writeUpdateLock(storageRoot, data) {
  const filePath = path.join(storageRoot, UPDATE_LOCK_NAME)
  await fs.mkdir(storageRoot, { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8')
  return filePath
}

export async function clearUpdateLock(storageRoot) {
  await fs.rm(path.join(storageRoot, UPDATE_LOCK_NAME), { force: true })
}
