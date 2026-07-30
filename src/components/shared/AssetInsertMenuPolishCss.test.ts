import { describe, expect, it } from 'vitest'
import coreStyles from '../../index.css?raw'

describe('asset insert menu visual hierarchy', () => {
  it('uses one continuous list instead of nested family cards', () => {
    expect(coreStyles).toMatch(
      /\.asset-insert-family-list\s*\{[^}]*gap:\s*0[^}]*border:\s*1px solid var\(--border\)[^}]*overflow-x:\s*hidden/s,
    )
    expect(coreStyles).toMatch(
      /\.asset-insert-family\s*\{[^}]*border:\s*0[^}]*border-bottom:\s*1px solid var\(--border\)[^}]*border-radius:\s*0/s,
    )
    expect(coreStyles).toMatch(
      /\.asset-insert-family\.checked\s*\{[^}]*background:\s*var\(--surface-secondary\)/s,
    )
    expect(coreStyles).toMatch(
      /\.asset-insert-family\.checked::before\s*\{[^}]*opacity:\s*1[^}]*transform:\s*scaleY\(1\)/s,
    )
    expect(coreStyles).toMatch(
      /\.asset-insert-row\.checked \.asset-insert-check\s*\{[^}]*background:\s*var\(--accent\)[^}]*color:\s*#fff/s,
    )
  })

  it('keeps the material name, version, and attachment metadata on one truncation-safe row', () => {
    expect(coreStyles).toMatch(
      /\.asset-insert-copy\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*overflow:\s*hidden/s,
    )
    expect(coreStyles).toMatch(
      /\.asset-insert-name\s*\{[^}]*flex:\s*1 1 auto[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s,
    )
    expect(coreStyles).toMatch(
      /\.asset-insert-meta\s*\{[^}]*display:\s*inline-flex[^}]*max-width:\s*58%[^}]*white-space:\s*nowrap/s,
    )
    expect(coreStyles).toMatch(
      /\.asset-insert-meta \.asset-insert-version-name\s*\{[^}]*flex:\s*0 1 auto[^}]*text-overflow:\s*ellipsis/s,
    )
  })

  it('retains visible keyboard focus for rows and the version disclosure', () => {
    expect(coreStyles).toMatch(
      /\.asset-insert-row:has\(input:focus-visible\),\s*\.asset-insert-version-row:has\(input:focus-visible\)\s*\{[^}]*box-shadow:\s*inset 0 0 0 2px var\(--accent\)/s,
    )
    expect(coreStyles).toMatch(
      /\.asset-insert-expand:focus-visible\s*\{[^}]*box-shadow:\s*inset 0 0 0 2px var\(--accent\)/s,
    )
  })

  it('animates the resident disclosure without transforming the SVG node', () => {
    expect(coreStyles).toMatch(
      /\.asset-insert-versions\s*\{[^}]*grid-template-rows:\s*0fr[^}]*opacity:\s*0[^}]*grid-template-rows 320ms var\(--ease-fluid\)/s,
    )
    expect(coreStyles).toMatch(
      /\.asset-insert-versions\.open\s*\{[^}]*grid-template-rows:\s*1fr[^}]*opacity:\s*1/s,
    )
    expect(coreStyles).toMatch(
      /\.asset-insert-expand-icon\s*\{[^}]*transform:\s*rotate\(0deg\)[^}]*transition:\s*transform 320ms var\(--ease-fluid\)/s,
    )
    expect(coreStyles).toMatch(
      /\.asset-insert-expand-icon\.open\s*\{[^}]*transform:\s*rotate\(180deg\)/s,
    )
    expect(coreStyles).not.toMatch(/\.asset-insert-expand svg\s*\{[^}]*transition:/s)
  })

  it('constrains the list inside the viewport and keeps touch/reduced-motion paths explicit', () => {
    expect(coreStyles).toMatch(
      /\.asset-insert-menu-families\s*\{[^}]*grid-template-rows:\s*auto auto minmax\(0,\s*1fr\) auto[^}]*max-width:\s*420px/s,
    )
    expect(coreStyles).toMatch(
      /@media \(hover: none\), \(pointer: coarse\)\s*\{[\s\S]*?\.asset-insert-expand\s*\{[^}]*width:\s*32px[^}]*height:\s*32px/s,
    )
    expect(coreStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.asset-insert-expand-icon,[\s\S]*?transition-duration:\s*0\.01ms !important/s,
    )
  })
})
