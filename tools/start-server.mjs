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

const __filename = fileURLToPath(import.meta.url)

export async function runServerWorker() {
  const envFile = resolve(process.cwd(), '.env')
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile)
  }

  const projectRoot = process.cwd()
  const storageRoot = resolve(projectRoot, 'storage')
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
  await recoverPendingBoot()
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
        .catch((error) => console.error('[system-update] Failed to confirm the updated runtime boot:', error))
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
