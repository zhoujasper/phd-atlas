import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  claimPendingUpdateBoot,
  confirmPendingUpdateBoot,
  recoverAbandonedPendingUpdateBoot,
  recoverAbandonedUpdateLock,
  releasePendingUpdateBootClaim,
  replayActiveUpdateIfNeeded,
} from '../server/systemUpdate.js'
import {
  installProductionDependencies,
  waitForUpdateCompletion,
} from './container-entrypoint.mjs'
import {
  appendSystemUpdateLog,
  patchSystemUpdateStatus,
} from '../server/systemUpdateJournal.js'

const __filename = fileURLToPath(import.meta.url)

export async function runServerWorker() {
  const envFile = resolve(process.cwd(), '.env')
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile)
  }

  const projectRoot = process.cwd()
  const storageRoot = process.env.PHD_ATLAS_STORAGE_ROOT
    ? resolve(process.env.PHD_ATLAS_STORAGE_ROOT)
    : resolve(projectRoot, 'storage')
  const installDependencies = (cwd) => installProductionDependencies(cwd)
  const recoverPendingBoot = () => recoverAbandonedPendingUpdateBoot({
    projectRoot,
    storageRoot,
    installDependencies,
    currentProcessId: process.pid,
  })
  const recoverStaleLock = () => recoverAbandonedUpdateLock({
    projectRoot,
    storageRoot,
    installDependencies,
  })

  await waitForUpdateCompletion(storageRoot, {
    recoverAbandonedLock: recoverStaleLock,
  })
  const bootRecovery = await recoverPendingBoot()
  if (bootRecovery?.rolledBack) {
    await patchSystemUpdateStatus(storageRoot, {
      phase: 'error',
      operationInFlight: false,
      restartPending: false,
      targetVersion: bootRecovery.result?.toVersion ?? bootRecovery.marker?.toVersion ?? null,
      errorCode: 'UPDATE_BOOT_ROLLED_BACK',
      errorMessage: `The updated server did not complete its first boot; ${bootRecovery.version} was restored.`,
    }).catch(() => undefined)
    await appendSystemUpdateLog(storageRoot, {
      level: 'error',
      phase: 'error',
      errorCode: 'UPDATE_BOOT_ROLLED_BACK',
      message: `The updated server did not complete its first boot; restored ${bootRecovery.version}.`,
    }).catch(() => undefined)
  }
  await replayActiveUpdateIfNeeded({
    projectRoot,
    storageRoot,
    installDependencies,
  })
  const pendingBoot = await claimPendingUpdateBoot(storageRoot, process.pid)

  const { startServer } = await import('../server/index.js')
  const { shutdownStorage } = await import('../server/storage.js')

  const server = await startServer()
  const bootConfirmationDelay = Math.max(
    1_000,
    Number.parseInt(process.env.PHD_ATLAS_UPDATE_BOOT_CONFIRM_MS ?? '30000', 10) || 30_000,
  )
  const bootConfirmationTimer = pendingBoot
    ? setTimeout(() => {
      void confirmPendingUpdateBoot(storageRoot, process.pid)
        .then(() => Promise.all([
          patchSystemUpdateStatus(storageRoot, {
            phase: 'ready',
            operationInFlight: false,
            restartPending: false,
            errorCode: null,
            errorMessage: null,
          }),
          appendSystemUpdateLog(storageRoot, {
            phase: 'ready',
            message: 'The updated runtime completed its first-boot confirmation window.',
          }),
        ]))
        .catch(async (error) => {
          console.error('[system-update] Failed to confirm the updated runtime boot:', error)
          await appendSystemUpdateLog(storageRoot, {
            level: 'error',
            phase: 'restarting',
            errorCode: error?.code ?? 'UPDATE_BOOT_CONFIRM_FAILED',
            message: error instanceof Error ? error.message : String(error),
          }).catch(() => undefined)
        })
    }, bootConfirmationDelay)
    : null
  bootConfirmationTimer?.unref?.()
  let shuttingDown = false
  const shutdown = () => {
    if (shuttingDown) return
    shuttingDown = true
    if (bootConfirmationTimer) clearTimeout(bootConfirmationTimer)
    void releasePendingUpdateBootClaim(storageRoot, process.pid)
      .catch((error) => console.error('[system-update] Failed to release the pending boot claim:', error))
      .finally(() => {
        server.close(() => {
          void shutdownStorage()
            .catch((error) => console.error('[storage] Graceful shutdown flush failed:', error))
            .finally(() => process.exit(0))
        })
      })
  }

  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  return server
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  await runServerWorker()
}
