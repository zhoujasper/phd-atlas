import { describe, expect, it } from 'vitest'
import dossierSource from './DossierView.tsx?raw'
import dossierStyles from '../../index.css?raw'

const normalizedStyles = dossierStyles.replace(/\r\n/g, '\n')

function cssRule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = normalizedStyles.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))
  expect(match, `Missing CSS rule: ${selector}`).not.toBeNull()
  return match?.[1] ?? ''
}

describe('Scholarship timeline editor polish', () => {
  it('uses a measured entry shell and hands focus to the new title field', () => {
    const presence = cssRule('.scholarship-timeline-row-presence')
    const openPresence = cssRule('.scholarship-timeline-row-presence.open')

    expect(dossierSource).toContain('function ScholarshipTimelineEditorRow')
    expect(dossierSource).toContain('data-timeline-title-input="true"')
    expect(dossierSource).toContain('?.focus({ preventScroll: true })')
    expect(presence).toContain('grid-template-rows: 0fr')
    expect(presence).toContain('grid-template-rows 360ms var(--ease-fluid)')
    expect(openPresence).toContain('grid-template-rows: 1fr')
  })

  it('keeps every editable value labeled and visibly field-shaped', () => {
    const field = cssRule('.scholarship-timeline-field')
    const control = cssRule('.scholarship-timeline-text-control')
    const focusedControl = cssRule('.scholarship-timeline-text-control:focus-within')

    expect(dossierSource).toContain("tx('dossier.eventTitle')")
    expect(dossierSource).toContain("tx('dossier.eventDate')")
    expect(dossierSource).toContain("tx('dossier.eventNote')")
    expect(dossierSource).toContain('<PencilLine size={12} aria-hidden="true" />')
    expect(field).toContain('display: grid')
    expect(control).toContain('border: 1px solid var(--border)')
    expect(control).toContain('background: var(--surface)')
    expect(focusedControl).toContain('border-color: var(--accent)')
  })

  it('uses container-owned responsive layouts and an immediate reduced-motion path', () => {
    expect(normalizedStyles).toMatch(
      /@container \(max-width:\s*620px\)\s*\{[\s\S]*?\.scholarship-mini-row\.timeline-row\s*\{[^}]*"title date remove"[^}]*"note note note"/s,
    )
    expect(normalizedStyles).toMatch(
      /@container \(max-width:\s*360px\)\s*\{[\s\S]*?\.scholarship-mini-row\.timeline-row\s*\{[^}]*"title remove"[^}]*"date date"[^}]*"note note"/s,
    )
    expect(normalizedStyles).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.scholarship-timeline-row-presence,[\s\S]*?transition-duration:\s*0\.01ms !important/s,
    )
  })
})
