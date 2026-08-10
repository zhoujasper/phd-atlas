import { describe, expect, it } from 'vitest'
import styles from '../../index.css?raw'
import mobileStyles from '../../styles/mobile.css?raw'
import comboboxSource from './RecommenderCombobox.tsx?raw'
import recommenderDirectorySource from './ProfileRecommendersView.tsx?raw'

describe('profile recommender experience CSS contract', () => {
  it('uses one animated workspace switch and a continuous, disclosure-based list', () => {
    expect(styles).toMatch(/\.profile-domain-switch-indicator\s*\{[^}]*transform:[^}]*transition:\s*transform 320ms/s)
    // The pane animates on a tab switch only. On the screen's first paint it is
    // already carried by the screen-level entrance cascade, and running both
    // made the whole pane fade in a second time — a flicker after load.
    expect(styles).toMatch(/\.profile-domain-pane\.is-switched\s*\{[^}]*animation:\s*profile-domain-pane-in 220ms/s)
    expect(styles).not.toMatch(/\.profile-domain-pane\s*\{[^}]*animation:/s)
    expect(styles).toMatch(/\.profile-recommender-list\s*\{[^}]*border-block:\s*1px solid var\(--border\)/s)
    expect(styles).toMatch(/\.profile-recommender-row-detail\s*\{[^}]*grid-template-rows:\s*0fr/s)
    expect(styles).toMatch(/\.profile-recommender-row-detail\.is-open\s*\{[^}]*grid-template-rows:\s*1fr/s)
    expect(styles).toMatch(/\.profile-recommender-title-row\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center/s)
    expect(styles).toMatch(
      /\.profile-recommender-project-action\s*\{[^}]*width:\s*100%[^}]*border:\s*0[^}]*background:\s*transparent/s,
    )
    expect(styles).toMatch(
      /\.profile-recommender-row-detail\.is-open \.profile-recommender-uses li\s*\{[^}]*animation:\s*profile-recommender-project-in 220ms/s,
    )
    expect(styles).toMatch(/\.profile-recommender-directory-actions\s*\{[^}]*border-top:\s*1px solid var\(--border\)/s)
  })

  it('keeps large directories progressive while preserving a manual loading fallback', () => {
    expect(recommenderDirectorySource).toContain('visibleEntries.slice(0, visibleRowCount)')
    expect(recommenderDirectorySource).toContain('new IntersectionObserver(')
    expect(recommenderDirectorySource).toContain('renderedEntries.map((entry) =>')
    expect(recommenderDirectorySource).toContain("tx('profile.recommenders.showMore')")
    expect(recommenderDirectorySource).toContain('detailHydrated ? (')
    expect(styles).toMatch(
      /\.profile-recommender-load-more\s*\{[^}]*display:\s*flex[^}]*justify-content:\s*center/s,
    )
  })

  it('portals the editable combobox above clipped checklist panels', () => {
    expect(comboboxSource).toContain('createPortal(')
    expect(comboboxSource).toContain('getAnchoredOverlayStyle')
    expect(comboboxSource).toContain('addFloatingViewportListeners')
    expect(comboboxSource).toContain('data-floating-overlay="true"')
    expect(styles).toMatch(/@keyframes recommender-combobox-enter[\s\S]*translate3d[\s\S]*scale/)
  })

  it('lays out name over separate email and phone fields, then stacks them without icon overlap on phones', () => {
    expect(styles).toMatch(
      /\.recommender-combobox\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s,
    )
    expect(styles).toMatch(/\.recommender-combobox-name-field\s*\{[^}]*grid-column:\s*1 \/ -1/s)
    expect(styles).toMatch(
      /@media \(max-width: 480px\)[\s\S]*?\.recommender-combobox\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s,
    )
    expect(mobileStyles).toMatch(
      /body \.recommender-combobox input\.recommender-combobox-input\s*\{[^}]*padding-inline:\s*30px 10px !important/s,
    )
    expect(comboboxSource).toContain('type="email"')
    expect(comboboxSource).toContain('type="tel"')
  })

  it('keeps phone and touch actions unclipped and removes decorative motion when requested', () => {
    expect(styles).toMatch(
      /@media \(max-width: 560px\)[\s\S]*\.profile-recommender-project-action\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 18px/s,
    )
    expect(styles).toMatch(
      /@media \(max-width: 560px\)[\s\S]*\.profile-recommender-directory-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s,
    )
    expect(styles).toMatch(
      /@media \(hover: none\), \(pointer: coarse\)[\s\S]*\.profile-recommender-project-action,[\s\S]*min-height:\s*44px/s,
    )
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.profile-recommender-project-action,[\s\S]*\.recommender-combobox-menu/s,
    )
    expect(styles).toMatch(
      /@media \(forced-colors: active\)[\s\S]*\.profile-recommender-project-action,[\s\S]*color:\s*Highlight/s,
    )
  })
})
