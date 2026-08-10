import type { SystemUpdateStatus } from '../api/phdApi'
import { reloadPage } from '../pageReload'
import { prepareForSafeReload } from '../safeReload'

type WaitForInstalledVersionOptions = {
  expectedVersion: string
  readStatus: () => Promise<SystemUpdateStatus>
  onStatus?: (status: SystemUpdateStatus) => void
  timeoutMs?: number
  intervalMs?: number
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds))
}

export async function waitForInstalledVersion({
  expectedVersion,
  readStatus,
  onStatus,
  timeoutMs = 20 * 60_000,
  intervalMs = 1_200,
}: WaitForInstalledVersionOptions) {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown = null
  while (Date.now() < deadline) {
    try {
      const status = await readStatus()
      lastError = null
      onStatus?.(status)
      if (status.currentVersion === expectedVersion && !status.restartPending) return status
      if (status.phase === 'error') {
        const error = new Error(status.errorMessage || status.errorCode || 'System update failed.')
        Object.assign(error, { code: status.errorCode || 'UPDATE_FAILED', fatalUpdateStatus: true })
        throw error
      }
    } catch (error) {
      lastError = error
      if ((error as { fatalUpdateStatus?: boolean })?.fatalUpdateStatus) throw error
      // A brief connection failure is expected while the server restarts.
    }
    await delay(intervalMs)
  }
  const timeout = new Error('Timed out waiting for the updated server to become ready.')
  Object.assign(timeout, {
    code: 'UPDATE_RESTART_TIMEOUT',
    cause: lastError,
  })
  throw timeout
}

export async function reloadInstalledApplication() {
  const allowed = await prepareForSafeReload({ reason: 'application-update' })
  if (!allowed) return false
  reloadPage()
  return true
}
