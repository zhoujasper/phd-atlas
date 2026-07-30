import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applications, type ApplicationRecord } from '../../data/applications'
import {
  useApplicationAutoSave,
  type ApplicationAutoSaveResult,
} from './useApplicationAutoSave'

function applicationWithProgram(program: string): ApplicationRecord {
  return {
    ...structuredClone(applications[0]),
    program,
  }
}

describe('useApplicationAutoSave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('coalesces a burst of text edits and persists only the newest draft', async () => {
    const persist = vi.fn<(application: ApplicationRecord) => Promise<ApplicationAutoSaveResult>>()
      .mockResolvedValue({ status: 'saved' })
    const { result } = renderHook(() => useApplicationAutoSave({
      enabled: true,
      persist,
      settleMs: 1_200,
      maxWaitMs: 8_000,
    }))

    act(() => {
      result.current.schedule(applicationWithProgram('M'))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700)
    })
    act(() => {
      result.current.schedule(applicationWithProgram('Machine Learning'))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_199)
    })
    expect(persist).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(persist).toHaveBeenCalledTimes(1)
    expect(persist.mock.calls[0]?.[0].program).toBe('Machine Learning')
    expect(result.current.status.phase).toBe('saved')
  })

  it('flushes deterministic controls immediately', async () => {
    const persist = vi.fn<(application: ApplicationRecord) => Promise<ApplicationAutoSaveResult>>()
      .mockResolvedValue({ status: 'saved' })
    const { result } = renderHook(() => useApplicationAutoSave({
      enabled: true,
      persist,
    }))

    act(() => {
      result.current.schedule(applicationWithProgram('Status changed'), 'immediate')
    })
    expect(result.current.status.phase).toBe('pending')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(persist).toHaveBeenCalledTimes(1)
    expect(result.current.status.phase).toBe('saved')
  })

  it('caps a continuous edit burst at the maximum wait', async () => {
    const persist = vi.fn<(application: ApplicationRecord) => Promise<ApplicationAutoSaveResult>>()
      .mockResolvedValue({ status: 'saved' })
    const { result } = renderHook(() => useApplicationAutoSave({
      enabled: true,
      persist,
      settleMs: 1_200,
      maxWaitMs: 8_000,
    }))

    act(() => {
      result.current.schedule(applicationWithProgram('Edit 0'))
    })
    for (let index = 1; index <= 7; index += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000)
      })
      act(() => {
        result.current.schedule(applicationWithProgram(`Edit ${index}`))
      })
    }
    expect(persist).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(persist).toHaveBeenCalledTimes(1)
    expect(persist.mock.calls[0]?.[0].program).toBe('Edit 7')
  })

  it('runs one trailing save for edits made during an in-flight request', async () => {
    let resolveFirst: ((result: ApplicationAutoSaveResult) => void) | undefined
    const firstRequest = new Promise<ApplicationAutoSaveResult>((resolve) => {
      resolveFirst = resolve
    })
    const persist = vi.fn()
      .mockImplementationOnce(() => firstRequest)
      .mockResolvedValue({ status: 'saved' } satisfies ApplicationAutoSaveResult)
    const { result } = renderHook(() => useApplicationAutoSave({
      enabled: true,
      persist,
    }))

    act(() => {
      result.current.schedule(applicationWithProgram('First'), 'immediate')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(persist).toHaveBeenCalledTimes(1)

    act(() => {
      result.current.schedule(applicationWithProgram('Trailing'), 'immediate')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(persist).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveFirst?.({ status: 'saved' })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(persist).toHaveBeenCalledTimes(2)
    expect(persist.mock.calls[1]?.[0].program).toBe('Trailing')
  })

  it('keeps a failed draft retryable without scheduling extra requests', async () => {
    const persist = vi.fn()
      .mockResolvedValueOnce({ status: 'error', message: 'Save failed' } satisfies ApplicationAutoSaveResult)
      .mockResolvedValueOnce({ status: 'saved' } satisfies ApplicationAutoSaveResult)
    const { result } = renderHook(() => useApplicationAutoSave({
      enabled: true,
      persist,
    }))

    act(() => {
      result.current.schedule(applicationWithProgram('Retry me'), 'immediate')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.status).toEqual({
      phase: 'error',
      message: 'Save failed',
      retryable: true,
    })
    expect(persist).toHaveBeenCalledTimes(1)

    await act(async () => {
      await result.current.retry()
    })
    expect(persist).toHaveBeenCalledTimes(2)
    expect(result.current.status.phase).toBe('saved')
  })

  it('does not expose a raw rejected Error message through the localized save surface', async () => {
    const persist = vi.fn()
      .mockRejectedValue(new Error('internal database detail'))
    const { result } = renderHook(() => useApplicationAutoSave({
      enabled: true,
      persist,
    }))

    act(() => {
      result.current.schedule(applicationWithProgram('Localized failure'), 'immediate')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.status).toEqual({
      phase: 'error',
      message: undefined,
      retryable: true,
    })
  })

  it('retains an externally failed full-draft save for an explicit retry', async () => {
    const persist = vi.fn()
      .mockResolvedValue({ status: 'saved' } satisfies ApplicationAutoSaveResult)
    const { result } = renderHook(() => useApplicationAutoSave({
      enabled: true,
      persist,
    }))
    const failedDraft = applicationWithProgram('Keep this edit')

    act(() => {
      result.current.retainFailedDraft(failedDraft, 'Network unavailable')
    })
    expect(result.current.status).toEqual({
      phase: 'error',
      message: 'Network unavailable',
      retryable: true,
    })
    expect(persist).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.retry()
    })
    expect(persist).toHaveBeenCalledTimes(1)
    expect(persist.mock.calls[0]?.[0].program).toBe('Keep this edit')
    expect(result.current.status.phase).toBe('saved')
  })
})
