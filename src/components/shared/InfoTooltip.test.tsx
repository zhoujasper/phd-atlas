import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { describe, expect, it } from 'vitest'
import { InfoTooltip } from './InfoTooltip'

describe('InfoTooltip', () => {
  it('reveals secondary copy on hover and hides it without removing the exit surface', () => {
    render(<InfoTooltip content="Secondary explanation" label="More information" />)

    const trigger = screen.getByRole('button', { name: 'More information' })
    fireEvent.mouseEnter(trigger)

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('Secondary explanation')
    expect(tooltip).toHaveClass('is-open')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    fireEvent.mouseLeave(trigger)
    expect(tooltip).not.toHaveClass('is-open')
    expect(tooltip).toHaveAttribute('aria-hidden', 'true')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('supports keyboard focus and Escape', () => {
    render(<InfoTooltip content="Keyboard explanation" />)

    const trigger = screen.getByRole('button', { name: 'Keyboard explanation' })
    fireEvent.focus(trigger)
    expect(screen.getByRole('tooltip')).toHaveClass('is-open')

    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens when tapped without relying on browser focus behavior', () => {
    render(<InfoTooltip content="Touch explanation" label="More information" />)

    const trigger = screen.getByRole('button', { name: 'More information' })
    fireEvent.click(trigger)

    expect(screen.getByRole('tooltip')).toHaveClass('is-open')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })
})
