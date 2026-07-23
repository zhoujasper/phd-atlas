import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  claimPendingUpdateBoot,
  isUpdateLockAbandoned,
  readUpdateLockState,
  recoverAbandonedPendingUpdateBoot,
  recoverAbandonedUpdateLock,
  releasePendingUpdateBootClaim,
  replayActiveUpdateIfNeeded,
} from '../server/systemUpdate.js'

export const UPDATE_RESTART_EXIT_CODE = 75

const __filename = fileURLToPath(import.meta.url)
const defaultProjectRoot = path.resolve(
  process.env.PHD_ATLAS_PROJECT_ROOT
    ?? path.resolve(path.dirname(__filename), '..'),
)
export const CONTAINER_IMAGE_RUNTIME_MANIFEST_PATH = '/usr/local/share/phd-atlas/runtime-manifest.json'
const DEFAULT_UPDATE_WAIT_MS = 15 * 60_000
const DEFAULT_UPDATE_POLL_MS = 250
const RAPID_EXIT_WINDOW_MS = 30_000
const MAX_RESTART_DELAY_MS = 30_000

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function sha256File(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

async function collectRuntimeFiles(projectRoot) {
  const paths = []
  const visit = async (relativeRoot) => {
    const absoluteRoot = path.join(projectRoot, ...relativeRoot.split('/'))
    for (const entry of await fs.readdir(absoluteRoot, { withFileTypes: true })) {
      const relativePath = `${relativeRoot}/${entry.name}`
      if (entry.isDirectory()) {
        await visit(relativePath)
      } else if (entry.isFile()) {
        paths.push(relativePath)
      } else {
        throw new Error(`Container runtime contains an unsupported entry: ${relativePath}`)
      }
    }
  }
  for (const root of ['dist', 'server', 'tools']) await visit(root)
  paths.push('package.json', 'package-lock.json')
  const files = []
  for (const relativePath of paths.sort((left, right) => left.localeCompare(right))) {
    const filePath = path.join(projectRoot, ...relativePath.split('/'))
    const stat = await fs.stat(filePath)
    files.push({
      path: relativePath,
      size: stat.size,
      sha256: await sha256File(filePath),
    })
  }
  return files
}

function runtimeFingerprint(files) {
  const hash = createHash('sha256')
  for (const file of files) hash.update(`${file.path}\0${file.sha256}\0${file.size}\n`)
  return hash.digest('hex')
}

export async function createImageRuntimeManifest(projectRoot, manifestPath = CONTAINER_IMAGE_RUNTIME_MANIFEST_PATH) {
  const currentPackage = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'))
  const files = await collectRuntimeFiles(projectRoot)
  const manifest = {
    formatVersion: 1,
    appId: 'phd-atlas-container-runtime',
    version: currentPackage.version,
    contentSha256: runtimeFingerprint(files),
    files,
  }
  await fs.mkdir(path.dirname(manifestPath), { recursive: true })
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return manifest
}

export async function readContainerImageRuntime(projectRoot, manifestPath = CONTAINER_IMAGE_RUNTIME_MANIFEST_PATH) {
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    if (
      manifest?.formatVersion !== 1
      || manifest?.appId !== 'phd-atlas-container-runtime'
      || typeof manifest?.version !== 'string'
      || !Array.isArray(manifest?.files)
      || runtimeFingerprint(manifest.files) !== manifest.contentSha256
    ) {
      throw new Error('The immutable container runtime manifest is invalid.')
    }
    return { version: manifest.version, manifest }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const currentPackage = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'))
  return { version: currentPackage.version, manifest: null }
}

export async function verifyImageRuntime(projectRoot, imageRuntime) {
  if (!imageRuntime?.manifest) return false
  try {
    const currentPackage = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'))
    if (currentPackage.version !== imageRuntime.version) return false
    const currentFiles = await collectRuntimeFiles(projectRoot)
    return runtimeFingerprint(currentFiles) === imageRuntime.manifest.contentSha256
      && JSON.stringify(currentFiles) === JSON.stringify(imageRuntime.manifest.files)
  } catch {
    return false
  }
}

export function restartDelayMs(rapidRestartCount) {
  return Math.min(1_000 * (2 ** Math.max(0, rapidRestartCount - 1)), MAX_RESTART_DELAY_MS)
}

export async function waitForUpdateCompletion(storageRoot, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_UPDATE_WAIT_MS
  const pollMs = options.pollMs ?? DEFAULT_UPDATE_POLL_MS
  const sleep = options.sleep ?? delay
  const deadline = Date.now() + timeoutMs
  while (true) {
    const lock = await readUpdateLockState(storageRoot)
    if (!lock) return
    if (await isUpdateLockAbandoned(lock, {
      processExists: options.processExists,
      claimGraceMs: options.claimGraceMs,
      now: options.now,
    })) {
      if (!options.recoverAbandonedLock) {
        throw Object.assign(new Error('The update helper exited without clearing its lock.'), {
          code: 'UPDATE_LOCK_ABANDONED',
        })
      }
      await options.recoverAbandonedLock(lock)
      continue
    }
    if (Date.now() >= deadline) {
      throw Object.assign(new Error(`Update lock did not clear within ${timeoutMs}ms.`), {
        code: 'UPDATE_LOCK_TIMEOUT',
      })
    }
    await sleep(pollMs)
  }
}

export function installProductionDependencies(cwd, options = {}) {
  const spawnProcess = options.spawnProcess ?? spawn
  return new Promise((resolve, reject) => {
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const child = spawnProcess(npmCommand, ['ci', '--omit=dev', '--no-audit', '--no-fund'], {
      cwd,
      env: process.env,
      windowsHide: true,
      stdio: 'inherit',
    })
    let settled = false
    child.once('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    child.once('exit', (code, signal) => {
      if (settled) return
      settled = true
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`npm ci failed with ${signal ? `signal ${signal}` : `exit code ${code}`}.`))
    })
  })
}

