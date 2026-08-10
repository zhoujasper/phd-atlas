import { describe, expect, it } from 'vitest'
import appSource from '../../App.tsx?raw'
import dossierSource from './DossierView.tsx?raw'
import styles from '../../index.css?raw'

describe('dossier tab handoff performance contract', () => {
  it('keeps the tab highlight urgent while deferring the dense panel tree', () => {
    expect(dossierSource).toContain('const renderedTab = useDeferredValue(tab)')
    expect(dossierSource).toContain('const DossierTabStrip = memo(function DossierTabStrip')
    expect(dossierSource).toContain('key={renderedTab}')
    expect(dossierSource).toContain("data-tab-pending={tab !== renderedTab ? 'true' : undefined}")
  })

  it('arms the fallback entrance in the same transition as the destination commit', () => {
    expect(appSource).toMatch(
      /if \(scope === 'dossier-tab' && !reduceMotion && !isJsdomRuntime\(\)\) \{\s*startTransition\(\(\) => \{\s*(?:if \(animationSequenceRef\.current !== sequence\) return\s*)?update\(\)\s*setCssFallbackCommit\(nextCssFallbackCommit\)/s,
    )
    expect(styles).toContain('--duration-tab-handoff: 160ms;')
    expect(styles).toContain(
      'animation: atlas-fallback-dossier-tab-enter-forward var(--duration-tab-handoff) var(--ease-fluid) both',
    )
    expect(styles).toMatch(/\.tab-strip button\s*\{[\s\S]*touch-action:\s*manipulation;/s)
  })

  it('keeps the selected dossier tab visible in the narrow horizontal strip', () => {
    expect(dossierSource).toContain('[role="tab"][aria-selected="true"]')
    expect(dossierSource).toContain('strip.scrollWidth <= strip.clientWidth')
    expect(dossierSource).toContain('strip.scrollTo({')
  })
})
