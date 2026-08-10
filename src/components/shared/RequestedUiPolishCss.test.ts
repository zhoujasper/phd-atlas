import { describe, expect, it } from 'vitest'
import coreStyles from '../../index.css?raw'
import aiStyles from '../../styles/ai.css?raw'
import discoverStyles from '../../styles/discover.css?raw'
import surfacePolishStyles from '../../styles/surface-polish.css?raw'

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

  it('gives every text field the accent focus ring instead of a neutral grey halo', () => {
    expect(surfacePolishStyles).toMatch(
      /input:focus-visible,\s*textarea:focus-visible,\s*select:focus-visible,\s*\[contenteditable="true"\]:focus-visible\s*\{[^}]*box-shadow:\s*0 0 0 3px var\(--accent-ring\)[^}]*border-color:\s*var\(--accent\)/s,
    )
    expect(surfacePolishStyles).not.toMatch(/box-shadow:\s*0 0 0 2px color-mix\(in srgb, var\(--text\)/)
    expect(surfacePolishStyles).toMatch(
      /\.custom-select-trigger\.open\s*\{[^}]*box-shadow:\s*0 0 0 3px var\(--accent-ring\)/s,
    )
    // A shell that owns the frame must not stack a second ring on its field.
    expect(surfacePolishStyles).toMatch(
      /\.date-picker-time-field input:focus-visible,[\s\S]*?\{[^}]*box-shadow:\s*none/s,
    )
    // Rings and glows follow the chosen accent, never a hardcoded blue. The
    // @property registrations keep a literal fallback because initial-value
    // cannot reference another custom property.
    const shadowDeclarations = coreStyles.match(/box-shadow:[^;]+;/g) ?? []
    expect(shadowDeclarations.length).toBeGreaterThan(50)
    expect(shadowDeclarations.filter((line) => /rgba\(\s*0\s*,\s*113\s*,\s*227/.test(line))).toEqual([])
    expect(surfacePolishStyles).not.toMatch(/rgba\(\s*0\s*,\s*113\s*,\s*227/)
  })

  it('stops clipping a collapsible panel once it has finished opening', () => {
    // While the height interpolates the block edges must clip; afterwards the
    // panel is a static box, so a ring on its first or last field can breathe.
    expect(coreStyles).toMatch(
      /\.collapsible-panel\.open\s*\{[^}]*clip-path:\s*inset\(calc\(-1 \* var\(--collapsible-side-bleed\)\)\)[^}]*clip-path 0s linear var\(--collapsible-open-duration\)/s,
    )
    expect(coreStyles).toMatch(
      /\.application-recommender-detail\.is-open \.application-recommender-detail-inner\s*\{[^}]*clip-path:\s*inset\(-6px\)/s,
    )
    // An open picker wears the same ring as an open select.
    expect(coreStyles).toMatch(
      /\.date-picker-display\[aria-expanded="true"\],[\s\S]*?\{[^}]*box-shadow:\s*0 0 0 3px var\(--accent-ring\)/s,
    )
  })

  it('lets collapsible panels clip height exactly while leaving room for focus rings', () => {
    expect(coreStyles).toMatch(
      /\.collapsible-panel\s*\{[^}]*--collapsible-side-bleed:\s*6px[^}]*clip-path:\s*inset\(0 calc\(-1 \* var\(--collapsible-side-bleed\)\)\)/s,
    )
    expect(coreStyles).toMatch(
      /\.collapsible-panel:is\([\s\S]*?\.stat-expanded-card\s*\)\s*\{[^}]*--collapsible-side-bleed:\s*0px[^}]*clip-path:\s*none/s,
    )
    expect(coreStyles).toMatch(/--ease-collapse:\s*cubic-bezier\(0\.4, 0\.02, 0\.22, 1\)/)
    // Every close must run on the collapse curve; --ease-fluid stalls at the end.
    expect(coreStyles).not.toMatch(/grid-template-rows var\(--collapsible-close-duration\) var\(--ease-fluid\)/)
  })
})
