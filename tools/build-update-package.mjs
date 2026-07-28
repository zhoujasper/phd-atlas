import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { createGzip } from 'node:zlib'
import tarFs from 'tar-fs'
import { dependencyArtifactCandidates } from '../server/dependencyInstall.js'
import {
  createRuntimePackageJson,
  createRuntimePackageLock,
  createVendoredRuntimePackageLock,
} from './runtime-package-manifest.mjs'

const __filename = fileURLToPath(import.meta.url)
const projectRoot = resolve(dirname(__filename), '..')
const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
const packageLock = JSON.parse(readFileSync(join(projectRoot, 'package-lock.json'), 'utf8'))
const outRoot = join(projectRoot, 'storage', 'update-packages')
const stageRoot = join(projectRoot, 'storage', 'update-package-stage')
const dependencyCacheRoot = join(projectRoot, 'storage', 'update-dependency-cache')
const packageName = `phd-atlas-update-${packageJson.version}-release.tar.gz`
const packagePath = join(outRoot, packageName)
const checksumPath = `${packagePath}.sha256`
const maximumPackageBytes = 100 * 1024 * 1024
const maximumDependencyArtifactBytes = 128 * 1024 * 1024
const dependencyDownloadConcurrency = 8
const buildCommand = process.platform === 'win32' ? 'cmd.exe' : 'npm'
const buildArgs = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run build'] : ['run', 'build']

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    ...options,
  })
  if (result.error) {
    console.error(result.error.message)
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function verifyDependencyIntegrity(contents, integrity) {
  const checks = String(integrity)
    .split(/\s+/)
    .map((value) => /^([a-z0-9]+)-([A-Za-z0-9+/=]+)(?:\?.*)?$/i.exec(value))
    .filter(Boolean)
  if (checks.length === 0) return false
  return checks.some(([, algorithm, expected]) => {
    try {
      return createHash(algorithm).update(contents).digest().equals(Buffer.from(expected, 'base64'))
    } catch {
      return false
    }
  })
}

async function downloadDependencyArtifact(artifact, destination) {
  const cached = join(dependencyCacheRoot, artifact.fileName)
  if (existsSync(cached)) {
    const contents = readFileSync(cached)
    if (verifyDependencyIntegrity(contents, artifact.integrity)) {
      writeFileSync(destination, contents)
      return
    }
    rmSync(cached, { force: true })
  }

  const failures = []
  for (const candidate of dependencyArtifactCandidates(artifact.source)) {
    try {
      const response = await fetch(candidate, {
        headers: {
          accept: 'application/octet-stream',
          'user-agent': 'phd-atlas-release-builder',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(45_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const declaredSize = Number(response.headers.get('content-length'))
      if (Number.isFinite(declaredSize) && declaredSize > maximumDependencyArtifactBytes) {
        throw new Error(`declared size ${declaredSize} exceeds the safety limit`)
      }
      const contents = Buffer.from(await response.arrayBuffer())
      if (contents.length > maximumDependencyArtifactBytes) {
        throw new Error(`downloaded size ${contents.length} exceeds the safety limit`)
      }
      if (!verifyDependencyIntegrity(contents, artifact.integrity)) {
        throw new Error('integrity did not match package-lock.json')
      }
      writeFileSync(cached, contents)
      writeFileSync(destination, contents)
      return
    } catch (error) {
      failures.push(`${candidate}: ${error?.message ?? error}`)
    }
  }
  throw new Error(
    `Could not vendor ${artifact.packagePaths.join(', ')} from any dependency source:\n${failures.join('\n')}`,
  )
}

async function vendorProductionDependencies(runtimeLock) {
  const { packageLock: vendoredLock, artifacts } = createVendoredRuntimePackageLock(runtimeLock)
  const vendorRoot = join(stageRoot, 'tools', 'runtime-packages')
  mkdirSync(vendorRoot, { recursive: true })
  mkdirSync(dependencyCacheRoot, { recursive: true })

  const uniqueArtifacts = new Map()
  for (const artifact of artifacts) {
    const existing = uniqueArtifacts.get(artifact.fileName)
    if (existing) {
      existing.packagePaths.push(artifact.packagePath)
    } else {
      uniqueArtifacts.set(artifact.fileName, {
        ...artifact,
        packagePaths: [artifact.packagePath],
      })
    }
  }
  const pending = [...uniqueArtifacts.values()]
    .sort((left, right) => left.fileName < right.fileName ? -1 : left.fileName > right.fileName ? 1 : 0)
  let nextIndex = 0
  let completed = 0
  const workers = Array.from(
    { length: Math.min(dependencyDownloadConcurrency, pending.length) },
    async () => {
      while (nextIndex < pending.length) {
        const artifact = pending[nextIndex]
        nextIndex += 1
        await downloadDependencyArtifact(artifact, join(vendorRoot, artifact.fileName))
        completed += 1
        if (completed % 25 === 0 || completed === pending.length) {
          console.log(`Vendored ${completed}/${pending.length} production dependency archives.`)
        }
      }
    },
  )
  await Promise.all(workers)
  writeFileSync(
    join(vendorRoot, 'index.json'),
    `${JSON.stringify({
      formatVersion: 1,
      packageCount: artifacts.length,
      artifactCount: pending.length,
      artifacts: pending.map((artifact) => ({
        file: artifact.fileName,
        integrity: artifact.integrity,
        packages: artifact.packagePaths.sort(),
      })),
    }, null, 2)}\n`,
    'utf8',
  )
  return vendoredLock
}

function releaseTimestamp() {
  const configured = Number(process.env.SOURCE_DATE_EPOCH)
  if (Number.isSafeInteger(configured) && configured >= 0) return configured
  const commitTime = spawnSync('git', ['show', '-s', '--format=%ct', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
  })
  const parsed = Number(String(commitTime.stdout ?? '').trim())
  if (commitTime.status === 0 && Number.isSafeInteger(parsed) && parsed >= 0) return parsed
  throw new Error('SOURCE_DATE_EPOCH is required when the update package is built outside a Git checkout.')
}

const deterministicTimestamp = releaseTimestamp()
const deterministicDate = new Date(deterministicTimestamp * 1000)
const createdAt = deterministicDate.toISOString()

mkdirSync(outRoot, { recursive: true })
rmSync(stageRoot, { recursive: true, force: true })
mkdirSync(stageRoot, { recursive: true })

run(buildCommand, buildArgs)

for (const entry of ['dist', 'server']) {
  const source = join(projectRoot, entry)
  if (existsSync(source)) {
    cpSync(source, join(stageRoot, entry), { recursive: true })
  }
}
writeFileSync(
  join(stageRoot, 'package.json'),
  `${JSON.stringify(createRuntimePackageJson(packageJson), null, 2)}\n`,
  'utf8',
)
const runtimePackageLock = createRuntimePackageLock(packageJson, packageLock)
const vendoredPackageLock = await vendorProductionDependencies(runtimePackageLock)
writeFileSync(
  join(stageRoot, 'package-lock.json'),
  `${JSON.stringify(vendoredPackageLock, null, 2)}\n`,
  'utf8',
)

const runtimeToolNames = ['start-server.mjs', 'apply-update.mjs', 'container-entrypoint.mjs']
mkdirSync(join(stageRoot, 'tools'), { recursive: true })
for (const toolName of runtimeToolNames) {
  const source = join(projectRoot, 'tools', toolName)
  if (!existsSync(source)) {
    throw new Error(`Required runtime tool is missing: tools/${toolName}`)
  }
  cpSync(source, join(stageRoot, 'tools', toolName))
}

function removeServerTests(current) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const fullPath = join(current, entry.name)
    if (entry.isDirectory()) removeServerTests(fullPath)
    else if (entry.isFile() && entry.name.endsWith('.test.js')) rmSync(fullPath, { force: true })
  }
}

removeServerTests(join(stageRoot, 'server'))

function listFiles(root, current = root) {
  const result = []
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const fullPath = join(current, entry.name)
    if (entry.isDirectory()) result.push(...listFiles(root, fullPath))
    else if (entry.isFile()) result.push(fullPath)
  }
  return result
}

const files = listFiles(stageRoot)
  .filter((filePath) => !filePath.endsWith('UPDATE_PACKAGE_README.txt'))
  .map((filePath) => {
    const contents = readFileSync(filePath)
    return {
      path: relative(stageRoot, filePath).split(sep).join('/'),
      size: statSync(filePath).size,
      sha256: createHash('sha256').update(contents).digest('hex'),
    }
  })
  .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))

