import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { describe, expect, it } from 'vitest'
import { InfoTooltip } from './InfoTooltip'

describe('InfoTooltip', () => {
  it('opens only on activation and keeps the exit surface mounted', () => {
    render(<InfoTooltip content="Secondary explanation" label="More information" />)

    const trigger = screen.getByRole('button', { name: 'More information' })
    const tooltip = document.querySelector('.info-tooltip-portal')
    expect(tooltip).not.toBeNull()

    fireEvent.mouseEnter(trigger)
    fireEvent.focus(trigger)
    expect(tooltip).not.toHaveClass('is-open')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(trigger)
    expect(tooltip).toHaveTextContent('Secondary explanation')
    expect(tooltip).toHaveClass('is-open')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(trigger)
    expect(tooltip).not.toHaveClass('is-open')
    expect(tooltip).toHaveAttribute('aria-hidden', 'true')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('does not open on keyboard focus and supports Escape after activation', () => {
    render(<InfoTooltip content="Keyboard explanation" />)

    const trigger = screen.getByRole('button', { name: 'Keyboard explanation' })
    fireEvent.focus(trigger)
    expect(document.querySelector('.info-tooltip-portal')).not.toHaveClass('is-open')

    fireEvent.click(trigger)
    expect(screen.getByRole('tooltip')).toHaveClass('is-open')

    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes when the user activates something outside the information control', () => {
    render(
      <>
        <InfoTooltip content="Touch explanation" label="More information" />
        <button type="button">Outside action</button>
      </>,
    )

    const trigger = screen.getByRole('button', { name: 'More information' })
    fireEvent.click(trigger)

    expect(screen.getByRole('tooltip')).toHaveClass('is-open')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside action' }))
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })
})
