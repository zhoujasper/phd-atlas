import { describe, expect, it } from 'vitest'
import { resetWriteLaneStatsForTests, withWriteLock, writeLaneSnapshot } from './storage.js'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('store write lane isolation', () => {
  it('runs writes for different tenants concurrently', async () => {
    let active = 0
    let peak = 0
    const run = async (tenantKey) => withWriteLock(async () => {
      active += 1
      peak = Math.max(peak, active)
      await sleep(25)
      active -= 1
    }, { tenantKeys: [tenantKey] })

    await Promise.all([
      run('user:a'),
      run('user:b'),
      run('team:one'),
    ])
    expect(peak).toBe(3)
  })

  it('serializes writes for the same tenant', async () => {
    let active = 0
    let peak = 0
    const run = async () => withWriteLock(async () => {
      active += 1
      peak = Math.max(peak, active)
      await sleep(25)
      active -= 1
    }, { tenantKeys: ['user:same'] })

    await Promise.all([run(), run(), run()])
    expect(peak).toBe(1)
  })

  it('keeps nested write-lock calls reentrant', async () => {
    let nested = false
    await withWriteLock(async () => {
      await withWriteLock(async () => {
        nested = true
      }, { tenantKeys: ['team:inner'] })
    }, { tenantKeys: ['team:outer'] })
    expect(nested).toBe(true)
  })

  // Regression: re-entrancy must survive a second tenant acquiring a lane
  // between the outer and inner acquisition. A module-level "current owner"
  // guard is clobbered by that interleave, so the inner call stops being
  // recognised as re-entrant and blocks on the lane its own caller holds.
  // This is the real lockedWriteStore -> writeStore shape, both naming the
  // same tenant, and it deadlocks rather than failing an assertion.
  it('keeps nested calls reentrant while another tenant interleaves', async () => {
    const nestSameTenant = async (tenantKey) => withWriteLock(async () => {
      // Yield so the other tenant can acquire its lane mid-flight.
      await sleep(10)
      return withWriteLock(async () => `${tenantKey}:inner`, { tenantKeys: [tenantKey] })
    }, { tenantKeys: [tenantKey] })

    const settled = await Promise.race([
      Promise.all([nestSameTenant('user:nest-a'), nestSameTenant('user:nest-b')]),
      sleep(3_000).then(() => 'deadlock'),
    ])
    expect(settled).toEqual(['user:nest-a:inner', 'user:nest-b:inner'])
  })

  it('does not let tenant writes starve a queued global write', async () => {
    const order = []
    const firstTenantStarted = new Promise((resolve) => {
      void withWriteLock(async () => {
        resolve()
        await sleep(40)
        order.push('tenant-1')
      }, { tenantKeys: ['user:starve'] })
    })
    await firstTenantStarted

    // Queued while a lane is busy, so it must wait for every lane to drain.
    const globalWrite = withWriteLock(async () => { order.push('global') })
    // Queued after the global write; it must not overtake it.
    const laterTenant = withWriteLock(
      async () => { order.push('tenant-2') },
      { tenantKeys: ['user:starve-other'] },
    )

    await Promise.all([globalWrite, laterTenant])
    expect(order).toEqual(['tenant-1', 'global', 'tenant-2'])
  })

  it('waits for active tenant lanes before a global write', async () => {
    let tenantFinished = false
    const tenantStarted = new Promise((resolve) => {
      void withWriteLock(async () => {
        resolve()
        await sleep(30)
        tenantFinished = true
      }, { tenantKeys: ['user:global-wait'] })
    })
    await tenantStarted
    await withWriteLock(async () => {
      expect(tenantFinished).toBe(true)
    })
  })
})

describe('store write lane observability', () => {
  it('records contention so a serialised save can be told apart from a slow one', async () => {
    resetWriteLaneStatsForTests()
    const before = writeLaneSnapshot()
    expect(before.granted).toBe(0)

    // Same tenant twice: the second acquisition has to queue behind the first.
    await Promise.all([
      withWriteLock(() => sleep(30), { tenantKeys: ['user:observed'] }),
      withWriteLock(() => sleep(1), { tenantKeys: ['user:observed'] }),
      withWriteLock(() => sleep(1), { tenantKeys: ['user:other'] }),
    ])

    const after = writeLaneSnapshot()
    expect(after.granted).toBe(3)
    expect(after.contended).toBeGreaterThanOrEqual(1)
    expect(after.maxWaitMs).toBeGreaterThan(0)
    expect(after.maxQueueDepth).toBeGreaterThanOrEqual(1)
    // Counters must never outlive the work they describe.
    expect(after.activeLanes).toBe(0)
    expect(after.queueDepth).toBe(0)
  })

  it('counts a global acquisition without reporting it as a tenant lane', async () => {
    resetWriteLaneStatsForTests()
    await withWriteLock(() => sleep(1))

    const snapshot = writeLaneSnapshot()
    expect(snapshot.granted).toBe(1)
    expect(snapshot.globalGranted).toBe(1)
    expect(snapshot.activeLanes).toBe(0)
  })

  it('leaves no lane held when the guarded work throws', async () => {
    resetWriteLaneStatsForTests()
    await expect(withWriteLock(async () => {
      throw new Error('write failed')
    }, { tenantKeys: ['user:thrower'] })).rejects.toThrow('write failed')

    const snapshot = writeLaneSnapshot()
    expect(snapshot.activeLanes).toBe(0)
    expect(snapshot.queueDepth).toBe(0)
    // A later write for the same tenant must still be admitted immediately.
    await withWriteLock(() => sleep(1), { tenantKeys: ['user:thrower'] })
    expect(writeLaneSnapshot().activeLanes).toBe(0)
  })
})
