import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runProductionDependencyInstall } from '../server/dependencyInstall.js'
import {
  applyUpdatePackage,
  claimUpdateLock,
  clearUpdateLock,
  releaseUpdateHelperClaim,
  requireUpdateSafeShutdownMarker,
} from '../server/systemUpdate.js'
import {
  appendSystemUpdateLog,
  flushSystemUpdateJournal,
  patchSystemUpdateStatus,
} from '../server/systemUpdateJournal.js'

const __filename = fileURLToPath(import.meta.url)
const projectRoot = path.resolve(path.dirname(__filename), '..')
const storageRoot = process.env.PHD_ATLAS_STORAGE_ROOT
  ? path.resolve(process.env.PHD_ATLAS_STORAGE_ROOT)
  : path.join(projectRoot, 'storage')
const args = new Map()
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1])
}
const packagePath = path.resolve(args.get('--package') ?? '')
const previousPid = Number(args.get('--pid') ?? 0)
// The old worker can spend 20 seconds draining and 40 seconds in its primary
// durability-recovery window. Abort before either the 70-second inner or
// 75-second outer forced-kill boundary: PID disappearance is accepted only
// together with the launcher's matching durable safe-shutdown marker.
export const PREVIOUS_PROCESS_WAIT_TIMEOUT_MS = 65_000
const PREVIOUS_PROCESS_POLL_MS = 250

