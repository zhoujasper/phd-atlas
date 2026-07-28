import { describe, expect, it } from 'vitest'
import authSource from './AuthScreen.tsx?raw'
import workspaceDemoSource from './MarketingWorkspaceDemo.tsx?raw'
import upgradeSource from './UpgradeProScreen.tsx?raw'
import motionSource from '../hooks/useMarketingMotion.ts?raw'
import marketingStyles from '../../styles/marketing.css?raw'

describe('signed-out and Pro marketing experiences', () => {
  it('keeps product storytelling connected to the real authentication surface', () => {
    expect(authSource).toContain('className="auth-marketing-hero"')
    expect(authSource).toContain('className="auth-story"')
    expect(authSource).toContain('className="auth-access-section"')
    expect(authSource).toContain('className="auth-sheet"')
    expect(authSource).toContain('<MarketingWorkspaceDemo className="auth-real-workspace"')
    expect(authSource).toMatch(/aria-pressed=\{activeStory === key\}/)
    expect(authSource).toContain("scrollIntoView({ behavior: reduced ? 'auto' : 'smooth'")
  })

  it('uses the real workspace anatomy and keeps the demo genuinely interactive', () => {
    expect(workspaceDemoSource).toContain("applications as seedApplications")
    expect(workspaceDemoSource).toContain('className="mwd-applications"')
    expect(workspaceDemoSource).toContain('className="mwd-dossier"')
    expect(workspaceDemoSource).toContain('className="mwd-inspector"')
    expect(workspaceDemoSource).toContain('onChange={(event) => updateQuery(event.target.value)}')
    expect(workspaceDemoSource).toContain('onClick={() => setSelectedId(application.id)}')
    expect(workspaceDemoSource).toContain('onClick={createBackup}')
    expect(workspaceDemoSource).toContain('onClick={() => restoreTrashItem(item)}')
    expect(workspaceDemoSource).toContain('toggleCheckedRow')
  })

  it('keeps upgrade context, interactive benefits, comparison, and activation in one flow', () => {
    expect(upgradeSource).toContain('className="upgrade-capability-stage"')
    expect(upgradeSource).toContain('className="upgrade-benefit-story"')
    expect(upgradeSource).toContain('className="upgrade-plan-comparison"')
    expect(upgradeSource).toContain('className="upgrade-flow"')
    expect(upgradeSource).toContain('className="upgrade-real-workspace"')
    expect(upgradeSource).toContain('className="upgrade-benefit-real-workspace"')
    expect(upgradeSource).toMatch(/aria-pressed=\{activeBenefit === index\}/)
    expect(upgradeSource).toContain("new URLSearchParams(window.location.search)")
  })

  it('uses bounded, pointer-appropriate motion without driving React renders', () => {
    expect(motionSource).toContain("matchMedia('(hover: hover) and (pointer: fine)')")
    expect(motionSource).toContain('window.requestAnimationFrame(writePointer)')
    expect(motionSource).toContain("addEventListener('pointermove', onPointerMove, { passive: true })")
    expect(motionSource).toContain('observer.unobserve(entry.target)')
  })

  it('has dedicated tablet, phone, dark-mode, and reduced-motion treatments', () => {
    expect(marketingStyles).toContain('[data-theme="dark"] .auth-marketing-page')
    expect(marketingStyles).toContain('@media (max-width: 820px)')
    expect(marketingStyles).toContain('@media (max-width: 560px)')
    expect(marketingStyles).toContain('@container (max-width: 650px)')
    expect(marketingStyles).toContain('@media (hover: none)')
    expect(marketingStyles).toContain('.marketing-workspace-demo.is-pro .mwd-dossier')
    expect(marketingStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation-duration: 0\.01ms !important;/,
    )
    expect(marketingStyles).toMatch(
      /\.upgrade-plan-comparison\s*\{[\s\S]*?overflow-x: auto;[\s\S]*?overscroll-behavior-x: contain;/,
    )
  })
})
