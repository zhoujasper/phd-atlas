import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

process.env.SETTINGS_ENCRYPTION_KEY ??= 'payload-worker-test-encryption-key'

const { createPayloadWorkerPool } = await import('./payloadWorkerPool.mjs')

const pools = []

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()))
  vi.useRealTimers()
})

function controlledPool(options = {}) {
  const workers = []
  const pool = createPayloadWorkerPool({
    size: 1,
    thresholdBytes: 1,
    ...options,
    workerFactory() {
      const worker = new EventEmitter()
      worker.postMessage = vi.fn()
      worker.terminate = vi.fn(async () => { worker.emit('exit', 0) })
      workers.push(worker)
      return worker
    },
  })
  pools.push(pool)
  const answer = (worker, index, result) => worker.emit('message', {
    id: worker.postMessage.mock.calls[index][0].id, result,
  })
  return { pool, workers, answer }
}

describe('payload worker pool', () => {
  it('queues work behind busy workers instead of flooding the main thread', async () => {
    const { pool, workers, answer } = controlledPool()
    const first = pool.decode('{"first":true}')
    const second = pool.decode('{"second":true}')
    expect(pool.snapshot()).toMatchObject({ active: 1, queued: 1, counters: { fallbacks: 0 } })
    answer(workers[0], 0, { first: true })
    await expect(first).resolves.toEqual({ first: true })
    expect(workers).toHaveLength(1)
    expect(workers[0].postMessage).toHaveBeenCalledTimes(2)
    answer(workers[0], 1, { second: true })
    await expect(second).resolves.toEqual({ second: true })
  })

  it('keeps an active timeout from reusing a stalled worker', async () => {
    vi.useFakeTimers()
    const { pool, workers } = controlledPool({ timeoutMs: 100 })
    const first = pool.decode('{"first":true}')
    await vi.advanceTimersByTimeAsync(100)
    await expect(first).resolves.toBeNull()
    expect(workers[0].terminate).toHaveBeenCalledOnce()
    const second = pool.decode('{"second":true}')
    // A degraded pool falls back immediately; the timed-out thread never owns
    // another job while its original CPU work may still be running.
    await expect(second).resolves.toBeNull()
    expect(workers[0].postMessage).toHaveBeenCalledTimes(1)
    expect(pool.snapshot()).toMatchObject({ active: 0, queued: 0 })
  })

  it('falls back immediately after close without retaining work or timers', async () => {
    vi.useFakeTimers()
    const { pool } = controlledPool()
    await pool.close()
    const result = pool.decode('{"late":true}')
    expect(pool.snapshot()).toMatchObject({ active: 0, queued: 0 })
    await expect(result).resolves.toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('releases a slot if postMessage cannot clone a payload', async () => {
    const { pool, workers, answer } = controlledPool()
    const warm = pool.decode('{"warm":true}')
    answer(workers[0], 0, { warm: true })
    await warm
    workers[0].postMessage.mockImplementationOnce(() => { throw new Error('DataCloneError') })
    await expect(pool.encode({ invalid: () => {} }, { forceWorker: true, skipSizeCheck: true })).resolves.toBeNull()
    expect(pool.snapshot()).toMatchObject({ active: 0, queued: 0 })
    const next = pool.decode('{"ok":true}')
    answer(workers[0], 2, { ok: true })
    await expect(next).resolves.toEqual({ ok: true })
  })

  it('enforces a bounded waiting queue and preserves its earlier work', async () => {
    const { pool, workers, answer } = controlledPool({ maxQueued: 1 })
    const active = pool.decode('{"active":true}')
    const queued = pool.decode('{"queued":true}')
    await expect(pool.decode('{"overflow":true}')).resolves.toBeNull()
    expect(pool.snapshot()).toMatchObject({ active: 1, queued: 1 })
    answer(workers[0], 0, { active: true })
    await active
    answer(workers[0], 1, { queued: true })
    await expect(queued).resolves.toEqual({ queued: true })
  })

  it('round-trips a large encrypted payload through a worker', async () => {
    const pool = createPayloadWorkerPool({
      size: 1,
      thresholdBytes: 1,
      timeoutMs: 5_000,
    })
    pools.push(pool)

    const value = { body: 'x'.repeat(128 * 1024), nested: { ok: true } }
    const encoded = await pool.encode(value, {
      policy: { encryptionAtRest: true, algorithm: 'aes-256-gcm', passwordBinding: '' },
    })
    expect(encoded, JSON.stringify(pool.snapshot())).toEqual(expect.stringMatching(/^payload:/u))
    const decoded = await pool.decode(encoded)
    expect(decoded).toMatchObject(value)
    expect(pool.snapshot().counters.processed).toBe(2)
  })

  // Regression: the timeout callback runs outside the Promise executor, so a
  // bare reject() there is a ReferenceError thrown from a timer -- which ends
  // the process instead of degrading one payload back to the main thread. A
  // worker that accepts work and never answers is the only way to reach it.
  it('degrades to the main thread when a worker stops answering', async () => {
    const stalledWorkers = []
    const pool = createPayloadWorkerPool({
      size: 1,
      thresholdBytes: 1,
      timeoutMs: 50,
      workerFactory() {
        // Accepts postMessage and never replies, so the request can only be
        // resolved by the timeout path.
        const worker = {
          postMessage() {},
          on() {},
          off() {},
          once() {},
          removeAllListeners() {},
          terminate: async () => {},
          unref() {},
        }
        stalledWorkers.push(worker)
        return worker
      },
    })
    pools.push(pool)

    const uncaught = []
    const captureUncaught = (error) => uncaught.push(error)
    process.on('uncaughtException', captureUncaught)
    try {
      // null means "caller should encode on the main thread", which is the
      // documented degraded result -- not a thrown error.
      const encoded = await pool.encode({ body: 'y'.repeat(64 * 1024) }, {
        policy: { encryptionAtRest: false },
      })
      expect(encoded).toBeNull()
      // Let any timer-scheduled throw surface before asserting.
      await new Promise((resolve) => setTimeout(resolve, 50))
    } finally {
      process.off('uncaughtException', captureUncaught)
    }

    expect(uncaught).toEqual([])
    const { counters } = pool.snapshot()
    expect(counters.timedOut).toBeGreaterThan(0)
    expect(counters.fallbacks).toBeGreaterThan(0)
  })

  it('falls back without throwing when worker creation is unavailable', async () => {
    const pool = createPayloadWorkerPool({
      size: 1,
      thresholdBytes: 1,
      workerFactory() {
        throw new Error('worker unavailable')
      },
    })
    pools.push(pool)

    await expect(pool.encode('large-value', {
      policy: { encryptionAtRest: true },
    })).resolves.toBeNull()
    await expect(pool.decode('payload:missing')).resolves.toBeNull()
    expect(pool.snapshot()).toMatchObject({ degraded: true })
  })
})