async function processExists(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function waitForPreviousProcess(
  pid = previousPid,
  options = {},
) {
  const now = options.now ?? Date.now
  const processExistsOperation = options.processExists ?? processExists
  const sleep = options.sleep ?? ((delayMs) => new Promise((resolveSleep) => {
    setTimeout(resolveSleep, delayMs)
  }))
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    && Number(options.timeoutMs) > 0
    ? Number(options.timeoutMs)
    : PREVIOUS_PROCESS_WAIT_TIMEOUT_MS
  const pollMs = Number.isFinite(Number(options.pollMs)) && Number(options.pollMs) > 0
    ? Number(options.pollMs)
    : PREVIOUS_PROCESS_POLL_MS
  const deadline = now() + timeoutMs
  while (await processExistsOperation(pid)) {
    const remainingMs = deadline - now()
    if (remainingMs <= 0) {
      const error = new Error('The previous server process did not stop in time.')
      error.code = 'UPDATE_PREVIOUS_PROCESS_TIMEOUT'
      throw error
    }
    await sleep(Math.min(pollMs, remainingMs))
  }
}

let dependencyInstallAttempt = 0
let activeJobId = null

async function installDependencies(cwd) {
  dependencyInstallAttempt += 1
  const attempt = dependencyInstallAttempt
  await patchSystemUpdateStatus(storageRoot, {
    phase: 'installing',
    operationInFlight: true,
    restartPending: true,
    errorCode: null,
    errorMessage: null,
  })
  await appendSystemUpdateLog(storageRoot, {
    jobId: activeJobId,
    phase: 'installing',
    message: attempt === 1
      ? 'Installing the complete server production dependency graph.'
      : 'Restoring the previous server production dependencies after an update failure.',
  })
  const result = await runProductionDependencyInstall(cwd, {
    storageRoot,
    onAttempt: ({ source, index, total }) => {
      void appendSystemUpdateLog(storageRoot, {
        jobId: activeJobId,
        phase: 'installing',
        message: `Dependency source ${index + 1}/${total}: ${source.label}.`,
      }).catch(() => undefined)
    },
    onAttemptFailure: ({ source, error }) => {
      void appendSystemUpdateLog(storageRoot, {
        jobId: activeJobId,
        level: 'warning',
        phase: 'installing',
        errorCode: error?.code ?? 'UPDATE_DEPENDENCY_INSTALL_FAILED',
        message: `Dependency source ${source.label} failed; trying the next verified source.`,
        detail: error?.message ?? String(error),
      }).catch(() => undefined)
    },
    onLine: ({ streamName, message }) => {
      void appendSystemUpdateLog(storageRoot, {
        jobId: activeJobId,
        level: streamName === 'stderr' ? 'warning' : 'info',
        phase: 'installing',
        message: `npm: ${message}`,
      }).catch(() => undefined)
    },
    onHeartbeat: ({ source, elapsedMs, idleMs }) => {
      void patchSystemUpdateStatus(storageRoot, {
        phase: 'installing',
        operationInFlight: true,
        restartPending: true,
      }).catch(() => undefined)
      void appendSystemUpdateLog(storageRoot, {
        jobId: activeJobId,
        phase: 'installing',
        message: `Dependency install via ${source.label} is active (${Math.round(elapsedMs / 1_000)}s elapsed, ${Math.round(idleMs / 1_000)}s since npm output).`,
      }).catch(() => undefined)
    },
  })
  await appendSystemUpdateLog(storageRoot, {
    jobId: activeJobId,
    phase: 'installing',
    message: attempt === 1
      ? `Server production dependencies installed via ${result.source.label}.`
      : `Previous server production dependencies restored via ${result.source.label}.`,
  })
}

export async function runApplyUpdateHelper() {
  let exitCode = 0
  let preserveUpdateLock = false
  let claimedLock = null
  try {
    claimedLock = await claimUpdateLock(storageRoot, {
      packagePath,
      helperPid: process.pid,
    })
    await fs.access(packagePath)
    await waitForPreviousProcess()
    await requireUpdateSafeShutdownMarker(storageRoot, claimedLock)
    const claimedStatus = await patchSystemUpdateStatus(storageRoot, {
      phase: 'preparing',
      operationInFlight: true,
      restartPending: true,
      errorCode: null,
      errorMessage: null,
    })
    activeJobId = claimedStatus.jobId ?? claimedLock.updateId
    await appendSystemUpdateLog(storageRoot, {
      jobId: activeJobId,
      phase: 'preparing',
      message: 'The detached helper claimed the update, the previous server stopped, and the verified runtime package is being applied.',
    })
    await applyUpdatePackage({
      packagePath,
      projectRoot,
      storageRoot,
      installDependencies,
    })
    await patchSystemUpdateStatus(storageRoot, {
      phase: 'restarting',
      operationInFlight: false,
      restartPending: true,
      errorCode: null,
      errorMessage: null,
    })
    await appendSystemUpdateLog(storageRoot, {
      jobId: activeJobId,
      phase: 'restarting',
      message: 'The update was applied and passed runtime preflight; the server supervisor can now start the new version.',
    })
  } catch (error) {
    exitCode = 1
    preserveUpdateLock = error?.code === 'UPDATE_ROLLBACK_FAILED'
      || error?.code === 'UPDATE_BOOT_ROLLBACK_FAILED'
    await patchSystemUpdateStatus(storageRoot, {
      phase: 'error',
      operationInFlight: false,
      restartPending: false,
      errorCode: error?.code ?? 'UPDATE_APPLY_FAILED',
      errorMessage: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined)
    await appendSystemUpdateLog(storageRoot, {
      jobId: activeJobId,
      level: 'error',
      phase: 'error',
      errorCode: error?.code ?? 'UPDATE_APPLY_FAILED',
      message: error instanceof Error ? error.message : String(error),
      detail: error?.updateDependencyOutput
        || error?.cause?.updateDependencyOutput
        || error?.stack
        || null,
    }).catch(() => undefined)
    await fs.appendFile(
      path.join(storageRoot, 'update-helper.log'),
      `${new Date().toISOString()} ${error?.stack ?? error}\n`,
      'utf8',
    ).catch(() => {})
  } finally {
    if (!preserveUpdateLock && claimedLock) {
      await clearUpdateLock(storageRoot, claimedLock).catch(() => {})
    }
    releaseUpdateHelperClaim(claimedLock)
    await flushSystemUpdateJournal(storageRoot).catch(() => undefined)
  }
  return exitCode
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  process.exit(await runApplyUpdateHelper())
}
