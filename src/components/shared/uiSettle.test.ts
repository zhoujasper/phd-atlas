// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitForUiSettle } from './uiSettle'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('waitForUiSettle', () => {
  it('finishes through its captured Window after the global is removed', async () => {
    const browserWindow = window
    const frames: FrameRequestCallback[] = []
    const timers: TimerHandler[] = []

    vi.spyOn(browserWindow, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    vi.spyOn(browserWindow, 'setTimeout').mockImplementation(((callback: TimerHandler) => {
      timers.push(callback)
      return timers.length as unknown as ReturnType<typeof browserWindow.setTimeout>
    }) as unknown as typeof browserWindow.setTimeout)

    const settling = waitForUiSettle()
    vi.stubGlobal('window', undefined)

    expect(frames).toHaveLength(1)
    frames.shift()?.(0)
    expect(frames).toHaveLength(1)
    frames.shift()?.(0)
    expect(timers).toHaveLength(2)
    const fallback = timers[1]
    if (typeof fallback === 'function') fallback()

    await expect(settling).resolves.toBeUndefined()
  })
})
