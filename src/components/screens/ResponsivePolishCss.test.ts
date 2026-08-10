import { describe, expect, it } from 'vitest'
import coreStyles from '../../index.css?raw'
import discoverStyles from '../../styles/discover.css?raw'
import mobileStyles from '../../styles/mobile.css?raw'
import settingsStyles from '../../styles/settings.css?raw'
import kanbanBoardSource from './KanbanBoard.tsx?raw'

describe('requested responsive polish CSS', () => {
  it('keeps usage pills compact and phone exports in two columns', () => {
    expect(coreStyles).toMatch(/\.storage-usage-card\s*\{[^}]*align-content:\s*start/s)
    expect(coreStyles).toMatch(/\.storage-usage-meta\s*\{[^}]*align-self:\s*start[^}]*align-items:\s*flex-start/s)
    expect(coreStyles).toMatch(/\.storage-usage-meta span\s*\{[^}]*height:\s*16px[^}]*min-height:\s*16px[^}]*align-self:\s*flex-start[^}]*flex:\s*0 0 auto[^}]*padding:\s*0 5px[^}]*font-size:\s*10px[^}]*line-height:\s*1/s)
    expect(coreStyles).toMatch(/@media \(max-width: 560px\)\s*\{[\s\S]*?\.settings-export-formats\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
  })

  it('keeps near-end settings reveals compositor-only and motion-safe', () => {
    expect(coreStyles).toMatch(/@keyframes settings-lazy-group-in\s*\{[\s\S]*?opacity:\s*0;[\s\S]*?translate3d\(0,\s*10px,\s*0\)[\s\S]*?opacity:\s*1;[\s\S]*?transform:\s*none/)
    expect(coreStyles).toMatch(/\.settings-progressive-group\.settings-lazy-reveal,[\s\S]*?animation:\s*settings-lazy-group-in 320ms var\(--ease-fluid\) backwards/)
    expect(coreStyles).toMatch(/\.settings-progressive-sentinel\s*\{[^}]*height:\s*1px[^}]*pointer-events:\s*none/s)
    expect(coreStyles).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.settings-progressive-group\.settings-lazy-reveal,[\s\S]*?animation:\s*none/)
  })

  it('keeps SMTP actions on one row and balances the incoming connection columns', () => {
    expect(settingsStyles).toMatch(/\.mail-incoming-fields\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s)
    expect(settingsStyles).toMatch(/\.mail-config-card-outgoing \.mail-config-button-row\s*\{[^}]*flex:\s*0 0 auto[^}]*flex-wrap:\s*nowrap[^}]*max-width:\s*100%/s)
  })

  it('gives the mobile icon chooser one momentum scroll surface', () => {
    expect(coreStyles).toMatch(/\.profile-preset-icon-options\s*\{[^}]*overscroll-behavior:\s*contain[^}]*-webkit-overflow-scrolling:\s*touch[^}]*touch-action:\s*pan-y/s)
    expect(coreStyles).toMatch(/\.profile-preset-identity-popover\s*\{[^}]*overflow:\s*hidden/s)
  })

  it('keeps the Discover refresh control compact and optically centered', () => {
    expect(mobileStyles).toMatch(/\.discover-toolbar-actions \.discover-research-trigger\s*\{[^}]*width:\s*var\(--mobile-icon-control-size\)[^}]*height:\s*var\(--mobile-icon-control-size\)[^}]*display:\s*grid[^}]*place-items:\s*center[^}]*padding:\s*0/s)
    expect(mobileStyles).toMatch(/\.discover-toolbar-actions,\s*\.discover-toolbar-filter-actions\s*\{[^}]*align-self:\s*center[^}]*margin-bottom:\s*0/s)
    expect(mobileStyles).toMatch(/\.discover-research-trigger > svg\s*\{[^}]*width:\s*14px[^}]*height:\s*14px/s)
  })

  it('keeps the mobile board header compact and moves both view guides into info disclosure', () => {
    expect(mobileStyles).toMatch(/\.kanban-hero\s*\{[^}]*position:\s*relative[^}]*padding-right:\s*0/s)
    expect(kanbanBoardSource).toContain('className="application-pipeline-title-row"')
    expect(kanbanBoardSource).toContain("content={tx(tableHeading ? 'kanban.tableSubtitle' : 'kanban.subtitle')}")
    expect(kanbanBoardSource).not.toContain("<p>{tx('kanban.subtitle')}</p>")
    expect(kanbanBoardSource).not.toContain('className="kanban-mobile-new"')
    expect(kanbanBoardSource).not.toContain('className="kanban-summary"')
    expect(mobileStyles).not.toContain('kanban-mobile-new')
    expect(mobileStyles).not.toContain('kanban-summary')
  })

  it('fits research and filter sheets into the same safe mobile viewport without duplicate gaps', () => {
    expect(discoverStyles).toMatch(/\.discover-sheet-backdrop\s*\{[^}]*padding-top:[^;]*safe-area-inset-top[^}]*padding-bottom:[^;]*mobile-tab-bar-height/s)
    expect(discoverStyles).toMatch(/\.discover-side-sheet\s*\{[^}]*position:\s*relative[^}]*height:\s*100%[^}]*max-height:\s*none/s)
    expect(discoverStyles).toMatch(/\.discover-mobile-overlay\s*\{[^}]*align-items:\s*stretch[^}]*padding-top:[^;]*safe-area-inset-top[^}]*padding-bottom:[^;]*mobile-tab-bar-height/s)
    expect(discoverStyles).toMatch(/\.discover-mobile-overlay \.discover-filter-rail\.is-mobile\s*\{[^}]*height:\s*100%[^}]*max-height:\s*none[^}]*margin-bottom:\s*0/s)
    expect(mobileStyles).toMatch(/\.discover-sheet-backdrop \.discover-side-sheet\s*\{[^}]*bottom:\s*auto/s)
    expect(mobileStyles).toMatch(/\.discover-mobile-overlay \.discover-filter-rail\.is-mobile\s*\{[^}]*margin-bottom:\s*0/s)
  })

  it('keeps mobile action clusters compact instead of stacking every button', () => {
    expect(mobileStyles).toMatch(
      /body button:is\(\.primary-action,\s*\.secondary-action,\s*\.quiet-action,\s*\.danger-action\)\s*\{[^}]*width:\s*auto[^}]*min-height:\s*32px/s,
    )
    expect(mobileStyles).toMatch(
      /\.dossier-actions,[\s\S]*?\.fee-item-actions\s*\{[^}]*flex-direction:\s*row[^}]*flex-wrap:\s*wrap/s,
    )
    expect(mobileStyles).toMatch(
      /\.notification-publisher-head-actions,[\s\S]*?\.notification-dialog-footer\s*\{[^}]*flex-direction:\s*row[^}]*flex-wrap:\s*wrap/s,
    )
    expect(mobileStyles).toMatch(
      /\.team-member-ops-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s,
    )
    expect(mobileStyles).toMatch(
      /\.correspondence-mode-bar\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s,
    )
  })
})
