import { describe, expect, it } from 'vitest'
import profileStyles from '../../index.css?raw'
import aiStyles from '../../styles/ai.css?raw'

const styles = `${profileStyles}\n${aiStyles}`.replace(/\r\n/g, '\n')

function cssRule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = styles.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))
  expect(match, `Missing CSS rule: ${selector}`).not.toBeNull()
  return match?.[1] ?? ''
}

describe('profile header layout CSS', () => {
  it('keeps the title information control centered beside the title itself', () => {
    const titleRow = cssRule('.profile-heading-title-row')
    const info = cssRule('.profile-header-info')

    expect(titleRow).toContain('display: flex')
    expect(titleRow).toContain('align-items: center')
    expect(titleRow).toContain('gap: 4px')
    expect(info).toContain('display: inline-flex')
    expect(info).toContain('margin-top: 3px')
  })

  it('keeps the personal profile shortcut compact on desktop', () => {
    const hero = cssRule('.profile-hero')
    const summary = cssRule('.ai-profile-summary')
    const progress = cssRule('.ai-profile-progress')
    const title = cssRule('.ai-profile-copy strong')

    expect(hero).toContain('minmax(218px, 244px)')
    expect(hero).toContain('gap: 16px')
    expect(summary).toContain('min-height: 44px')
    expect(summary).toContain('grid-template-columns: 24px minmax(0, 1fr) auto')
    expect(summary).toContain('padding: 6px 9px')
    expect(progress).toContain('width: 32px')
    expect(progress).toContain('height: 32px')
    expect(title).toContain('margin: 0')
    expect(title).toContain('font-size: 14px')
  })
})
