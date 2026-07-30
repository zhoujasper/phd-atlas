import { describe, expect, it } from 'vitest'
import coreStyles from '../../index.css?raw'
import aiStyles from '../../styles/ai.css?raw'
import discoverStyles from '../../styles/discover.css?raw'

describe('requested UI detail polish', () => {
  it('keeps the upload-link expiry, note and action on one equal-height rhythm', () => {
    expect(coreStyles).toMatch(
      /\.snippet-share-form\s*\{[^}]*--snippet-share-control-height:\s*34px[^}]*align-items:\s*stretch/s,
    )
    expect(coreStyles).toMatch(
      /\.snippet-share-form > \.custom-select-root,\s*\.snippet-share-form > input,\s*\.snippet-share-form > \.secondary-action\s*\{[^}]*height:\s*var\(--snippet-share-control-height\)[^}]*min-height:\s*var\(--snippet-share-control-height\)/s,
    )
    expect(coreStyles).toMatch(
      /@media \(max-width:\s*820px\)\s*\{[\s\S]*?\.snippet-share-form\s*\{[^}]*--snippet-share-control-height:\s*var\(--mobile-control-height,\s*36px\)/,
    )
  })

  it('places the privacy disclosure closer to its fields than to the dialog heading', () => {
    expect(aiStyles).toMatch(
      /\.ai-profile-dialog \.dialog-head\s*\{[^}]*margin-bottom:\s*16px/s,
    )
    expect(aiStyles).toMatch(
      /\.ai-profile-dialog \.ai-profile-form\s*\{[^}]*margin-top:\s*8px/s,
    )
  })

  it('keeps the Discover tutorial behind a compact information control with bounded motion', () => {
    expect(discoverStyles).toMatch(
      /\.discover-toolbar-title\s*\{[^}]*display:\s*inline-flex[^}]*align-items:\s*center/s,
    )
    expect(discoverStyles).toMatch(
      /\.discover-guide-trigger\s*\{[^}]*width:\s*22px[^}]*height:\s*22px[^}]*border-radius:\s*50%/s,
    )
    expect(discoverStyles).toMatch(
      /\.discover-guide-popover\.anchored-popover\s*\{[^}]*--anchored-popover-enter-duration:\s*190ms[^}]*--anchored-popover-exit-duration:\s*150ms/s,
    )
    expect(discoverStyles).toMatch(
      /\.discover-guide-steps li:nth-child\(4\)\s*\{\s*animation-delay:\s*135ms;\s*\}/,
    )
    expect(discoverStyles).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.discover-guide-steps li::after,[\s\S]*?animation-duration:\s*0\.01ms !important/,
    )
  })
})
