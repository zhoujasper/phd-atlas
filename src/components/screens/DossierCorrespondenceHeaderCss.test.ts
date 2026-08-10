import { describe, expect, it } from 'vitest'
import dossierSource from './DossierView.tsx?raw'
import inlinePresenceSource from '../shared/InlinePresence.tsx?raw'
import dossierStyles from '../../index.css?raw'

const normalizedStyles = dossierStyles.replace(/\r\n/g, '\n')

function cssRule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = normalizedStyles.match(new RegExp(`(?:^|\\n)[\\t ]*${escaped}\\s*\\{([^}]*)\\}`))
  expect(match, `Missing CSS rule: ${selector}`).not.toBeNull()
  return match?.[1] ?? ''
}

describe('Dossier correspondence header layout', () => {
  it('keeps the record count beside the title and removes mailbox summary cards', () => {
    expect(dossierSource).toContain('className="correspondence-hero-title-row"')
    expect(dossierSource).toContain('className="correspondence-hero-count"')
    expect(dossierSource).not.toContain('className="correspondence-mailbox-row"')
    expect(normalizedStyles).not.toMatch(/(?:^|\n)\.correspondence-mailbox-(?:row|item)\s*\{/)

    const titleRow = cssRule('.correspondence-hero-title-row')
    const count = cssRule('.correspondence-hero-count')
    expect(titleRow).toContain('display: flex')
    expect(titleRow).toContain('align-items: baseline')
    expect(count).toContain('white-space: nowrap')
  })

  it('hands the category and AI controls off through measured enter and exit motion', () => {
    expect(dossierSource).toMatch(
      /<InlinePresence\s+as="div"\s+present=\{correspondenceView === 'all'\}\s+className="correspondence-category-filter-presence"/,
    )
    expect(dossierSource).toContain("data-filter-controls={correspondenceView === 'all' ? 'visible' : 'hidden'}")
    expect(dossierSource).toContain("disabled={correspondenceView !== 'all'}")
    expect(inlinePresenceSource).toContain("type InlinePresenceElement = 'span' | 'div'")
    expect(inlinePresenceSource).toContain("root.style.setProperty('--inline-presence-height'")

    const presence = cssRule('.correspondence-category-filter-presence')
    const hiddenPresence = cssRule(".correspondence-category-filter-presence[data-present='false']")
    expect(presence).toContain('contain: layout paint')
    expect(presence).toContain('transform-origin: right center')
    expect(hiddenPresence).toContain('transform: translate3d(8px, 0, 0) scale(0.97)')
    expect(normalizedStyles).toMatch(
      /@media \(max-width: 820px\)[\s\S]*?\.correspondence-category-filter-presence\s*\{[^}]*block-size:\s*var\(--inline-presence-height, 32px\)[^}]*\}[\s\S]*?\.correspondence-category-filter-presence\[data-present='false'\]\s*\{[^}]*block-size:\s*0[^}]*\}[\s\S]*?\.correspondence-view-controls\[data-filter-controls='hidden'\]\s*\{[^}]*row-gap:\s*0/,
    )
    expect(normalizedStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.inline-presence,[\s\S]*?transition-duration:\s*0\.01ms !important/,
    )
    expect(normalizedStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.correspondence-view-controls\s*\{[^}]*transition-duration:\s*0\.01ms !important/,
    )
  })
})
