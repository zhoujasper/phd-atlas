import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createGunzip, createGzip } from 'node:zlib'
import tar from 'tar-fs'

const __filename = fileURLToPath(import.meta.url)
const projectRoot = path.resolve(path.dirname(__filename), '..')
const packagePath = path.resolve(process.argv[2] ?? '')
const beta8Tag = 'v0.1.0-beta.8'
const beta8Version = '0.1.0-beta.8'
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

if (!process.argv[2]) {
  throw new Error('Usage: node tools/verify-beta8-update-compatibility.mjs <package.tar.gz>')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
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

async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

function createBeta8Archive(archivePath) {
  const result = spawnSync('git', [
    'archive',
    '--format=tar',
    `--output=${archivePath}`,
    beta8Tag,
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Could not archive ${beta8Tag}: ${result.stderr?.trim() || `exit ${result.status}`}`)
  }
}

async function extractBeta8Runtime(archivePath, destination) {
  await fs.mkdir(destination, { recursive: true })
  await pipeline(createReadStream(archivePath), tar.extract(destination))
  // dist/ is generated and Git-ignored, but it is present in the published
  // Beta.8 container and is mandatory for its rollback snapshot contract.
  await fs.mkdir(path.join(destination, 'dist'), { recursive: true })
  await fs.writeFile(
    path.join(destination, 'dist', 'index.html'),
    '<title>PhD Atlas 0.1.0-beta.8 compatibility fixture</title>\n',
    'utf8',
  )
  const metadata = await readJson(path.join(destination, 'package.json'))
  assert(metadata.version === beta8Version, `Historical fixture is ${metadata.version}, not ${beta8Version}.`)
}

async function importBeta8Updater(runtimeRoot, phase) {
  const moduleUrl = pathToFileURL(path.join(runtimeRoot, 'server', 'systemUpdate.js')).href
  return import(`${moduleUrl}?compatibilityPhase=${encodeURIComponent(phase)}-${Date.now()}`)
}

async function createBrokenPreflightPackage(sourcePackage, stageRoot, outputPath) {
  await fs.mkdir(stageRoot, { recursive: true })
  await pipeline(createReadStream(sourcePackage), createGunzip(), tar.extract(stageRoot))
  const manifestPath = path.join(stageRoot, 'update-manifest.json')
  const serverEntryPath = path.join(stageRoot, 'server', 'index.js')
  await fs.appendFile(
    serverEntryPath,
    "\nimport './shared/beta8-compatibility-missing.js'\n",
    'utf8',
  )
  const manifest = await readJson(manifestPath)
  const contents = await fs.readFile(serverEntryPath)
  const entry = manifest.files.find((candidate) => candidate.path === 'server/index.js')
  assert(entry, 'Candidate package manifest is missing server/index.js.')
  entry.size = contents.length
  entry.sha256 = createHash('sha256').update(contents).digest('hex')
  manifest.contentSha256 = manifestDigest(manifest.files)
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await pipeline(tar.pack(stageRoot), createGzip({ level: 9 }), createWriteStream(outputPath))
  return manifest.version
}

async function confirmBoot(updater, storageRoot) {
  const marker = await updater.claimPendingUpdateBoot(storageRoot, process.pid)
  assert(marker, 'Updated runtime did not publish a pending first-boot marker.')
  const confirmation = await updater.confirmPendingUpdateBoot(storageRoot, process.pid)
  assert(confirmation?.disposition === 'confirmed', 'Updated runtime first boot was not confirmed.')
}

async function assertSuccessfulRuntime(runtimeRoot, storageRoot, targetVersion, sentinel) {
  const metadata = await readJson(path.join(runtimeRoot, 'package.json'))
  assert(metadata.version === targetVersion, `Installed runtime remained at ${metadata.version}.`)
  for (const name of runtimeSharedNames) {
    assert(
      await exists(path.join(runtimeRoot, 'server', 'shared', name)),
      `Installed runtime is missing server/shared/${name}.`,
    )
  }
  assert(
    !await exists(path.join(runtimeRoot, 'shared', 'aiConcurrency.js')),
    'Compatibility test unexpectedly depended on a root shared/ runtime directory.',
  )
  assert(
    await fs.readFile(path.join(storageRoot, 'compatibility-sentinel.txt'), 'utf8') === sentinel,
    'Persistent storage sentinel changed during the update.',
  )
  assert(!await exists(path.join(storageRoot, '.update-boot-pending.json')), 'Pending boot marker was not cleared.')
  assert(!await exists(path.join(storageRoot, '.update-runtime-invalid.json')), 'Runtime was marked invalid.')
  const result = await readJson(path.join(storageRoot, 'last-update-result.json'))
  assert(result.ok === true && result.toVersion === targetVersion, 'Successful update result is incomplete.')
}

const compatibilityRoot = path.join(projectRoot, 'storage', 'beta8-update-compatibility')
await fs.mkdir(compatibilityRoot, { recursive: true })
const scratchRoot = await fs.mkdtemp(path.join(compatibilityRoot, 'run-'))
const beta8ArchivePath = path.join(scratchRoot, 'beta8.tar')
const successRuntime = path.join(scratchRoot, 'success-runtime')
const replayRuntime = path.join(scratchRoot, 'replay-runtime')
const rollbackRuntime = path.join(scratchRoot, 'rollback-runtime')
const successStorage = path.join(scratchRoot, 'success-storage')
const rollbackStorage = path.join(scratchRoot, 'rollback-storage')
const brokenStage = path.join(scratchRoot, 'broken-stage')
const brokenPackage = path.join(scratchRoot, 'broken-preflight.tar.gz')
const successSentinel = 'beta8-persistent-data-survived\n'
const rollbackSentinel = 'beta8-rollback-data-survived\n'

try {
  await fs.access(packagePath)
  createBeta8Archive(beta8ArchivePath)
  await Promise.all([
    extractBeta8Runtime(beta8ArchivePath, successRuntime),
    extractBeta8Runtime(beta8ArchivePath, replayRuntime),
    extractBeta8Runtime(beta8ArchivePath, rollbackRuntime),
    fs.mkdir(successStorage, { recursive: true }),
    fs.mkdir(rollbackStorage, { recursive: true }),
  ])
  await Promise.all([
    fs.writeFile(path.join(successStorage, 'compatibility-sentinel.txt'), successSentinel, 'utf8'),
    fs.writeFile(path.join(rollbackStorage, 'compatibility-sentinel.txt'), rollbackSentinel, 'utf8'),
    fs.writeFile(path.join(rollbackRuntime, 'server', 'pre-update-sentinel.txt'), 'beta8-runtime\n', 'utf8'),
  ])

  const targetVersion = await createBrokenPreflightPackage(packagePath, brokenStage, brokenPackage)
  assert(targetVersion !== beta8Version, 'Compatibility candidate did not advance the Beta.8 version.')

  const beta8Updater = await importBeta8Updater(successRuntime, 'direct-apply')
  const applied = await beta8Updater.applyUpdatePackage({
    packagePath,
    projectRoot: successRuntime,
    storageRoot: successStorage,
    installDependencies: async () => {},
  })
  assert(applied.ok === true && applied.fromVersion === beta8Version, 'Beta.8 direct apply did not succeed.')
  await confirmBoot(beta8Updater, successStorage)
  await assertSuccessfulRuntime(successRuntime, successStorage, targetVersion, successSentinel)

  const replayUpdater = await importBeta8Updater(replayRuntime, 'active-replay')
  const replayed = await replayUpdater.replayActiveUpdateIfNeeded({
    projectRoot: replayRuntime,
    storageRoot: successStorage,
    installDependencies: async () => {},
    baseVersion: beta8Version,
    baseRuntimeVerified: true,
  })
  assert(replayed.replayed === true && replayed.version === targetVersion, 'Beta.8 image did not replay the active update.')
  await confirmBoot(replayUpdater, successStorage)
  await assertSuccessfulRuntime(replayRuntime, successStorage, targetVersion, successSentinel)

  const rollbackUpdater = await importBeta8Updater(rollbackRuntime, 'rollback')
  let rejected = null
  try {
    await rollbackUpdater.applyUpdatePackage({
      packagePath: brokenPackage,
      projectRoot: rollbackRuntime,
      storageRoot: rollbackStorage,
      installDependencies: async () => {},
    })
  } catch (error) {
    rejected = error
  }
  assert(
    rejected?.code === 'UPDATE_APPLY_FAILED' && rejected?.rollbackFailed === false,
    `Broken candidate did not roll back cleanly: ${rejected?.message ?? 'no failure'}`,
  )
  const restoredMetadata = await readJson(path.join(rollbackRuntime, 'package.json'))
  const rollbackResult = await readJson(path.join(rollbackStorage, 'last-update-result.json'))
  assert(restoredMetadata.version === beta8Version, 'Rollback did not restore the Beta.8 package metadata.')
  assert(
    await fs.readFile(path.join(rollbackRuntime, 'server', 'pre-update-sentinel.txt'), 'utf8') === 'beta8-runtime\n',
    'Rollback did not restore the Beta.8 server tree.',
  )
  assert(
    await fs.readFile(path.join(rollbackStorage, 'compatibility-sentinel.txt'), 'utf8') === rollbackSentinel,
    'Rollback changed persistent storage.',
  )
  assert(rollbackResult.ok === false && rollbackResult.rollbackFailed === false, 'Rollback result is incomplete.')
  assert(!await exists(path.join(rollbackStorage, '.update-runtime-invalid.json')), 'Clean rollback marked the runtime invalid.')
  assert(!await exists(path.join(rollbackStorage, '.update-boot-pending.json')), 'Clean rollback left a pending boot marker.')
  assert(!await exists(path.join(rollbackStorage, 'active-update', 'active.json')), 'Rejected update advanced the active pointer.')

  console.log(JSON.stringify({
    ok: true,
    fromVersion: beta8Version,
    toVersion: targetVersion,
    directApply: true,
    firstBootConfirmed: true,
    activeReplayFromBeta8Image: true,
    failedCandidateRolledBack: true,
    persistentStoragePreserved: true,
  }))
} finally {
  await fs.rm(scratchRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
}
