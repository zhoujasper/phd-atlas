import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './index.js'

const apps = []

function deferred() {
  let resolve
  const promise = new Promise((next) => { resolve = next })
  return { promise, resolve }
}

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for mail-sync worker state.')
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
}

function createTestApp(drain) {
  const app = createApp({
    testHooks: {
      drainPersistedMailSyncJobs: drain,
    },
  })
  apps.push(app)
  return app
}

afterEach(async () => {
  await Promise.allSettled(apps.splice(0).flatMap((app) => [
    app.locals.stopPersistedMailSyncWorker(),
    app.locals.stopRecurringTasks(),
  ]))
})

describe('persisted mail-sync worker integration', () => {
  it('coalesces one hundred concurrent wakes into one pending drain', async () => {
    const firstDrain = deferred()
    let drainCount = 0
    const drain = vi.fn(async () => {
      drainCount += 1
      if (drainCount === 1) await firstDrain.promise
    })
    const app = createTestApp(drain)
    const worker = app.locals.persistedMailSyncWorker

    const initialRun = worker.kick()
    await waitFor(() => drainCount === 1)
    const concurrentWakes = Array.from({ length: 100 }, () => worker.kick())
    firstDrain.resolve()
    await Promise.all([initialRun, ...concurrentWakes])

    expect(drain).toHaveBeenCalledTimes(2)
    expect(app.locals.persistedMailSyncWorkerSnapshot()).toMatchObject({
      state: 'idle',
      kickCount: 101,
      coalescedKickCount: 100,
      drainCount: 2,
    })
  })

  it('keeps coordinator state isolated per createApp instance and rejects late kicks after stop', async () => {
    const firstAppDrain = deferred()
    const drainA = vi.fn(async () => { await firstAppDrain.promise })
    const drainB = vi.fn(async () => {})
    const appA = createTestApp(drainA)
    const appB = createTestApp(drainB)

    const activeA = appA.locals.persistedMailSyncWorker.kick()
    await waitFor(() => drainA.mock.calls.length === 1)
    await appB.locals.persistedMailSyncWorker.kick()

    expect(drainA).toHaveBeenCalledOnce()
    expect(drainB).toHaveBeenCalledOnce()
    expect(appA.locals.persistedMailSyncWorkerSnapshot().state).toBe('running')
    expect(appB.locals.persistedMailSyncWorkerSnapshot().state).toBe('idle')

    firstAppDrain.resolve()
    await activeA
    await appA.locals.stopPersistedMailSyncWorker()
    await expect(appA.locals.persistedMailSyncWorker.kick()).rejects.toMatchObject({
      code: 'COALESCED_WORKER_STOPPED',
    })

    await appB.locals.persistedMailSyncWorker.kick()
    expect(drainB).toHaveBeenCalledTimes(2)
  })

  it('routes the persisted recurring task through the app-owned coordinator', async () => {
    const drain = vi.fn(async () => {})
    const app = createTestApp(drain)
    const recurringEntry = app.locals.recurringTasks.find((entry) => (
      entry.name === 'persisted-mail-sync-jobs'
    ))

    await expect(recurringEntry.run()).resolves.toBeUndefined()

    expect(drain).toHaveBeenCalledOnce()
    expect(app.locals.persistedMailSyncWorkerSnapshot()).toMatchObject({
      kickCount: 1,
      drainCount: 1,
    })
  })
})
