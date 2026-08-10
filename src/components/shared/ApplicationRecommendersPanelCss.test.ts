import { describe, expect, it } from 'vitest'
import styles from '../../index.css?raw'
import mobileStyles from '../../styles/mobile.css?raw'
import panelSource from './ApplicationRecommendersPanel.tsx?raw'

describe('application recommender overview CSS contract', () => {
  it('keeps the heavy visual Markdown editor behind the shared lazy boundary', () => {
    expect(panelSource).toContain("import { LazyMarkdownTextarea as MarkdownTextarea } from './LazyMarkdownTextarea'")
    expect(panelSource).not.toContain("from './MarkdownTextarea'")
  })

  it('keeps the recommendation and notes surfaces as equal desktop halves', () => {
    expect(styles).toMatch(
      /\.dossier-overview-recommender-notes\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)[^}]*column-span:\s*all/s,
    )
    expect(styles).toMatch(
      /\.dossier-overview-recommender-notes\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s,
    )
    expect(styles).toMatch(
      /\.dossier-cards \.dossier-overview-recommender-notes > \.section-card\s*\{[^}]*height:\s*100%[^}]*margin:\s*0/s,
    )
  })

  it('uses one continuous list with progressive disclosure motion', () => {
    expect(styles).toMatch(
      /\.application-recommenders-list\s*\{[^}]*border-block:\s*1px solid var\(--border\)/s,
    )
    expect(styles).toMatch(
      /\.application-recommender-detail\s*\{[^}]*grid-template-rows:\s*0fr/s,
    )
    expect(styles).toMatch(
      /\.application-recommender-detail\.is-open\s*\{[^}]*grid-template-rows:\s*1fr/s,
    )
    expect(styles).toMatch(
      /\.application-recommender-detail-inner\s*\{[^}]*opacity:\s*0[^}]*translate3d\(0, -6px, 0\)/s,
    )
    expect(styles).toMatch(
      /\.application-recommender-row\.is-removing\s*\{[^}]*grid-template-rows:\s*minmax\(0, 0fr\)[^}]*pointer-events:\s*none/s,
    )
    expect(styles).toMatch(
      /\.application-recommender-row\.is-removing \.application-recommender-row-content\s*\{[^}]*opacity:\s*0[^}]*translate3d\(0, -5px, 0\)/s,
    )
    expect(styles).toMatch(
      /\.application-recommender-row\.is-entering\s*\{[^}]*grid-template-rows:\s*minmax\(0, 0fr\)[^}]*pointer-events:\s*none/s,
    )
    expect(styles).toMatch(
      /\.application-recommender-row\.is-entering \.application-recommender-row-content\s*\{[^}]*opacity:\s*0[^}]*translate3d\(0, 6px, 0\)/s,
    )
  })

  it('stacks at the product mobile breakpoint and preserves accessibility fallbacks', () => {
    expect(styles).toMatch(
      /@media \(max-width: 820px\)[\s\S]*?\.dossier-overview-recommender-notes\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s,
    )
    expect(styles).toMatch(
      /@media \(hover: none\), \(pointer: coarse\)[\s\S]*?\.application-recommender-summary\s*\{[^}]*min-height:\s*56px/s,
    )
    expect(styles).toMatch(
      /\[data-theme="dark"\] \.application-recommender-summary:hover\s*\{[^}]*var\(--surface-secondary\)/s,
    )
    expect(styles).toMatch(
      /@media \(forced-colors: active\)[\s\S]*?\.application-recommender-row\.is-expanded \.application-recommender-summary\s*\{[^}]*border-color:\s*Highlight/s,
    )
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.application-recommender-detail-inner,[\s\S]*?transition-duration:\s*0\.01ms !important/s,
    )
  })

  it('keeps Save compact and softly green while preserving icon clearance on phones', () => {
    expect(styles).toMatch(
      /\.application-recommender-save\s*\{[^}]*min-width:\s*68px/s,
    )
    expect(styles).toMatch(
      /\.quiet-action:is\(\.save-action, \.mail-save-btn\)\s*\{[^}]*background:\s*var\(--success-bg\)[^}]*color:\s*var\(--success\)/s,
    )
    expect(mobileStyles).toMatch(
      /body \.recommender-combobox input\.recommender-combobox-input\s*\{[^}]*padding-inline:\s*30px 10px !important/s,
    )
  })
})
