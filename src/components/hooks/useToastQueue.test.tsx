import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useToastQueue } from './useToastQueue'

describe('useToastQueue', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps five active notices and smoothly retires the oldest overflow item', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useToastQueue())

    act(() => {
      for (let index = 1; index <= 6; index += 1) result.current.notify(`Notice ${index}`)
    })

    expect(result.current.toasts.filter((toast) => !toast.exiting)).toHaveLength(5)
    expect(result.current.toasts.find((toast) => toast.message === 'Notice 1')?.exiting).toBe(true)

    act(() => vi.advanceTimersByTime(220))
    expect(result.current.toasts).toHaveLength(5)
    expect(result.current.toasts.some((toast) => toast.message === 'Notice 1')).toBe(false)
  })

  it('pauses only the hovered notice and resumes its remaining lifetime', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useToastQueue())
    let heldId = 0

    act(() => {
      heldId = result.current.notify('Held notice')
      result.current.notify('Other notice')
      vi.advanceTimersByTime(900)
      result.current.pauseToast(heldId)
      vi.advanceTimersByTime(1_200)
    })

    expect(result.current.toasts.some((toast) => toast.id === heldId)).toBe(true)
    expect(result.current.toasts.some((toast) => toast.message === 'Other notice')).toBe(false)

    act(() => {
      result.current.resumeToast(heldId)
      vi.advanceTimersByTime(1_200)
    })
    expect(result.current.toasts.some((toast) => toast.id === heldId)).toBe(false)
  })
})
