import { describe, expect, it } from 'vitest'
import workspaceStyles from '../../index.css?raw'
import mobileStyles from '../../styles/mobile.css?raw'

describe('application workspace requested UI polish', () => {
  it('uses a compact three-column sorting grid and smaller status controls', () => {
    expect(workspaceStyles).toMatch(
      /\.sort-list\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)[^}]*gap:\s*4px/s,
    )
    expect(workspaceStyles).toMatch(
      /\.sort-chip\s*\{[^}]*min-height:\s*26px[^}]*padding:\s*0 7px[^}]*font-size:\s*11px/s,
    )
    expect(workspaceStyles).toMatch(
      /\.status-filter button,[\s\S]*?\.backup-list button\s*\{[^}]*min-height:\s*26px[^}]*padding:\s*0 10px[^}]*font-size:\s*11px/s,
    )
    expect(mobileStyles).toMatch(
      /\.status-filter button\s*\{[^}]*min-height:\s*32px[^}]*padding-inline:\s*11px/s,
    )
  })

  it('animates the owner picker surface without transforming its scroll container', () => {
    expect(workspaceStyles).toMatch(
      /\.owner-picker-menu-surface\s*\{[^}]*box-shadow:\s*var\(--shadow-sm\)[^}]*animation:\s*owner-picker-menu-in var\(--duration\)/s,
    )
    expect(workspaceStyles).toMatch(
      /\.owner-picker-menu-content\s*\{[^}]*clip-path:\s*inset\(0 round var\(--radius\)\)[^}]*animation:\s*owner-picker-menu-content-in var\(--duration\)/s,
    )
    expect(workspaceStyles).toMatch(
      /\.owner-picker\.exiting \.owner-picker-menu-surface\s*\{[^}]*owner-picker-menu-out var\(--duration-popover\)/s,
    )
    expect(workspaceStyles).toMatch(
      /@keyframes owner-picker-menu-content-in\s*\{[\s\S]*?clip-path:\s*inset\(0 0 100% 0 round var\(--radius\)\)[\s\S]*?clip-path:\s*inset\(0 round var\(--radius\)\)/,
    )
    expect(workspaceStyles).not.toMatch(
      /\.owner-picker-menu-surface\s*\{[^}]*transform:/s,
    )
  })

  it('switches the student board to measured masonry rows once card heights are known', () => {
    expect(workspaceStyles).toMatch(
      /\.team-kanban-grid\s*\{[^}]*--team-kanban-card-gap:\s*12px[^}]*grid-template-columns:\s*repeat\(auto-fill,/s,
    )
    expect(workspaceStyles).toMatch(
      /\.team-kanban-grid\.is-masonry-ready\s*\{[^}]*grid-auto-rows:\s*var\(--team-kanban-masonry-row-unit\)[^}]*row-gap:\s*var\(--team-kanban-masonry-track-gap\)/s,
    )
    expect(workspaceStyles).toMatch(
      /\.team-kanban-grid\.is-masonry-ready \.team-kanban-student\s*\{[^}]*grid-row-end:\s*span var\(--team-kanban-masonry-span,\s*1\)/s,
    )
  })

  it('keeps the checklist reminder count secondary while measured presence owns the label motion', () => {
    expect(workspaceStyles).toMatch(
      /\.checklist-reminder-filter-count\s*\{[^}]*font-size:\s*10px[^}]*font-variant-numeric:\s*tabular-nums[^}]*line-height:\s*1/s,
    )
    expect(workspaceStyles).toMatch(
      /\.checklist-reminder-filter-label\s*\{[^}]*flex:\s*0 0 auto[^}]*font-size:\s*11px[^}]*line-height:\s*1/s,
    )
    expect(workspaceStyles).not.toMatch(
      /\.checklist-reminder-filter-label\s*\{[^}]*max-width:\s*0[^}]*transition:[^}]*max-width/s,
    )
  })
})
