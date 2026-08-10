import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  prepareForSafeReload,
  registerSafeReloadGuard,
  SAFE_RELOAD_BLOCKED_EVENT,
  SAFE_RELOAD_FLUSH_EVENT,
} from './safeReload'

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

describe('safe reload coordination', () => {
  it('blocks when a recovery flush cannot be verified', async () => {
    const blocked = vi.fn()
    window.addEventListener(SAFE_RELOAD_BLOCKED_EVENT, blocked)
    cleanups.push(() => window.removeEventListener(SAFE_RELOAD_BLOCKED_EVENT, blocked))
    cleanups.push(registerSafeReloadGuard('failed-recovery', { prepare: () => false }))

    await expect(prepareForSafeReload({ reason: 'lazy-module' })).resolves.toBe(false)
    expect(blocked).toHaveBeenCalledTimes(1)
  })

  it('flushes first and then honours a resident beforeunload guard', async () => {
    const order: string[] = []
    const pageHide = () => order.push('pagehide')
    const beforeUnload = (event: Event) => {
      order.push('beforeunload')
      event.preventDefault()
    }
    window.addEventListener('pagehide', pageHide)
    window.addEventListener('beforeunload', beforeUnload)
    cleanups.push(() => window.removeEventListener('pagehide', pageHide))
    cleanups.push(() => window.removeEventListener('beforeunload', beforeUnload))
    cleanups.push(registerSafeReloadGuard('flush', {
      prepare: () => {
        order.push('prepare')
        return true
      },
    }))

    await expect(prepareForSafeReload({ reason: 'identity-change' })).resolves.toBe(false)
    expect(order).toEqual(['prepare', 'beforeunload'])
  })

  it('emits pagehide only after every guard allows navigation', async () => {
    const pageHide = vi.fn()
    window.addEventListener('pagehide', pageHide)
    cleanups.push(() => window.removeEventListener('pagehide', pageHide))
    cleanups.push(registerSafeReloadGuard('verified', { prepare: async () => true }))

    await expect(prepareForSafeReload({ reason: 'application-update' })).resolves.toBe(true)
    expect(pageHide).toHaveBeenCalledTimes(1)
  })

  it('flushes resident input before preparing and checking dirty state', async () => {
    let dirty = false
    const order: string[] = []
    const flush = () => {
      order.push('flush')
      dirty = true
    }
    window.addEventListener(SAFE_RELOAD_FLUSH_EVENT, flush)
    cleanups.push(() => window.removeEventListener(SAFE_RELOAD_FLUSH_EVENT, flush))
    cleanups.push(registerSafeReloadGuard('buffered-editor', {
      prepare: () => {
        order.push('prepare')
        return true
      },
      hasUnsavedChanges: () => dirty,
    }))

    await expect(prepareForSafeReload({ reason: 'application-update' })).resolves.toBe(false)
    expect(order).toEqual(['flush', 'prepare'])
  })

  it('prepares a guard that mounts while another guard is preparing', async () => {
    let releasePreparation: (() => void) | undefined
    const firstPreparation = new Promise<void>((resolve) => {
      releasePreparation = resolve
    })
    const latePrepare = vi.fn(() => false)
    cleanups.push(registerSafeReloadGuard('initial-editor', {
      prepare: () => firstPreparation.then(() => true),
    }))

    const result = prepareForSafeReload({ reason: 'identity-change' })
    await Promise.resolve()
    cleanups.push(registerSafeReloadGuard('late-editor', { prepare: latePrepare }))
    releasePreparation?.()

    await expect(result).resolves.toBe(false)
    expect(latePrepare).toHaveBeenCalledTimes(1)
  })

  it('rechecks an existing guard after beforeunload flushes it dirty', async () => {
    let dirty = false
    const pageHide = vi.fn()
    const markDirty = () => {
      dirty = true
    }
    window.addEventListener('beforeunload', markDirty)
    window.addEventListener('pagehide', pageHide)
    cleanups.push(() => window.removeEventListener('beforeunload', markDirty))
    cleanups.push(() => window.removeEventListener('pagehide', pageHide))
    cleanups.push(registerSafeReloadGuard('late-dirty-editor', {
      prepare: () => true,
      hasUnsavedChanges: () => dirty,
    }))

    await expect(prepareForSafeReload({ reason: 'lazy-module' })).resolves.toBe(false)
    expect(pageHide).not.toHaveBeenCalled()
  })

  it('fails closed when the resident guard registry never stabilizes', async () => {
    cleanups.push(registerSafeReloadGuard('churning-editor', {
      prepare: () => {
        const unregister = registerSafeReloadGuard('transient-editor', {})
        unregister()
        return true
      },
    }))

    await expect(prepareForSafeReload({ reason: 'error-recovery' })).resolves.toBe(false)
  })
})
