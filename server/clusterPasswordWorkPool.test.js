import { afterEach, describe, expect, it } from 'vitest'
import {
  CLUSTER_ROLE_ENV,
  CLUSTER_WORKERS_ENV,
  createClusterPasswordWorkPool,
  createRestartBudget,
  parseClusterWorkerCount,
} from './clusterPasswordWorkPool.js'
import { hashAccountPassword } from './passwordSecurity.js'

const TEST_PASSWORD = 'Cluster password work pool 2026!'

let pool

afterEach(async () => {
  await pool?.close()
  pool = null
  delete process.env[CLUSTER_WORKERS_ENV]
  delete process.env[CLUSTER_ROLE_ENV]
  delete process.env.PHD_ATLAS_CLUSTER_WORKER_THREADPOOL_SIZE
})

async function waitFor(predicate, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for cluster worker state.')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

describe('cluster password work pool', () => {
  it('defaults to single process and rejects malformed explicit counts', () => {
    expect(parseClusterWorkerCount(undefined)).toBe(0)
    expect(parseClusterWorkerCount('')).toBe(0)
    expect(parseClusterWorkerCount('bogus')).toBe(0)
    expect(parseClusterWorkerCount('2')).toBe(2)
    expect(parseClusterWorkerCount('999')).toBe(32)
  })

  it('enforces a systemd-style restart burst budget', () => {
    let now = 0
    const budget = createRestartBudget({
      burst: 2,
      intervalMs: 100,
      now: () => now,
    })
    expect(budget.allow()).toBe(true)
    expect(budget.allow()).toBe(true)
    expect(budget.allow()).toBe(false)
    now = 101
    expect(budget.allow()).toBe(true)
  })

  it('uses the local verifier when cluster workers are not enabled', async () => {
    const hash = await hashAccountPassword(TEST_PASSWORD)
    pool = createClusterPasswordWorkPool({
      workerCount: 0,
      fallbackVerify: async (password, encoded) => ({
        valid: password === TEST_PASSWORD && encoded === hash,
        needsRehash: false,
      }),
    })
    expect(pool.enabled).toBe(false)
    await expect(pool.verifyAccountPassword(TEST_PASSWORD, hash)).resolves.toEqual({
      valid: true,
      needsRehash: false,
    })
  })

  it('spawns stateless cluster workers and verifies Argon2 without opening SQLite', async () => {
    process.env[CLUSTER_WORKERS_ENV] = '1'
    process.env.UV_THREADPOOL_SIZE = '8'
    pool = createClusterPasswordWorkPool({ workerReadyTimeoutMs: 10_000 })
    expect(pool.enabled).toBe(true)
    await pool.ready
    await waitFor(() => pool.snapshot().healthyWorkers === 1)

    const hash = await pool.hashAccountPassword(TEST_PASSWORD)
    expect(hash).toMatch(/^\$argon2id/u)
    await expect(pool.verifyAccountPassword(TEST_PASSWORD, hash)).resolves.toMatchObject({
      valid: true,
      needsRehash: false,
    })
    await expect(pool.verifyAccountPassword('Wrong password 2026!', hash)).resolves.toMatchObject({
      valid: false,
    })
  }, 60_000)

  it('falls back to local verification after a worker crashes and recovers it', async () => {
    process.env[CLUSTER_WORKERS_ENV] = '1'
    process.env.UV_THREADPOOL_SIZE = '8'
    pool = createClusterPasswordWorkPool({
      workerReadyTimeoutMs: 10_000,
      restartDelayMs: 50,
    })
    await pool.ready
    await waitFor(() => pool.getWorkerProcessIds().length === 1)
    const hash = await hashAccountPassword(TEST_PASSWORD)
    const workerPid = pool.getWorkerProcessIds()[0]
    process.kill(workerPid)
    await waitFor(() => pool.snapshot().restartCount >= 1)

    await expect(pool.verifyAccountPassword(TEST_PASSWORD, hash)).resolves.toMatchObject({
      valid: true,
      needsRehash: false,
    })
    await waitFor(() => pool.snapshot().healthyWorkers === 1)
  }, 60_000)

  it('disconnects and drains workers before the primary closes', async () => {
    process.env[CLUSTER_WORKERS_ENV] = '1'
    process.env.UV_THREADPOOL_SIZE = '8'
    pool = createClusterPasswordWorkPool({ workerReadyTimeoutMs: 10_000 })
    await pool.ready
    await waitFor(() => pool.getWorkerProcessIds().length === 1)
    await pool.close()
    await waitFor(() => pool.getWorkerProcessIds().length === 0)
    expect(pool.snapshot().closed).toBe(true)
  }, 60_000)
})
