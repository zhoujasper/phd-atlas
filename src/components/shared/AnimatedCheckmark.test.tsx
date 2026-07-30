import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AnimatedCheckmark } from './AnimatedCheckmark'

describe('AnimatedCheckmark', () => {
  it('keeps one mounted SVG while its checked state changes', () => {
    const view = render(<AnimatedCheckmark checked={false} />)
    const initial = view.container.querySelector('svg')

    expect(initial?.classList.contains('is-checked')).toBe(false)
    expect(view.container.querySelector('.animated-checkmark-tick')).not.toBeNull()

    view.rerender(<AnimatedCheckmark checked />)

    const checked = view.container.querySelector('svg')
    expect(checked).toBe(initial)
    expect(checked?.classList.contains('is-checked')).toBe(true)
  })

  it('supports the rounded-square treatment used by the workspace preview', () => {
    const view = render(<AnimatedCheckmark checked variant="square" size={16} />)

    expect(view.container.querySelector('rect.animated-checkmark-shape')).not.toBeNull()
    expect(view.container.querySelector('circle.animated-checkmark-shape')).toBeNull()
  })
})
