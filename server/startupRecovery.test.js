import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createStartupRecoveryOrchestrator,
  DEFAULT_INITIAL_DELAY_MS,
  sortStartupRecoveryEntries,
} from './startupRecovery.js'

const entry = (name, runNow, runOnStartup = true) => ({
  name,
  runOnStartup,
  task: { runNow },
})

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('startup recovery ordering', () => {
  it('runs known light-weight work first and keeps unknown tasks stable at the end', () => {
    const entries = [
      entry('unknown-first', vi.fn()),
      entry('mail-fetch', vi.fn()),
      entry('discover-research-recovery', vi.fn()),
      entry('outgoing-email-delivery', vi.fn()),
      entry('unknown-second', vi.fn()),
      entry('persisted-mail-sync-jobs', vi.fn()),
      entry('disabled', vi.fn(), false),
    ]

    expect(sortStartupRecoveryEntries(entries).map(({ name }) => name)).toEqual([
      'persisted-mail-sync-jobs',
      'discover-research-recovery',
      'outgoing-email-delivery',
      'mail-fetch',
      'unknown-first',
      'unknown-second',
    ])
  })
})

describe('createStartupRecoveryOrchestrator', () => {
  it('defaults to one active recovery and preserves the priority start order', async () => {
    const starts = []
    const releases = []
    let active = 0
    let peakActive = 0
    const slowEntry = (name) => entry(name, vi.fn(async () => {
      starts.push(name)
      active += 1
      peakActive = Math.max(peakActive, active)
      await new Promise((resolve) => releases.push(resolve))
      active -= 1
      return true
    }))
    const orchestrator = createStartupRecoveryOrchestrator({
      entries: [slowEntry('mail-fetch'), slowEntry('persisted-mail-sync-jobs')],
      initialDelayMs: 0,
      staggerMs: 0,
    })

    const completion = orchestrator.run()
    await vi.advanceTimersByTimeAsync(0)
    expect(starts).toEqual(['persisted-mail-sync-jobs'])
    expect(peakActive).toBe(1)

    releases.shift()()
    await vi.advanceTimersByTimeAsync(0)
    expect(starts).toEqual(['persisted-mail-sync-jobs', 'mail-fetch'])
    expect(peakActive).toBe(1)

    releases.shift()()
    await expect(completion).resolves.toEqual([
      { name: 'persisted-mail-sync-jobs', status: 'fulfilled' },
      { name: 'mail-fetch', status: 'fulfilled' },
    ])
  })

  it('isolates failures and treats an occupied recurring task as a normal result', async () => {
    const failure = new Error('SMTP unavailable')
    const onError = vi.fn(() => {
      throw new Error('broken logger')
    })
    const finalRun = vi.fn().mockResolvedValue(true)
    const orchestrator = createStartupRecoveryOrchestrator({
      entries: [
        entry('system-email-delivery', vi.fn().mockRejectedValue(failure)),
        entry('outgoing-email-delivery', vi.fn().mockResolvedValue(false)),
        entry('mail-fetch', finalRun),
      ],
      initialDelayMs: 0,
      staggerMs: 0,
      onError,
    })

    const results = await orchestrator.run()

    expect(results).toEqual([
      { name: 'system-email-delivery', status: 'rejected', reason: failure },
      { name: 'outgoing-email-delivery', status: 'occupied' },
      { name: 'mail-fetch', status: 'fulfilled' },
    ])
    expect(onError).toHaveBeenCalledWith(failure, expect.objectContaining({ name: 'system-email-delivery' }))
    expect(finalRun).toHaveBeenCalledOnce()
    expect(orchestrator.results()).toEqual(results)
  })

  it('supports an external AbortSignal during the initial settle delay', async () => {
    const controller = new AbortController()
    const firstRun = vi.fn()
    const secondRun = vi.fn()
    const timers = {
      setTimeout: vi.fn((...args) => {
        const timer = setTimeout(...args)
        timer.unref = vi.fn()
        return timer
      }),
      clearTimeout,
    }
    const orchestrator = createStartupRecoveryOrchestrator({
      entries: [entry('persisted-mail-sync-jobs', firstRun), entry('mail-fetch', secondRun)],
      signal: controller.signal,
      timers,
    })

    const completion = orchestrator.run()
    await Promise.resolve()
    expect(timers.setTimeout).toHaveBeenCalledWith(expect.any(Function), DEFAULT_INITIAL_DELAY_MS)
    const timerHandle = timers.setTimeout.mock.results[0].value
    expect(timerHandle.unref).toHaveBeenCalledOnce()

    controller.abort(new Error('server stopping'))
    const results = await completion

    expect(firstRun).not.toHaveBeenCalled()
    expect(secondRun).not.toHaveBeenCalled()
    expect(results.map(({ status }) => status)).toEqual(['aborted', 'aborted'])
  })

  it('stop prevents later work after the currently active recovery settles', async () => {
    let release
    let receivedSignal
    const firstRun = vi.fn(({ signal }) => {
      receivedSignal = signal
      return new Promise((resolve) => { release = resolve })
    })
    const secondRun = vi.fn()
    const orchestrator = createStartupRecoveryOrchestrator({
      entries: [entry('persisted-mail-sync-jobs', firstRun), entry('mail-fetch', secondRun)],
      initialDelayMs: 0,
      staggerMs: 0,
    })

    const completion = orchestrator.run()
    await vi.advanceTimersByTimeAsync(0)
    const reason = new Error('shutdown')
    orchestrator.stop(reason)

    expect(receivedSignal).toBeInstanceOf(AbortSignal)
    expect(receivedSignal.aborted).toBe(true)
    expect(receivedSignal.reason).toBe(reason)
    let idle = false
    void orchestrator.whenIdle().then(() => { idle = true })
    await Promise.resolve()
    expect(idle).toBe(false)

    release(true)
    const results = await completion
    await orchestrator.whenIdle()
    await Promise.resolve()

    expect(firstRun).toHaveBeenCalledOnce()
    expect(secondRun).not.toHaveBeenCalled()
    expect(results.map(({ status }) => status)).toEqual(['fulfilled', 'aborted'])
    expect(idle).toBe(true)
  })

  it('waits for an abort-ignoring active recovery before becoming idle', async () => {
    let release
    const firstRun = vi.fn(() => new Promise((resolve) => { release = resolve }))
    const secondRun = vi.fn()
    const orchestrator = createStartupRecoveryOrchestrator({
      entries: [entry('persisted-mail-sync-jobs', firstRun), entry('mail-fetch', secondRun)],
      initialDelayMs: 0,
      staggerMs: 0,
    })

    const completion = orchestrator.run()
    await vi.advanceTimersByTimeAsync(0)
    orchestrator.stop(new Error('server stopping'))

    let completionSettled = false
    let idleSettled = false
    void completion.then(() => { completionSettled = true })
    void orchestrator.whenIdle().then(() => { idleSettled = true })
    await Promise.resolve()
    expect(completionSettled).toBe(false)
    expect(idleSettled).toBe(false)
    expect(secondRun).not.toHaveBeenCalled()

    release(true)
    await completion
    await orchestrator.whenIdle()
    expect(completionSettled).toBe(true)
    expect(idleSettled).toBe(true)
  })
})
