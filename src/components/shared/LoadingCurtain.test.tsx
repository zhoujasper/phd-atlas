import '@testing-library/jest-dom/vitest'
import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import loadingStyles from '../../styles/loading.css?raw'
import { LoadingCurtain } from './LaunchScreen'

afterEach(() => {
  vi.useRealTimers()
})

describe('LoadingCurtain mobile rail persistence', () => {
  it('keeps the resident rail uncovered through the handoff exit', () => {
    vi.useFakeTimers()

    const { container, rerender } = render(
      <LoadingCurtain
        loading
        preserveMobileRail
        minimumVisibleMs={0}
        exitDurationMs={120}
      />,
    )

    expect(container.querySelector('.launch-screen')).toHaveClass('preserve-mobile-rail')

    rerender(
      <LoadingCurtain
        loading={false}
        preserveMobileRail={false}
        minimumVisibleMs={0}
        exitDurationMs={120}
      />,
    )

    expect(container.querySelector('.launch-screen')).toHaveClass('preserve-mobile-rail')

    act(() => {
      vi.runAllTimers()
    })

    expect(container.querySelector('.launch-screen')).not.toBeInTheDocument()
  })

  it('leaves the cold-start curtain full-screen', () => {
    const { container } = render(<LoadingCurtain loading />)

    expect(container.querySelector('.launch-screen')).not.toHaveClass('preserve-mobile-rail')
  })

  it('reserves the real mobile rail footprint and removes the skeleton rail', () => {
    const normalizedStyles = loadingStyles.replace(/\r\n/g, '\n')

    expect(normalizedStyles).toMatch(
      /\.launch-screen\.is-overlay\.preserve-mobile-rail\s*\{[^}]*bottom:\s*calc\(var\(--mobile-tab-bar-height,\s*64px\) \+ env\(safe-area-inset-bottom,\s*0px\)\);[^}]*height:\s*auto;[^}]*min-height:\s*0;/s,
    )
    expect(normalizedStyles).toMatch(
      /\.launch-screen\.is-overlay\.preserve-mobile-rail \.launch-rail\s*\{[^}]*display:\s*none;/s,
    )
  })
})
