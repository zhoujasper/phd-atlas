import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  browserPushTopic,
  createBrowserPushBatcher,
  createFileBrowserPushPersistence,
  createMemoryBrowserPushPersistence,
  shouldDeliverBrowserPushImmediately,
} from './browserPushBatcher.js'

const tempRoots = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

function notification(id, type, overrides = {}) {
  return {
    id,
    type,
    title: `Title ${id}`,
    body: `Body ${id}`,
    createdAt: '2026-07-22T10:00:00.000Z',
    ...overrides,
  }
}

describe('browser push batching', () => {
  it('coalesces every due topic into one user-level digest without mixing users', async () => {
    let clock = 1_000
    const deliver = vi.fn().mockResolvedValue({ attempted: 1, delivered: 1, failed: 0, removed: 0 })
    const batcher = createBrowserPushBatcher({
      deliver,
      persistence: createMemoryBrowserPushPersistence(),
      now: () => clock,
      batchWindowMs: 100,
      maxWaitMs: 500,
      scheduleTimers: false,
    })

    await batcher.enqueue('user-a', notification('mail-1', 'new_email_imported'))
    clock += 20
    await batcher.enqueue('user-a', notification('mail-2', 'new_email_imported'))
    await batcher.enqueue('user-a', notification('deadline-1', 'deadline_approaching'))
    await batcher.enqueue('user-b', notification('mail-3', 'new_email_imported'))

    expect(deliver).not.toHaveBeenCalled()
    expect(await batcher.pending()).toHaveLength(3)

    clock = 1_121
    const results = await batcher.flushDue({ at: clock })
    expect(results).toHaveLength(2)
    expect(deliver).toHaveBeenCalledTimes(2)
    const userBatch = deliver.mock.calls.find(([userId]) => userId === 'user-a')
    expect(userBatch?.[1]).toMatchObject({
      type: 'notification_batch',
      title: 'PhD Atlas: 3 new notifications',
      metadata: {
        aggregate: true,
        count: 3,
        topic: 'mixed',
        topics: ['correspondence', 'reminders'],
      },
    })
    expect(userBatch?.[1].body).toContain('Title mail-1; Title mail-2; Title deadline-1')
    expect(await batcher.pending()).toEqual([])
  })

  it('delivers explicit test notifications immediately and leaves the durable queue untouched', async () => {
    const persistence = createMemoryBrowserPushPersistence()
    const deliver = vi.fn().mockResolvedValue({ attempted: 1, delivered: 1, failed: 0, removed: 0 })
    const batcher = createBrowserPushBatcher({ deliver, persistence, scheduleTimers: false })
    const testNotification = notification('push-test:user-a', 'push_test')

    await expect(batcher.enqueue('user-a', testNotification)).resolves.toMatchObject({ mode: 'immediate' })
    expect(deliver).toHaveBeenCalledWith('user-a', testNotification)
    expect(persistence.inspect()).toEqual({ version: 2, revision: 0, batches: [], userDispatches: [] })
  })

  it('immediately flushes a critical due deadline together with queued reminders', async () => {
    let clock = Date.parse('2026-07-22T10:00:00.000Z')
    const deliver = vi.fn().mockResolvedValue({ attempted: 1, delivered: 1, failed: 0, removed: 0 })
    const batcher = createBrowserPushBatcher({
      deliver,
      persistence: createMemoryBrowserPushPersistence(),
      now: () => clock,
      batchWindowMs: 1_000,
      scheduleTimers: false,
    })

    await batcher.enqueue('user-a', notification('task-1', 'task_due'))
    await batcher.enqueue('user-a', notification('mail-1', 'new_email_imported'))
    const result = await batcher.enqueue('user-a', notification('deadline-1', 'deadline_approaching', {
      triggerDate: '2026-07-22',
    }))

    expect(result).toMatchObject({ mode: 'immediate', delivery: { status: 'delivered', topic: 'mixed', count: 3 } })
    expect(deliver).toHaveBeenCalledOnce()
    expect(deliver).toHaveBeenCalledWith('user-a', expect.objectContaining({
      type: 'notification_batch',
      metadata: expect.objectContaining({
        count: 3,
        topic: 'mixed',
        topics: ['correspondence', 'reminders'],
      }),
    }))
    expect(await batcher.pending()).toEqual([])

    clock += 1
    await batcher.enqueue('user-a', notification('deadline-future', 'deadline_approaching', {
      triggerDate: '2026-07-23',
    }))
    expect(deliver).toHaveBeenCalledOnce()
    expect(await batcher.pending()).toHaveLength(1)

    await expect(batcher.enqueue('user-a', notification('deadline-critical', 'deadline_due'))).resolves.toMatchObject({
      mode: 'immediate',
      delivery: { status: 'delivered', count: 2 },
    })
    expect(deliver).toHaveBeenCalledTimes(2)
    expect(await batcher.pending()).toEqual([])
  })

  it('persists the user-level minimum interval across restart', async () => {
    let clock = 1_000
    const persistence = createMemoryBrowserPushPersistence()
    const firstDeliver = vi.fn().mockResolvedValue({ attempted: 1, delivered: 1, failed: 0, removed: 0 })
    const first = createBrowserPushBatcher({
      deliver: firstDeliver,
      persistence,
      now: () => clock,
      batchWindowMs: 10,
      userMinIntervalMs: 100,
      scheduleTimers: false,
    })
    await first.enqueue('user-a', notification('first', 'discover_match'))
    clock += 10
    await first.flushDue({ at: clock })
    expect(firstDeliver).toHaveBeenCalledOnce()

    await first.enqueue('user-a', notification('second', 'new_email_imported'))
    first.stop()
    const restartedDeliver = vi.fn().mockResolvedValue({ attempted: 1, delivered: 1, failed: 0, removed: 0 })
    const restarted = createBrowserPushBatcher({
      deliver: restartedDeliver,
      persistence,
      now: () => clock,
      batchWindowMs: 10,
      userMinIntervalMs: 100,
      scheduleTimers: false,
    })
    await restarted.start()
    clock += 10
    await expect(restarted.flushDue({ at: clock })).resolves.toEqual([])
    expect(restartedDeliver).not.toHaveBeenCalled()

    clock = 1_110
    await expect(restarted.flushDue({ at: clock })).resolves.toMatchObject([{ status: 'delivered' }])
    expect(restartedDeliver).toHaveBeenCalledOnce()
  })

  it('retains a failed critical deadline delivery in the durable retry queue', async () => {
    let clock = Date.parse('2026-07-22T10:00:00.000Z')
    const persistence = createMemoryBrowserPushPersistence()
    const deliver = vi.fn()
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValueOnce({ attempted: 1, delivered: 1, failed: 0, removed: 0 })
    const batcher = createBrowserPushBatcher({
      deliver,
      persistence,
      now: () => clock,
      retryBaseMs: 50,
      scheduleTimers: false,
      onError: vi.fn(),
    })

    await expect(batcher.enqueue('user-a', notification('deadline-1', 'deadline_due'))).resolves.toMatchObject({
      mode: 'immediate',
      delivery: { status: 'retry' },
    })
    expect((await batcher.pending())[0]).toMatchObject({ attempts: 1, dueAt: clock + 50 })

    clock += 50
    await expect(batcher.flushDue({ at: clock })).resolves.toMatchObject([{ status: 'delivered' }])
    expect(await batcher.pending()).toEqual([])
  })

  it('recovers an overdue batch after restart and ignores duplicate notification ids', async () => {
    let clock = 10_000
    const persistence = createMemoryBrowserPushPersistence()
    const firstDeliver = vi.fn()
    const firstProcess = createBrowserPushBatcher({
      deliver: firstDeliver,
      persistence,
      now: () => clock,
      batchWindowMs: 100,
      scheduleTimers: false,
    })
    await firstProcess.enqueue('user-a', notification('n-1', 'discover_match'))
    await firstProcess.enqueue('user-a', notification('n-1', 'discover_match'))
    firstProcess.stop()

    clock += 101
    const restartedDeliver = vi.fn().mockResolvedValue({ attempted: 1, delivered: 1, failed: 0, removed: 0 })
    const restarted = createBrowserPushBatcher({
      deliver: restartedDeliver,
      persistence,
      now: () => clock,
      scheduleTimers: false,
    })
    await expect(restarted.start()).resolves.toEqual({ batches: 1, notifications: 1 })
    await restarted.flushDue({ at: clock })

    expect(firstDeliver).not.toHaveBeenCalled()
    expect(restartedDeliver).toHaveBeenCalledOnce()
    expect(restartedDeliver.mock.calls[0][1]).toMatchObject({ id: 'n-1', type: 'discover_match' })
    expect(await restarted.pending()).toEqual([])
  })

  it('does not create an empty topic batch when the same notification id is re-enqueued elsewhere', async () => {
    const batcher = createBrowserPushBatcher({
      deliver: vi.fn(),
      persistence: createMemoryBrowserPushPersistence(),
      scheduleTimers: false,
    })

    await batcher.enqueue('user-a', notification('n-1', 'discover_match'))
    await expect(batcher.enqueue('user-a', notification('n-1', 'anything', {
      metadata: { pushTopic: 'application:42' },
    }))).resolves.toMatchObject({ duplicate: true })

    const pending = await batcher.pending()
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({ topic: 'discover', notifications: [{ id: 'n-1' }] })
  })

  it('keeps a critical alert urgent when it is queued during an in-flight user delivery', async () => {
    let clock = 1_000
    let resolveFirstDelivery
    const firstDelivery = new Promise((resolve) => { resolveFirstDelivery = resolve })
    const deliver = vi.fn()
      .mockImplementationOnce(() => firstDelivery)
      .mockResolvedValueOnce({ attempted: 1, delivered: 1, failed: 0, removed: 0 })
    const batcher = createBrowserPushBatcher({
      deliver,
      persistence: createMemoryBrowserPushPersistence(),
      now: () => clock,
      batchWindowMs: 10,
      userMinIntervalMs: 1_000,
      scheduleTimers: false,
    })

    await batcher.enqueue('user-a', notification('task-1', 'task_due'))
    clock += 10
    const firstFlush = batcher.flushDue({ at: clock })
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1))

    await expect(batcher.enqueue('user-a', notification('deadline-1', 'deadline_due'))).resolves.toMatchObject({
      mode: 'immediate',
      delivery: { status: 'skipped' },
    })
    resolveFirstDelivery({ attempted: 1, delivered: 1, failed: 0, removed: 0 })
    await firstFlush

    // The first delivery just started a long user cooldown. The due alert must nevertheless
    // remain ready and bypass it instead of waiting for the normal interval.
    await expect(batcher.flushDue({ at: clock })).resolves.toMatchObject([
      { status: 'delivered', userId: 'user-a', count: 1 },
    ])
    expect(deliver).toHaveBeenCalledTimes(2)
    expect(await batcher.pending()).toEqual([])
  })

  it('persists an explicit critical cooldown bypass through retry and restart', async () => {
    let clock = Date.parse('2026-07-22T10:00:00.000Z')
    const persistence = createMemoryBrowserPushPersistence()
    const deliver = vi.fn()
      .mockResolvedValueOnce({ attempted: 1, delivered: 1, failed: 0, removed: 0 })
      .mockRejectedValueOnce(new Error('provider unavailable'))
    const first = createBrowserPushBatcher({
      deliver,
      persistence,
      now: () => clock,
      batchWindowMs: 10,
      userMinIntervalMs: 1_000,
      retryBaseMs: 50,
      scheduleTimers: false,
      onError: vi.fn(),
    })

    await first.enqueue('user-a', notification('normal-1', 'discover_match'))
    clock += 10
    await first.flushDue({ at: clock })
    clock += 1
    await expect(first.enqueue('user-a', notification('critical-1', 'deadline_approaching', {
      triggerDate: '2026-07-23',
      metadata: { critical: true },
    }))).resolves.toMatchObject({ mode: 'immediate', delivery: { status: 'retry' } })
    first.stop()

    clock += 50
    const restartedDeliver = vi.fn().mockResolvedValue({ attempted: 1, delivered: 1, failed: 0, removed: 0 })
    const restarted = createBrowserPushBatcher({
      deliver: restartedDeliver,
      persistence,
      now: () => clock,
      userMinIntervalMs: 1_000,
      scheduleTimers: false,
    })
    await restarted.start()
    await expect(restarted.flushDue({ at: clock })).resolves.toMatchObject([
      { status: 'delivered', userId: 'user-a', count: 1 },
    ])
    expect(restartedDeliver).toHaveBeenCalledOnce()
  })

  it('persists a failed transport for exponential retry and abandons only after the configured ceiling', async () => {
    let clock = 2_000
    const persistence = createMemoryBrowserPushPersistence()
    const onError = vi.fn()
    const deliver = vi.fn()
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValueOnce({ attempted: 1, delivered: 1, failed: 0, removed: 0 })
    const batcher = createBrowserPushBatcher({
      deliver,
      persistence,
      now: () => clock,
      batchWindowMs: 10,
      retryBaseMs: 50,
      maxAttempts: 3,
      scheduleTimers: false,
      onError,
    })
    await batcher.enqueue('user-a', notification('n-1', 'task_due'))
    clock += 10

    await expect(batcher.flushDue({ at: clock })).resolves.toMatchObject([{ status: 'retry' }])
    expect((await batcher.pending())[0]).toMatchObject({ attempts: 1, dueAt: clock + 50 })
    expect(onError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ attempts: 1, abandoned: false }))

    clock += 50
    await expect(batcher.flushDue({ at: clock })).resolves.toMatchObject([{ status: 'delivered' }])
    expect(await batcher.pending()).toEqual([])
  })

  it('stores journal snapshots encrypted and recovers from a newer compaction sidecar', async () => {
    const tempRoot = path.join(process.cwd(), 'logs', 'tmp', `push-batcher-${randomUUID()}`)
    tempRoots.push(tempRoot)
    const filePath = path.join(tempRoot, 'push.journal')
    const persistence = createFileBrowserPushPersistence({ filePath, maxJournalBytes: 1 })
    const firstState = {
      version: 1,
      revision: 1,
      batches: [{
        userId: 'user-a',
        topic: 'discover',
        notifications: [notification('private-id', 'discover_match', { title: 'Private advisor update' })],
        firstQueuedAt: 1,
        lastQueuedAt: 1,
        dueAt: 2,
        attempts: 0,
      }],
    }
    await persistence.save(firstState)

    const raw = await fs.readFile(filePath, 'utf8')
    expect(raw).not.toContain('Private advisor update')
    await expect(persistence.load()).resolves.toMatchObject({ revision: 1, batches: [{ userId: 'user-a' }] })

    // Model a process stopping after the recovery copy was durable but while the main journal
    // was being replaced. Startup must select the intact sidecar instead of losing the batch.
    await fs.copyFile(filePath, `${filePath}.recovery`)
    await fs.writeFile(filePath, 'truncated-final-record', 'utf8')
    await expect(persistence.load()).resolves.toMatchObject({
      revision: 1,
      batches: [{ notifications: [{ title: 'Private advisor update' }] }],
    })
  })

  it('honors an explicit producer topic and maps common event families', () => {
    expect(browserPushTopic({ type: 'new_email_imported' })).toBe('correspondence')
    expect(browserPushTopic({ type: 'discover_match' })).toBe('discover')
    expect(browserPushTopic({ type: 'deadline_due' })).toBe('reminders')
    expect(browserPushTopic({ type: 'anything', metadata: { pushTopic: 'application:42' } })).toBe('application:42')
    expect(shouldDeliverBrowserPushImmediately(notification('due', 'deadline_due'))).toBe(true)
    expect(shouldDeliverBrowserPushImmediately(notification('future', 'deadline_approaching', {
      triggerDate: '2026-07-23',
    }))).toBe(false)
  })
})
