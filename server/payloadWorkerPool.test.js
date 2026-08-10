import { afterEach, describe, expect, it } from 'vitest'

process.env.SETTINGS_ENCRYPTION_KEY ??= 'payload-worker-test-encryption-key'

const { createPayloadWorkerPool } = await import('./payloadWorkerPool.mjs')

const pools = []

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()))
})

describe('payload worker pool', () => {
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