const contentHash = createHash('sha256')
for (const file of files) {
  contentHash.update(`${file.path}\0${file.sha256}\0${file.size}\n`)
}
writeFileSync(
  join(stageRoot, 'update-manifest.json'),
  JSON.stringify({
    formatVersion: 1,
    appId: 'phd-atlas',
    version: packageJson.version,
    createdAt,
    contentSha256: contentHash.digest('hex'),
    files,
  }, null, 2),
  'utf8',
)

writeFileSync(
  join(stageRoot, 'UPDATE_PACKAGE_README.txt'),
  [
    'PhD Atlas update package',
    `version=${packageJson.version}`,
    `createdAt=${createdAt}`,
    '',
    'Migration boundary: installations older than 0.1.0-beta.6 must download this .tar.gz',
    'Release asset and upload it from Admin > System information > System update.',
    'After 0.1.0-beta.6 is installed, later Release updates can complete automatically.',
    'The package carries its complete integrity-pinned production dependency graph and',
    'retains bounded international/mainland source fallback for future extensions.',
    'The server validates, stores, installs, and first-boot checks the package with rollback protection.',
  ].join('\n'),
  'utf8',
)

await pipeline(
  tarFs.pack(stageRoot, {
    sort: true,
    map(header) {
      return {
        ...header,
        uid: 0,
        gid: 0,
        mode: header.type === 'directory' ? 0o755 : 0o644,
        mtime: deterministicDate,
      }
    },
  }),
  createGzip({ level: 9 }),
  createWriteStream(packagePath, { mode: 0o644 }),
)
rmSync(stageRoot, { recursive: true, force: true })

const packageSize = statSync(packagePath).size
if (packageSize > maximumPackageBytes) {
  rmSync(packagePath, { force: true })
  throw new Error(`Update package is ${packageSize} bytes; the supported maximum is ${maximumPackageBytes} bytes.`)
}

const packageHash = createHash('sha256')
for await (const chunk of createReadStream(packagePath)) packageHash.update(chunk)
writeFileSync(checksumPath, `${packageHash.digest('hex')}  ${basename(packagePath)}\n`, 'ascii')

console.log(`Update package written to ${packagePath}`)
console.log(`SHA-256 checksum written to ${checksumPath}`)
