import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DiscreteLevelPicker } from './DiscreteLevelPicker'

describe('DiscreteLevelPicker', () => {
  it('selects a defined level through a draggable discrete slider', () => {
    const onChange = vi.fn()

    render(
      <DiscreteLevelPicker
        label="Minimum match"
        value={60}
        options={[0, 50, 60, 70, 80, 90]}
        suffix="%"
        onChange={onChange}
      />,
    )

    const slider = screen.getByRole('slider', { name: 'Minimum match' })
    expect(slider).toHaveAttribute('aria-valuetext', '60%')
    fireEvent.change(slider, { target: { value: '4' } })
    expect(onChange).toHaveBeenCalledWith(80)
  })

  it('keeps a previously saved custom value available until it is changed', () => {
    render(
      <DiscreteLevelPicker
        label="Minimum h-index"
        value={35}
        options={[0, 10, 20, 30, 40, 50]}
        onChange={vi.fn()}
      />,
    )

    const slider = screen.getByRole('slider', { name: 'Minimum h-index' })
    expect(slider).toHaveAttribute('aria-valuetext', '35')
    expect(slider).toHaveAttribute('max', '6')
  })
})
