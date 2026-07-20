import { afterEach, describe, expect, it, vi } from 'vitest'
import { getMotionDelay } from './useAnimatedClose'

const originalMatchMedia = window.matchMedia

describe('getMotionDelay', () => {
  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: originalMatchMedia,
    })
  })

  it('preserves the requested duration when motion is allowed', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    })

    expect(getMotionDelay(160)).toBe(160)
  })

  it('removes the wait when reduced motion is preferred', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    })

    expect(getMotionDelay(160)).toBe(0)
  })
})
