import { describe, expect, it } from 'vitest'
import coreStyles from '../../index.css?raw'

const normalizedStyles = coreStyles.replace(/\r\n/g, '\n')

function cssRule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = normalizedStyles.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))
  expect(match, `Missing CSS rule: ${selector}`).not.toBeNull()
  return match?.[1] ?? ''
}

describe('creatable Select visual polish', () => {
  it('uses small transparent rename and delete actions in every custom option row', () => {
    const row = cssRule('.custom-select-option-row.custom > .custom-select-option')
    const actions = cssRule('.custom-select-option-actions')
    const buttons = cssRule('.custom-select-option-actions button')
    const hover = cssRule('.custom-select-option-actions button:hover')
    const active = cssRule('.custom-select-option-actions button:active')
    const focus = cssRule('.custom-select-option-actions button:focus-visible')

    // At rest the checkmark owns the row end; the gap only opens on hover.
    expect(row).toContain('padding-right: 10px')
    expect(row).toContain('padding-right var(--duration)')
    expect(actions).toContain('opacity: 0')
    expect(actions).toContain('pointer-events: none')
    expect(actions).toContain('translate3d(12px, -50%, 0)')
    expect(buttons).toContain('width: 22px')
    expect(buttons).toContain('height: 22px')
    expect(buttons).toContain('border: 0')
    expect(buttons).toContain('background: transparent')
    expect(buttons).toContain('box-shadow: none')
    expect(hover).toContain('background: transparent')
    expect(active).toContain('background: transparent')
    expect(active).toContain('transform: scale(0.88)')
    expect(focus).toContain('background: transparent')
    expect(focus).toContain('var(--accent-ring)')
  })

  it('morphs the add row into one compact integrated editor without a nested white card', () => {
    const stage = cssRule('.custom-select-create-stage')
    const editingStage = cssRule('.custom-select-create-stage.is-editing')
    const addAction = cssRule('.custom-select-create-option')
    const hiddenAddAction = cssRule('.custom-select-create-stage.is-editing .custom-select-create-option')
    const panel = cssRule('.custom-select-create-panel')
    const visiblePanel = cssRule('.custom-select-create-stage.is-editing .custom-select-create-panel')
    const input = cssRule('.custom-select-create-panel input')
    const buttons = cssRule('.custom-select-create-panel button')
    const confirm = cssRule('.custom-select-create-panel button.confirm')
    const hover = cssRule('.custom-select-create-panel button:hover')
    const active = cssRule('.custom-select-create-panel button:active')

    expect(stage).toContain('flex: 0 0 36px')
    expect(stage).toContain('height: 36px')
    expect(stage).toContain('background: transparent')
    expect(editingStage).toContain('flex-basis: 42px')
    expect(editingStage).toContain('height: 42px')
    expect(addAction).toContain('background: transparent')
    expect(addAction).toContain('opacity 190ms')
    expect(hiddenAddAction).toContain('opacity 150ms')
    expect(hiddenAddAction).toContain('translate3d(-4px, 0, 0)')
    expect(panel).toContain('grid-template-columns: minmax(0, 1fr) 22px 22px')
    expect(panel).toContain('border: 0')
    expect(panel).toContain('background: transparent')
    expect(panel).toContain('box-shadow: none')
    expect(panel).toContain('translate3d(4px, 0, 0)')
    expect(visiblePanel).toContain('opacity 190ms')
    // Compact field with real breathing room above and below it.
    expect(panel).toContain('inset: 6px 8px')
    expect(input).toContain('height: 30px')
    expect(input).toContain('background: var(--surface-secondary)')
    expect(buttons).toContain('width: 22px')
    expect(buttons).toContain('height: 22px')
    expect(buttons).toContain('background: transparent')
    expect(confirm).toContain('background: transparent')
    expect(hover).toContain('background: transparent')
    expect(active).toContain('background: transparent')
    expect(active).toContain('transform: scale(0.88)')
  })

  it('keeps coarse-pointer controls visually quiet while preserving a larger hit area', () => {
    expect(normalizedStyles).toMatch(
      /@media \(hover: none\), \(pointer: coarse\)\s*\{[\s\S]*?\.custom-select-option-actions button\s*\{[^}]*width:\s*28px[^}]*height:\s*28px/s,
    )
    expect(normalizedStyles).toMatch(
      /@media \(hover: none\), \(pointer: coarse\)\s*\{[\s\S]*?\.custom-select-create-panel button\s*\{[^}]*width:\s*28px[^}]*height:\s*28px/s,
    )
    expect(normalizedStyles).toMatch(
      /@media \(hover: none\), \(pointer: coarse\)\s*\{[\s\S]*?\.custom-select-create-stage\.is-editing\s*\{[^}]*flex-basis:\s*46px[^}]*height:\s*46px/s,
    )
    expect(normalizedStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\*,\s*\*::before,\s*\*::after\s*\{[^}]*transition-duration:\s*0\.01ms !important[^}]*animation-duration:\s*0\.01ms !important/s,
    )
  })
})