function waitForWorker(child) {
  return new Promise((resolve) => {
    let settled = false
    child.once('error', (error) => {
      if (settled) return
      settled = true
      resolve({ code: 1, signal: null, error })
    })
    child.once('exit', (code, signal) => {
      if (settled) return
      settled = true
      resolve({ code, signal, error: null })
    })
  })
}

export async function runContainerSupervisor(options = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? defaultProjectRoot)
  const storageRoot = path.resolve(options.storageRoot ?? path.join(projectRoot, 'storage'))
  const logger = options.logger ?? console
  const processRef = options.processRef ?? process
  const sleep = options.sleep ?? delay
  const now = options.now ?? Date.now
  const installDependencies = options.installDependencies
    ?? ((cwd) => installProductionDependencies(cwd))
  const processExists = options.processExists
  const recoverPendingRuntime = options.recoverPendingRuntime
    ?? (() => recoverAbandonedPendingUpdateBoot({
      projectRoot,
      storageRoot,
      installDependencies,
      processExists,
    }))
  const claimPendingBoot = options.claimPendingBoot
    ?? ((processId) => claimPendingUpdateBoot(storageRoot, processId, { processExists }))
  const releasePendingBoot = options.releasePendingBoot
    ?? ((processId) => releasePendingUpdateBootClaim(storageRoot, processId))
  const recoverStaleLock = options.recoverStaleLock
    ?? (() => recoverAbandonedUpdateLock({
      projectRoot,
      storageRoot,
      installDependencies,
      processExists,
    }))
  const waitForUpdate = options.waitForUpdate ?? ((root) => waitForUpdateCompletion(root, {
    processExists,
    recoverAbandonedLock: recoverStaleLock,
  }))
  const imageRuntime = options.imageRuntime ?? await readContainerImageRuntime(
    projectRoot,
    options.imageRuntimeManifestPath,
  )
  const baseVersion = options.baseVersion ?? imageRuntime.version
  const prepareRuntime = options.prepareRuntime ?? (async () => {
    await recoverPendingRuntime()
    const baseRuntimeVerified = options.baseRuntimeVerified !== undefined
      ? options.baseRuntimeVerified
      : await verifyImageRuntime(projectRoot, imageRuntime)
    return replayActiveUpdateIfNeeded({
      projectRoot,
      storageRoot,
      baseVersion,
      baseRuntimeVerified,
      requireVerifiedBase: Boolean(imageRuntime.manifest),
      installDependencies,
    })
  })
  const spawnWorker = options.spawnWorker ?? (() => spawn(process.execPath, [
    path.join(projectRoot, 'tools', 'start-server.mjs'),
  ], {
    cwd: projectRoot,
    env: process.env,
    windowsHide: true,
    stdio: 'inherit',
  }))

  let currentWorker = null
  let stopping = false
  let rapidRestartCount = 0
  const forwardSignal = (signal) => {
    if (stopping) return
    stopping = true
    if (currentWorker && currentWorker.exitCode === null && currentWorker.signalCode === null) {
      currentWorker.kill(signal)
    }
  }
  const onSigint = () => forwardSignal('SIGINT')
  const onSigterm = () => forwardSignal('SIGTERM')
  processRef.on('SIGINT', onSigint)
  processRef.on('SIGTERM', onSigterm)

  try {
    while (!stopping) {
      try {
        await waitForUpdate(storageRoot)
        await prepareRuntime()
      } catch (error) {
        const retryDelay = restartDelayMs(++rapidRestartCount)
        logger.error(`[container-entrypoint] Runtime preparation failed; retrying in ${retryDelay}ms.`, error)
        await sleep(retryDelay)
        continue
      }
      if (stopping) break

      const startedAt = now()
      try {
        currentWorker = spawnWorker()
      } catch (error) {
        logger.error('[container-entrypoint] Failed to start the server worker.', error)
        return 1
      }
      const worker = currentWorker
      const outcomePromise = waitForWorker(worker)
      try {
        if (Number.isSafeInteger(worker.pid) && worker.pid > 0) {
          await claimPendingBoot(worker.pid)
        }
      } catch (error) {
        logger.error('[container-entrypoint] Failed to claim the pending update boot for the server worker.', error)
        if (worker.exitCode === null && worker.signalCode === null) worker.kill('SIGTERM')
        await outcomePromise
        return 1
      }
      const outcome = await outcomePromise
      currentWorker = null
      if (stopping) {
        if (Number.isSafeInteger(worker.pid) && worker.pid > 0) {
          await releasePendingBoot(worker.pid).catch((error) => {
            logger.error('[container-entrypoint] Failed to release the pending boot claim during shutdown.', error)
          })
        }
        return 0
      }
      if (outcome.error) {
        logger.error('[container-entrypoint] Server worker emitted an error.', outcome.error)
      }
      if (outcome.code !== UPDATE_RESTART_EXIT_CODE) {
        try {
          const recovery = await recoverPendingRuntime()
          if (recovery?.rolledBack) {
            const retryDelay = restartDelayMs(++rapidRestartCount)
            logger.error(
              `[container-entrypoint] The updated runtime failed before boot confirmation; restored ${recovery.version} and retrying in ${retryDelay}ms.`,
            )
            await sleep(retryDelay)
            continue
          }
        } catch (recoveryError) {
          logger.error('[container-entrypoint] Server startup failed and automatic update rollback could not complete.', recoveryError)
          return 1
        }
        logger.error(`[container-entrypoint] Server worker stopped with ${outcome.signal ? `signal ${outcome.signal}` : `exit code ${outcome.code}`}.`)
        return Number.isInteger(outcome.code) ? outcome.code : 1
      }

      // The worker deliberately exits while its detached update helper keeps
      // running. Remaining alive here keeps the container up and, critically,
      // does not signal or reap that helper before it replaces the runtime.
      const uptimeMs = Math.max(0, now() - startedAt)
      rapidRestartCount = uptimeMs >= RAPID_EXIT_WINDOW_MS ? 0 : rapidRestartCount + 1
      try {
        await waitForUpdate(storageRoot)
      } catch (error) {
        logger.error('[container-entrypoint] Update helper did not finish cleanly; runtime preparation will remain fail-closed.', error)
      }
      const retryDelay = restartDelayMs(rapidRestartCount)
      logger.info(`[container-entrypoint] Update restart requested; restarting the server worker in ${retryDelay}ms.`)
      await sleep(retryDelay)
    }
    return 0
  } finally {
    processRef.off('SIGINT', onSigint)
    processRef.off('SIGTERM', onSigterm)
    if (currentWorker && currentWorker.exitCode === null && currentWorker.signalCode === null) {
      currentWorker.kill('SIGTERM')
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  if (process.argv[2] === '--write-image-manifest') {
    const manifestPath = path.resolve(process.argv[3] ?? CONTAINER_IMAGE_RUNTIME_MANIFEST_PATH)
    await createImageRuntimeManifest(defaultProjectRoot, manifestPath)
  } else {
    const exitCode = await runContainerSupervisor()
    process.exitCode = exitCode
  }
}
