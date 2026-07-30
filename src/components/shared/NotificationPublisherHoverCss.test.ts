import { describe, expect, it } from 'vitest'
import coreStyles from '../../index.css?raw'

const normalizedStyles = coreStyles.replace(/\r\n/g, '\n')

function cssRule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = normalizedStyles.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))
  expect(match, `Missing CSS rule: ${selector}`).not.toBeNull()
  return match?.[1] ?? ''
}

describe('notification recipient hover treatment', () => {
  it('uses a flat neutral wash without a grey frame or shadow', () => {
    const row = cssRule('.notification-publisher-recipient')
    const hover = cssRule('.notification-publisher-recipient:hover')
    const keyboardFocus = cssRule(
      '.notification-publisher-recipient input:focus-visible + .notification-publisher-recipient-check',
    )

    expect(row).toContain('border: 1px solid transparent')
    expect(row).toContain('background: transparent')
    expect(hover).toContain('border-color: transparent')
    expect(hover).toContain('color-mix(in srgb, var(--text) 4%, transparent)')
    expect(hover).not.toContain('box-shadow')
    expect(hover).not.toContain('var(--border)')
    expect(keyboardFocus).toContain('box-shadow: 0 0 0 3px var(--accent-ring)')
  })
})
