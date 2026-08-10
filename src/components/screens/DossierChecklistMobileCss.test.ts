import { describe, expect, it } from 'vitest'
import workspaceStyles from '../../index.css?raw'
import mobileStyles from '../../styles/mobile.css?raw'
import dossierSource from './DossierView.tsx?raw'

const normalizedWorkspaceStyles = workspaceStyles.replace(/\r\n/g, '\n')
const normalizedMobileStyles = mobileStyles.replace(/\r\n/g, '\n')
const mobileChecklistStyles = normalizedMobileStyles.match(
  /\/\* Materials\/tasks stay dense enough to scan on a phone\.[\s\S]*?\/\* Shared mobile control rhythm\./,
)?.[0] ?? ''

describe('mobile checklist hierarchy', () => {
  it('aligns the desktop title with its actions and keeps a compact two-row phone handoff', () => {
    expect(dossierSource).not.toContain("tx('dossier.checklistEyebrow')")
    expect(normalizedWorkspaceStyles).toMatch(
      /\.checklist-hero\s*\{[^}]*align-items:\s*center;/s,
    )
    expect(normalizedWorkspaceStyles).toMatch(
      /\.checklist-hero-info h3\s*\{[^}]*margin:\s*0;/s,
    )
    expect(mobileChecklistStyles).toMatch(
      /\.checklist-hero\s*\{[^}]*grid-template-areas:\s*"title"\s*"actions";/s,
    )
    expect(mobileChecklistStyles).not.toMatch(/grid-area:\s*eyebrow|"eyebrow"/)
    expect(mobileChecklistStyles).toMatch(
      /\.checklist-hero-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto auto;[^}]*gap:\s*4px;/s,
    )
    expect(mobileChecklistStyles).toMatch(
      /body \.checklist-hero button\.checklist-reminder-filter-btn,[\s\S]*?border-left:\s*0;/,
    )
    expect(mobileChecklistStyles).not.toMatch(/border-left:\s*1px/)
  })

  it('keeps desktop tools visible while phones use one accessible disclosure', () => {
    expect(normalizedWorkspaceStyles).toMatch(
      /\.checklist-mobile-tools-toggle\s*\{\s*display:\s*none;/,
    )
    expect(mobileChecklistStyles).toMatch(
      /\.checklist-mobile-tools-toggle\s*\{[^}]*display:\s*grid;[^}]*border-top:\s*1px solid var\(--border\);/s,
    )
    expect(dossierSource).toContain('aria-controls="checklist-tool-panel"')
    expect(dossierSource).toContain('open={!checklistToolsCompact || checklistToolsOpen}')
    expect(dossierSource).toContain('className="checklist-mobile-tools-count"')
  })

  it('keeps the translated task heading and complete action together whenever they fit', () => {
    expect(normalizedWorkspaceStyles).not.toMatch(
      /\.checklist-hero-actions,\s*\.checklist-config-row,\s*\.checklist-header-actions\s*\{[^}]*width:\s*100%;/s,
    )
    expect(normalizedWorkspaceStyles).toMatch(
      /\.checklist-task-section \.checklist-group-header\s*\{[^}]*flex-wrap:\s*wrap;[^}]*column-gap:\s*8px;[^}]*row-gap:\s*4px;/s,
    )
    expect(normalizedWorkspaceStyles).toMatch(
      /\.checklist-task-section \.checklist-group-header > span:first-child\s*\{[^}]*flex:\s*0 0 auto;[^}]*white-space:\s*nowrap;/s,
    )
    expect(normalizedWorkspaceStyles).toMatch(
      /\.checklist-header-actions\s*\{[^}]*width:\s*auto;[^}]*flex:\s*0 0 auto;[^}]*flex-wrap:\s*nowrap;[^}]*margin-inline-start:\s*auto;/s,
    )
  })
})
