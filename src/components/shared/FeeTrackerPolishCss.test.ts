import { describe, expect, it } from 'vitest'
import coreStyles from '../../index.css?raw'
import mobileStyles from '../../styles/mobile.css?raw'

describe('fee tracker visual hierarchy', () => {
  it('keeps saved status compact and semantic without tinting or fading the whole row', () => {
    expect(coreStyles).toMatch(
      /\.fee-status-summary\s*\{[^}]*min-height:\s*18px[^}]*gap:\s*5px[^}]*font-size:\s*11px/s,
    )
    expect(coreStyles).toMatch(
      /\.fee-status-summary-dot\s*\{[^}]*width:\s*6px[^}]*height:\s*6px[^}]*border-radius:\s*50%/s,
    )
    expect(coreStyles).not.toMatch(/\.fee-item\.waived:not\(\.editing\)\s*\{[^}]*opacity:/s)
    expect(coreStyles).not.toMatch(/\.fee-item\.paid\s*\{[^}]*border-color:/s)
  })

  it('uses one restrained segmented status control instead of separate large pills', () => {
    expect(coreStyles).toMatch(
      /\.fee-status-control\s*\{[^}]*position:\s*relative[^}]*min-height:\s*30px[^}]*grid-template-columns:\s*repeat\(var\(--fee-status-count\),\s*minmax\(0,\s*1fr\)\)[^}]*gap:\s*0[^}]*padding:\s*2px[^}]*border-radius:\s*var\(--radius\)/s,
    )
    expect(coreStyles).toMatch(
      /\.fee-status-option\s*\{[^}]*min-height:\s*24px[^}]*padding:\s*0 8px[^}]*font-size:\s*11px/s,
    )
    expect(coreStyles).toMatch(
      /\.fee-status-indicator\s*\{[^}]*width:\s*calc\(\(100% - 4px\) \/ var\(--fee-status-count\)\)[^}]*transform:\s*translate3d\(calc\(var\(--fee-status-index\) \* 100%\),\s*0,\s*0\)[^}]*transform var\(--duration\) var\(--ease-out\)/s,
    )
    expect(coreStyles).toMatch(
      /\.fee-status-option\.is-active\s*\{[^}]*background:\s*transparent[^}]*box-shadow:\s*none/s,
    )
    expect(coreStyles).not.toContain('.fee-state-toggle')
  })

  it('keeps fee fields on one measured height and anchors status in a stable row slot', () => {
    expect(coreStyles).toMatch(
      /\.fee-edit-status\s*\{[^}]*align-self:\s*stretch[^}]*grid-template-rows:\s*auto 36px/s,
    )
    expect(coreStyles).toMatch(
      /\.fee-edit-field input,\s*\.fee-edit-field \.custom-select-trigger\s*\{[^}]*height:\s*36px[^}]*min-height:\s*36px !important/s,
    )
    expect(coreStyles).toMatch(
      /\.fee-add-form > \.custom-select-root \.custom-select-trigger\s*\{[^}]*height:\s*36px[^}]*min-height:\s*36px !important/s,
    )
  })

  it('keeps the unsaved-choice actions compact instead of stretching them into tiles', () => {
    expect(coreStyles).toMatch(
      /\.fee-unsaved-actions\s*\{[^}]*gap:\s*7px[^}]*width:\s*100%/s,
    )
    expect(coreStyles).toMatch(
      /\.fee-unsaved-actions button\s*\{[^}]*min-width:\s*max-content[^}]*flex:\s*0 1 auto[^}]*min-height:\s*30px[^}]*padding-inline:\s*12px[^}]*font-size:\s*12px/s,
    )
    expect(coreStyles).not.toMatch(
      /@media \(max-width:\s*480px\)\s*\{[\s\S]*?\.fee-unsaved-actions\s*\{[^}]*flex-direction:\s*column/s,
    )
  })

  it('uses one transparent 28px icon language for row actions', () => {
    expect(coreStyles).toMatch(
      /\.fee-item-actions button\.fee-row-action\s*\{[^}]*width:\s*28px[^}]*height:\s*28px[^}]*padding:\s*0[^}]*border:\s*0[^}]*background:\s*transparent/s,
    )
    expect(coreStyles).toMatch(
      /\.fee-item-actions button\.fee-delete-action:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--danger-bg\)[^}]*color:\s*var\(--danger\)/s,
    )
    expect(coreStyles).toMatch(
      /\.fee-action-icon-stage > svg\s*\{[^}]*opacity 120ms[^}]*transform 150ms/s,
    )
  })

  it('keeps the grouped status control intact in compact layouts', () => {
    expect(mobileStyles).toMatch(
      /\.fee-edit-form\s*\{[^}]*grid-template-areas:\s*"amount currency"\s*"status status"\s*"date date"\s*"notes notes"\s*"actions actions"/s,
    )
    expect(mobileStyles).toMatch(
      /@media \(max-width:\s*360px\)\s*\{[\s\S]*?\.fee-add-status \.fee-status-option\s*\{[^}]*flex:\s*1 1 0/s,
    )
  })
})
