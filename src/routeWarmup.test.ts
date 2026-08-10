import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  routeWarmupAllowed,
  scheduleIdleRouteWarmups,
  type RouteWarmupEnvironment,
} from './routeWarmup'

type IdleCallback = (deadline: IdleDeadline) => void

function environment(overrides: {
  online?: boolean
  visibility?: DocumentVisibilityState
  saveData?: boolean
  effectiveType?: string
} = {}) {
  const windowEvents = new EventTarget()
  const documentEvents = new EventTarget()
  const connectionEvents = new EventTarget()
  const idleCallbacks = new Map<number, IdleCallback>()
  let idleId = 0
  let online = overrides.online ?? true
  const documentState = {
    visibilityState: overrides.visibility ?? 'visible',
  }
  const connection = {
    saveData: overrides.saveData ?? false,
    effectiveType: overrides.effectiveType ?? '4g',
    addEventListener: connectionEvents.addEventListener.bind(connectionEvents),
    removeEventListener: connectionEvents.removeEventListener.bind(connectionEvents),
  }
  const runtime = {
    window: {
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
      addEventListener: windowEvents.addEventListener.bind(windowEvents),
      removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
      requestIdleCallback: vi.fn((callback: IdleCallback) => {
        idleId += 1
        idleCallbacks.set(idleId, callback)
        return idleId
      }),
      cancelIdleCallback: vi.fn((handle: number) => idleCallbacks.delete(handle)),
    },
    document: {
      get visibilityState() {
        return documentState.visibilityState
      },
      addEventListener: documentEvents.addEventListener.bind(documentEvents),
      removeEventListener: documentEvents.removeEventListener.bind(documentEvents),
    },
    navigator: {
      get onLine() {
        return online
      },
      connection,
    },
  } as RouteWarmupEnvironment

  const runNextIdle = () => {
    const next = idleCallbacks.entries().next().value as [number, IdleCallback] | undefined
    if (!next) throw new Error('No idle callback is scheduled.')
    idleCallbacks.delete(next[0])
    next[1]({ didTimeout: false, timeRemaining: () => 50 })
  }

  return {
    runtime,
    idleCallbacks,
    runNextIdle,
    hide() {
      documentState.visibilityState = 'hidden'
      documentEvents.dispatchEvent(new Event('visibilitychange'))
    },
    goOffline() {
      online = false
      windowEvents.dispatchEvent(new Event('offline'))
    },
  }
}

async function settleTask() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('route background warmup', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    ['offline', { online: false }],
    ['hidden', { visibility: 'hidden' as const }],
    ['save-data', { saveData: true }],
    ['slow-2g', { effectiveType: 'slow-2g' }],
    ['2g', { effectiveType: '2g' }],
  ])('does not schedule speculative transfers when %s', (_label, overrides) => {
    vi.useFakeTimers()
    const testEnvironment = environment(overrides)
    const task = vi.fn()

    scheduleIdleRouteWarmups([task], { environment: testEnvironment.runtime })
    vi.runAllTimers()

    expect(routeWarmupAllowed(testEnvironment.runtime)).toBe(false)
    expect(testEnvironment.runtime.window.requestIdleCallback).not.toHaveBeenCalled()
    expect(task).not.toHaveBeenCalled()
  })

  it('does not transfer at t=0 and starts only inside the delayed idle callback', async () => {
    vi.useFakeTimers()
    const testEnvironment = environment()
    const task = vi.fn()

    scheduleIdleRouteWarmups([task], { environment: testEnvironment.runtime })
    expect(task).not.toHaveBeenCalled()
    expect(testEnvironment.runtime.window.requestIdleCallback).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1_199)
    expect(task).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(testEnvironment.runtime.window.requestIdleCallback).toHaveBeenCalledTimes(1)
    expect(task).not.toHaveBeenCalled()

    testEnvironment.runNextIdle()
    await settleTask()
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('warms one task per idle turn and cancels the remaining queue when hidden', async () => {
    vi.useFakeTimers()
    const testEnvironment = environment()
    const tasks = [vi.fn(), vi.fn(), vi.fn()]

    scheduleIdleRouteWarmups(tasks, { environment: testEnvironment.runtime })
    vi.advanceTimersByTime(1_200)
    testEnvironment.runNextIdle()
    await settleTask()
    expect(tasks.map((task) => task.mock.calls.length)).toEqual([1, 0, 0])

    vi.advanceTimersByTime(180)
    expect(testEnvironment.idleCallbacks.size).toBe(1)
    testEnvironment.runNextIdle()
    await settleTask()
    expect(tasks.map((task) => task.mock.calls.length)).toEqual([1, 1, 0])

    vi.advanceTimersByTime(180)
    expect(testEnvironment.idleCallbacks.size).toBe(1)
    testEnvironment.hide()
    expect(testEnvironment.idleCallbacks.size).toBe(0)
    vi.runAllTimers()
    expect(tasks.map((task) => task.mock.calls.length)).toEqual([1, 1, 0])
  })

  it('cancels the delayed queue when the browser goes offline', () => {
    vi.useFakeTimers()
    const testEnvironment = environment()
    const task = vi.fn()

    scheduleIdleRouteWarmups([task], { environment: testEnvironment.runtime })
    testEnvironment.goOffline()
    vi.runAllTimers()

    expect(task).not.toHaveBeenCalled()
    expect(testEnvironment.runtime.window.requestIdleCallback).not.toHaveBeenCalled()
  })

  it('enforces the automatic task-count budget', async () => {
    vi.useFakeTimers()
    const testEnvironment = environment()
    const tasks = [vi.fn(), vi.fn(), vi.fn()]

    scheduleIdleRouteWarmups(tasks, {
      environment: testEnvironment.runtime,
      maxTasks: 2,
    })
    vi.advanceTimersByTime(1_200)
    testEnvironment.runNextIdle()
    await settleTask()
    vi.advanceTimersByTime(180)
    testEnvironment.runNextIdle()
    await settleTask()
    vi.runAllTimers()

    expect(tasks.map((task) => task.mock.calls.length)).toEqual([1, 1, 0])
  })
})
