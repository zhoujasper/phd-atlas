import { describe, expect, it } from 'vitest'
import dossierSource from './DossierView.tsx?raw'
import explorerSelectionSource from '../shared/ExplorerSelectionBar.tsx?raw'
import styles from '../../index.css?raw'
import mobileStyles from '../../styles/mobile.css?raw'

describe('dossier responsive compact controls', () => {
  it('keeps explanatory checklist copy behind the shared info tooltip', () => {
    expect(dossierSource).toContain('className="checklist-hero-help"')
    expect(dossierSource).toContain('className="dossier-action-label"')
    expect(styles).toMatch(/\.checklist-hero-help\s*\{\s*display:\s*inline-flex;/s)
    expect(styles).toMatch(/\.checklist-hero-info p\s*\{\s*display:\s*none;/s)
  })

  it('collapses repeated action labels inside a narrow dossier container', () => {
    expect(styles).toContain('container: dossier-pane / inline-size;')
    expect(styles).toMatch(
      /@container dossier-pane \(max-width:\s*620px\)[\s\S]*?\.dossier-action-label,[\s\S]*?max-width:\s*0;[\s\S]*?opacity:\s*0;/s,
    )
    expect(dossierSource).toContain('className="checklist-action-label"')
    expect(explorerSelectionSource).toContain('className="explorer-selection-action-label"')
  })

  it('replaces narrow tab overflow with smooth, accessible arrow controls', () => {
    expect(dossierSource).toContain('className="tab-strip-nav tab-strip-nav-prev"')
    expect(dossierSource).toContain('className="tab-strip-nav tab-strip-nav-next"')
    expect(dossierSource).toContain("strip.scrollBy({ left: distance * direction, behavior: 'smooth' })")
    expect(styles).toContain('.tab-strip-shell .tab-strip::-webkit-scrollbar')
    expect(styles).toContain('scroll-behavior: smooth;')
    expect(mobileStyles).toContain('.dossier-pane .tab-strip-shell')
    expect(mobileStyles).toContain('.dossier-pane .tab-strip-shell.is-overflowing')
  })
})
