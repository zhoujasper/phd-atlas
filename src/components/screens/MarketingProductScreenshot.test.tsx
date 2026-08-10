import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MarketingProductScreenshot } from './MarketingProductScreenshot'

const originalMatchMedia = window.matchMedia

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: originalMatchMedia,
  })
})

describe('MarketingProductScreenshot', () => {
  it('uses the desktop capture when matchMedia is unavailable', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: undefined,
    })

    render(
      <MarketingProductScreenshot
        language="en"
        theme="light"
        alt="Checklist workspace"
      />,
    )

    expect(screen.getByRole('img', { name: 'Checklist workspace' }).getAttribute('src')).toBe(
      '/assets/product-tour/workspace-en-light.webp?v=2x-q82-20260801',
    )
  })
})
