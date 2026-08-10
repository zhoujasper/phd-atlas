export const SAFE_RELOAD_BLOCKED_EVENT = 'phd-atlas:safe-reload-blocked'
export const SAFE_RELOAD_FLUSH_EVENT = 'phd-atlas:safe-reload-flush'

export type SafeReloadReason =
  | 'identity-change'
  | 'remote-logout'
  | 'lazy-module'
  | 'application-update'
  | 'error-recovery'

export type SafeReloadBlockedCause =
  | 'prepare-failed'
  | 'resident-dirty'
  | 'beforeunload'
  | 'recovery-storage-unavailable'

export type SafeReloadBlockedDetail = {
  reason: SafeReloadReason
  cause: SafeReloadBlockedCause
}

export type SafeReloadGuard = {
  /** Flush and verify recoverable state. False means navigation must stop. */
  prepare?: () => boolean | Promise<boolean>
  /** True means the user must explicitly save/discard before an automatic reload. */
  hasUnsavedChanges?: () => boolean
}

const guards = new Map<string, SafeReloadGuard>()
let preparationInFlight: Promise<boolean> | null = null
let guardRegistryGeneration = 0

const MAX_STABILIZATION_PASSES = 6

export function registerSafeReloadGuard(id: string, guard: SafeReloadGuard) {
  guards.set(id, guard)
  guardRegistryGeneration += 1
  return () => {
    if (guards.get(id) !== guard) return
    guards.delete(id)
    guardRegistryGeneration += 1
  }
}

export function dispatchSafeReloadBlocked(
  reason: SafeReloadReason,
  cause: SafeReloadBlockedCause,
  target: Window = window,
) {
  target.dispatchEvent(new CustomEvent<SafeReloadBlockedDetail>(SAFE_RELOAD_BLOCKED_EVENT, {
    detail: { reason, cause },
  }))
}

/**
 * Performs every application-owned flush before consulting dirty guards. The
 * synthetic beforeunload event lets resident editors participate without
 * changing browser navigation semantics, and pagehide is emitted only after
 * every guard has allowed the reload.
 */
export function prepareForSafeReload({
  reason,
  target = window,
}: {
  reason: SafeReloadReason
  target?: Window
}) {
  if (preparationInFlight) return preparationInFlight

  const task = (async () => {
    for (let pass = 0; pass < MAX_STABILIZATION_PASSES; pass += 1) {
      // Resident editors keep their keystroke path deliberately buffered. Give
      // them a synchronous application-owned flush boundary before guards are
      // snapshotted so the following checks observe the last keypress too.
      target.dispatchEvent(new Event(SAFE_RELOAD_FLUSH_EVENT))
      await Promise.resolve()

      const generation = guardRegistryGeneration
      const snapshot = [...guards.values()]
      const preparations = await Promise.allSettled(snapshot.map(async (guard) => (
        guard.prepare ? await guard.prepare() : true
      )))
      if (preparations.some((result) => result.status === 'rejected' || result.value !== true)) {
        dispatchSafeReloadBlocked(reason, 'prepare-failed', target)
        return false
      }

      // Give React-controlled save callbacks one microtask to publish their
      // state. A guard mounted or replaced during preparation must itself pass
      // preparation, so restart from the flush boundary with a fresh snapshot.
      await Promise.resolve()
      if (guardRegistryGeneration !== generation) continue

      let residentDirty = false
      try {
        residentDirty = snapshot.some((guard) => guard.hasUnsavedChanges?.() === true)
      } catch {
        dispatchSafeReloadBlocked(reason, 'prepare-failed', target)
        return false
      }
      if (guardRegistryGeneration !== generation) continue
      if (residentDirty) {
        dispatchSafeReloadBlocked(reason, 'resident-dirty', target)
        return false
      }

      const beforeUnload = new Event('beforeunload', { cancelable: true })
      target.dispatchEvent(beforeUnload)
      await Promise.resolve()
      if (beforeUnload.defaultPrevented) {
        dispatchSafeReloadBlocked(reason, 'beforeunload', target)
        return false
      }

      // beforeunload is also an editor flush boundary. Re-snapshot and re-read
      // every guard after it: a synchronous flush may have made an existing
      // guard dirty, and a listener may have mounted a new resident editor.
      if (guardRegistryGeneration !== generation) continue
      const finalSnapshot = [...guards.values()]
      let finalDirty = false
      try {
        finalDirty = finalSnapshot.some((guard) => guard.hasUnsavedChanges?.() === true)
      } catch {
        dispatchSafeReloadBlocked(reason, 'prepare-failed', target)
        return false
      }
      if (guardRegistryGeneration !== generation) continue
      if (finalDirty) {
        dispatchSafeReloadBlocked(reason, 'resident-dirty', target)
        return false
      }

      target.dispatchEvent(new Event('pagehide'))
      return true
    }

    // A continuously changing resident registry never reaches a trustworthy
    // fixed point. Automatic reload must stop instead of guessing which state
    // was durable.
    dispatchSafeReloadBlocked(reason, 'prepare-failed', target)
    return false
  })()

  preparationInFlight = task
  void task.finally(() => {
    if (preparationInFlight === task) preparationInFlight = null
  })
  return task
}
