import { describe, expect, it } from 'vitest'
import coreStyles from '../../index.css?raw'
import discoverStyles from '../../styles/discover.css?raw'
import mobileStyles from '../../styles/mobile.css?raw'
import settingsStyles from '../../styles/settings.css?raw'

describe('requested responsive polish CSS', () => {
  it('keeps usage pills compact and phone exports in two columns', () => {
    expect(coreStyles).toMatch(/\.storage-usage-meta span\s*\{[^}]*min-height:\s*16px[^}]*padding:\s*0 5px[^}]*font-size:\s*10px[^}]*line-height:\s*1/s)
    expect(coreStyles).toMatch(/@media \(max-width: 560px\)\s*\{[\s\S]*?\.settings-export-formats\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
  })

  it('keeps SMTP actions on one row and balances the incoming connection columns', () => {
    expect(settingsStyles).toMatch(/\.mail-incoming-fields\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s)
    expect(settingsStyles).toMatch(/\.mail-config-card-outgoing \.mail-config-button-row\s*\{[^}]*flex-wrap:\s*nowrap/s)
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

  it('fits research and filter sheets into the same safe mobile viewport without duplicate gaps', () => {
    expect(discoverStyles).toMatch(/\.discover-sheet-backdrop\s*\{[^}]*padding-top:[^;]*safe-area-inset-top[^}]*padding-bottom:[^;]*mobile-tab-bar-height/s)
    expect(discoverStyles).toMatch(/\.discover-side-sheet\s*\{[^}]*position:\s*relative[^}]*height:\s*100%[^}]*max-height:\s*none/s)
    expect(discoverStyles).toMatch(/\.discover-mobile-overlay\s*\{[^}]*align-items:\s*stretch[^}]*padding-top:[^;]*safe-area-inset-top[^}]*padding-bottom:[^;]*mobile-tab-bar-height/s)
    expect(discoverStyles).toMatch(/\.discover-mobile-overlay \.discover-filter-rail\.is-mobile\s*\{[^}]*height:\s*100%[^}]*max-height:\s*none[^}]*margin-bottom:\s*0/s)
    expect(mobileStyles).toMatch(/\.discover-sheet-backdrop \.discover-side-sheet\s*\{[^}]*bottom:\s*auto/s)
    expect(mobileStyles).toMatch(/\.discover-mobile-overlay \.discover-filter-rail\.is-mobile\s*\{[^}]*margin-bottom:\s*0/s)
  })
})
