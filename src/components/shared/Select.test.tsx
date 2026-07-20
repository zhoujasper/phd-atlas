import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Select } from './Select'

const originalInnerWidth = window.innerWidth
const originalInnerHeight = window.innerHeight
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView

describe('Select', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight })
    if (originalScrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: originalScrollIntoView })
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    }
  })

  it('keeps the options anchored to the trigger on mobile', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('custom-select-root')) return new DOMRect(220, 260, 136, 36)
      if (this.classList.contains('custom-select-dropdown')) return new DOMRect(220, 300, 160, 286)
      return new DOMRect()
    })
    const user = userEvent.setup()

    render(
      <Select
        value="one"
        options={[
          { value: 'one', label: 'One' },
          { value: 'two', label: 'Two' },
        ]}
        onChange={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button'))

    expect(screen.getByRole('listbox')).toHaveStyle({
      position: 'fixed',
      left: '220px',
      top: '300px',
      bottom: 'auto',
      width: '160px',
    })
    rectSpy.mockRestore()
  })
})
