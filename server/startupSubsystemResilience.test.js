import { describe, expect, it, vi } from 'vitest'
import { createApp } from './index.js'

describe('optional startup subsystem resilience', () => {
  it('retries upload setup, isolates optional failures, and recovers only degraded subsystems', async () => {
    let optionalSubsystemsFail = true
    const uploadVault = vi.fn(async () => {
      if (uploadVault.mock.calls.length < 3) {
        throw Object.assign(new Error('temporary upload vault outage'), {
          code: 'UPLOAD_VAULT_TEMPORARILY_UNAVAILABLE',
        })
      }
    })
    const webPush = vi.fn(async () => {
      if (optionalSubsystemsFail) {
        throw Object.assign(new Error('web push is unavailable'), {
          code: 'WEB_PUSH_CONFIGURATION_FAILED',
        })
      }
    })
    const browserPushJournal = vi.fn(async () => {
      if (optionalSubsystemsFail) {
        throw Object.assign(new Error('browser push journal is unavailable'), {
          code: 'BROWSER_PUSH_JOURNAL_FAILED',
        })
      }
    })
    const app = createApp({
      testHooks: {
        startupSubsystems: {
          uploadVault,
          webPush,
          browserPushJournal,
        },
      },
    })
    const startupStore = { settings: {} }
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      await expect(app.locals.initializeStartupSubsystems(startupStore)).resolves.toMatchObject({
        uploadVault: {
          status: 'ready',
          attempts: 3,
          errorCode: null,
          updatedAt: expect.any(String),
        },
        webPush: {
          status: 'degraded',
          attempts: 1,
          errorCode: 'WEB_PUSH_CONFIGURATION_FAILED',
          updatedAt: expect.any(String),
        },
        browserPushJournal: {
          status: 'degraded',
          attempts: 1,
          errorCode: 'BROWSER_PUSH_JOURNAL_FAILED',
          updatedAt: expect.any(String),
        },
      })

      expect(uploadVault).toHaveBeenCalledTimes(3)
      expect(webPush).toHaveBeenCalledTimes(1)
      expect(browserPushJournal).toHaveBeenCalledTimes(1)
      expect(app.locals.startupState).toMatchObject({
        status: 'ready',
        errorCode: null,
      })
      expect(app.locals.startupSubsystems()).toMatchObject({
        uploadVault: { status: 'ready', attempts: 3 },
        webPush: { status: 'degraded', attempts: 1 },
        browserPushJournal: { status: 'degraded', attempts: 1 },
      })
      expect(app.locals.runtimeResilienceSnapshot(startupStore)).toMatchObject({
        startupSubsystems: {
          uploadVault: { status: 'ready', attempts: 3, errorCode: null },
          webPush: {
            status: 'degraded',
            attempts: 1,
            errorCode: 'WEB_PUSH_CONFIGURATION_FAILED',
          },
          browserPushJournal: {
            status: 'degraded',
            attempts: 1,
            errorCode: 'BROWSER_PUSH_JOURNAL_FAILED',
          },
        },
      })

      optionalSubsystemsFail = false
      await expect(app.locals.initializeStartupSubsystems(startupStore, {
        degradedOnly: true,
      })).resolves.toMatchObject({
        uploadVault: { status: 'ready', attempts: 3, errorCode: null },
        webPush: { status: 'ready', attempts: 2, errorCode: null },
        browserPushJournal: { status: 'ready', attempts: 2, errorCode: null },
      })

      expect(uploadVault).toHaveBeenCalledTimes(3)
      expect(webPush).toHaveBeenCalledTimes(2)
      expect(browserPushJournal).toHaveBeenCalledTimes(2)
      expect(app.locals.startupState).toMatchObject({
        status: 'ready',
        errorCode: null,
      })
      expect(app.locals.startupSubsystems()).toMatchObject({
        uploadVault: { status: 'ready', attempts: 3, errorCode: null },
        webPush: { status: 'ready', attempts: 2, errorCode: null },
        browserPushJournal: { status: 'ready', attempts: 2, errorCode: null },
      })
      expect(app.locals.runtimeResilienceSnapshot(startupStore)).toMatchObject({
        startupSubsystems: {
          uploadVault: { status: 'ready', attempts: 3, errorCode: null },
          webPush: { status: 'ready', attempts: 2, errorCode: null },
          browserPushJournal: { status: 'ready', attempts: 2, errorCode: null },
        },
      })

      const recoveryStop = vi.spyOn(app.locals.startupRecovery, 'stop')
      const taskStops = app.locals.recurringTasks.map(({ task }) => vi.spyOn(task, 'stop'))
      await app.locals.stopRecurringTasks()
      expect(recoveryStop).toHaveBeenCalledOnce()
      for (const taskStop of taskStops) expect(taskStop).toHaveBeenCalledOnce()
    } finally {
      logError.mockRestore()
      await app.locals.stopRecurringTasks()
    }
  })

  it('times out a hung attempt, stays core-ready, and ignores its late settlement after recovery', async () => {
    const previousTimeout = process.env.STARTUP_SUBSYSTEM_ATTEMPT_TIMEOUT_MS
    process.env.STARTUP_SUBSYSTEM_ATTEMPT_TIMEOUT_MS = '20'
    let firstResolve
    let firstSignal
    let shouldHang = true
    const webPush = vi.fn(async (_store, { signal }) => {
      if (!shouldHang) return
      firstSignal = signal
      await new Promise((resolve) => { firstResolve = resolve })
    })
    const app = createApp({
      testHooks: {
        startupSubsystems: {
          uploadVault: vi.fn(async () => {}),
          webPush,
          browserPushJournal: vi.fn(async () => {}),
        },
      },
    })
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      await expect(app.locals.initializeStartupSubsystems({ settings: {} })).resolves.toMatchObject({
        uploadVault: { status: 'ready' },
        webPush: {
          status: 'degraded',
          attempts: 1,
          errorCode: 'STARTUP_SUBSYSTEM_TIMEOUT',
        },
        browserPushJournal: { status: 'ready' },
      })
      expect(firstSignal?.aborted).toBe(true)
      expect(app.locals.startupState).toMatchObject({ status: 'ready' })

      shouldHang = false
      await expect(app.locals.initializeStartupSubsystems({ settings: {} }, {
        degradedOnly: true,
      })).resolves.toMatchObject({
        webPush: { status: 'ready', attempts: 2, errorCode: null },
      })

      firstResolve()
      await Promise.resolve()
      expect(app.locals.startupSubsystems()).toMatchObject({
        webPush: { status: 'ready', attempts: 2, errorCode: null },
      })
    } finally {
      logError.mockRestore()
      await app.locals.stopRecurringTasks()
      if (previousTimeout === undefined) delete process.env.STARTUP_SUBSYSTEM_ATTEMPT_TIMEOUT_MS
      else process.env.STARTUP_SUBSYSTEM_ATTEMPT_TIMEOUT_MS = previousTimeout
    }
  })
})
