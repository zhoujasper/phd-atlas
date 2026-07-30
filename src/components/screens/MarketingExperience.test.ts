import { describe, expect, it } from 'vitest'
import authSource from './AuthScreen.tsx?raw'
import dossierSource from './DossierView.tsx?raw'
import productDemoSource from './MarketingProductDemo.tsx?raw'
import workspaceDemoSource from './MarketingWorkspaceDemo.tsx?raw'
import upgradeSource from './UpgradeProScreen.tsx?raw'
import motionSource from '../hooks/useMarketingMotion.ts?raw'
import indexStyles from '../../index.css?raw'
import marketingStyles from '../../styles/marketing.css?raw'

describe('signed-out and Pro marketing experiences', () => {
  it('keeps product storytelling connected to the real authentication surface', () => {
    expect(authSource).toContain('className="auth-marketing-hero"')
    expect(authSource).toContain('className="auth-story"')
    expect(authSource).toContain('className="auth-access-section"')
    expect(authSource).toContain('className="auth-sheet"')
    expect(authSource).toContain('<MarketingWorkspaceDemo className="auth-real-workspace"')
    expect(authSource).toContain('<MarketingProductDemo')
    expect(authSource).toContain("type AuthStory = 'applications' | 'discover' | 'profile'")
    expect(authSource).toContain('surface={activeStory}')
    expect(authSource).toContain("marketingHeroTitleLines(tx('authMarketingHeroTitle'))")
    expect(authSource).toContain('auth-marketing-title-line')
    expect(marketingStyles).toMatch(/\.auth-marketing-title-line\s*\{[\s\S]*?display: block;/)
    expect(marketingStyles).toMatch(/\.auth-marketing-title-line\.is-accent\s*\{[\s\S]*?color: var\(--accent\);/)
    expect(marketingStyles).toMatch(/linear-gradient\([\s\S]*?var\(--accent-hover\)/)
    expect(authSource).toMatch(/aria-pressed=\{activeStory === key\}/)
    expect(authSource).toContain("scrollIntoView({ behavior: reduced ? 'auto' : 'smooth'")
  })

  it('uses the real workspace anatomy and keeps the demo genuinely interactive', () => {
    expect(workspaceDemoSource).toContain("applications as seedApplications")
    expect(workspaceDemoSource).toContain("application.id === 'eth-data-wang'")
    expect(workspaceDemoSource).toContain("useState<MarketingWorkspaceTab>('materials')")
    expect(workspaceDemoSource).toContain('className="mwd-applications"')
    expect(workspaceDemoSource).toContain('className="mwd-dossier"')
    expect(workspaceDemoSource).toContain('className="mwd-inspector"')
    expect(workspaceDemoSource).toContain('onChange={(event) => updateQuery(event.target.value)}')
    expect(workspaceDemoSource).toContain('onClick={() => setSelectedId(application.id)}')
    expect(workspaceDemoSource).toContain('onClick={createBackup}')
    expect(workspaceDemoSource).toContain('onClick={() => restoreTrashItem(item)}')
    expect(workspaceDemoSource).toContain('toggleCheckedRow')
    expect(workspaceDemoSource).toContain('localize(application.program)')
    expect(workspaceDemoSource).toContain('countryDisplayName(selected.school.country, lang)')
    expect(workspaceDemoSource).toContain("tx('explorer.statusOpen', 'Open')")
    expect(workspaceDemoSource).toContain("tx('upgrade.manualBackupBadge')")
    expect(workspaceDemoSource).toContain('formatStorage(storageUsage.used)')
    expect(workspaceDemoSource).toContain("key: 'mail'")
    expect(workspaceDemoSource).toContain("key: 'funding'")
    expect(workspaceDemoSource).toContain('className="mwd-dossier-overview"')
    expect(workspaceDemoSource).toContain('className="mwd-checklist-tools"')
    expect(workspaceDemoSource).toContain('className="mwd-checklist-group"')
    expect(workspaceDemoSource).toContain('className="mwd-correspondence-mode-bar"')
    expect(workspaceDemoSource).toContain('className="mwd-correspondence-timeline"')
    expect(workspaceDemoSource).toContain('className="mwd-message-composer"')
    expect(workspaceDemoSource).toContain('className="mwd-funding-progress"')
    expect(workspaceDemoSource).toContain('className="mwd-timeline-tasks"')
    expect(workspaceDemoSource).toContain('<SchoolLogoMark')
    expect(workspaceDemoSource).toContain('<StatusPill')
    expect(workspaceDemoSource).toContain('<ProgressRing')
    expect(workspaceDemoSource).toContain('className="mwd-fee-panel"')
    expect(workspaceDemoSource).toContain('className="mwd-inspector-deadlines"')
    expect(workspaceDemoSource).toContain('<AnimatedCheckmark checked={isDone}')
    expect(marketingStyles).toMatch(
      /\.mwd-checklist-list > article\.is-complete \.mwd-checklist-row-body > strong::after\s*\{[\s\S]*?scaleX\(1\)/,
    )
    expect(marketingStyles).toContain('@keyframes mwd-checklist-complete-flash')
  })

  it('introduces Discover and Profile through realistic, interactive product surfaces', () => {
    expect(productDemoSource).toContain("type DiscoverPreviewMode = 'programs' | 'advisors' | 'compare'")
    expect(productDemoSource).toContain('className="mpd-discover-search"')
    expect(productDemoSource).toContain('onChange={(event) => setQuery(event.target.value)}')
    expect(productDemoSource).toContain('onClick={() => toggleCompare(program.id)}')
    expect(productDemoSource).toContain('className="mpd-compare-grid"')
    expect(productDemoSource).toContain("type ProfilePreviewView = 'cards' | 'list'")
    expect(productDemoSource).toContain('`mpd-profile-preset-sheet${presetOpen ?')
    expect(productDemoSource).toContain('onClick={() => setSelectedAssetId(asset.id)}')
    expect(productDemoSource).toContain('setSelectedVersionByAsset((current) =>')
    expect(marketingStyles).toContain('.mpd-discover-workspace')
    expect(marketingStyles).toContain('.mpd-profile-card-grid')
    expect(marketingStyles).toMatch(
      /@container \(max-width: 650px\)[\s\S]*?\.mpd-discover-workspace\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/,
    )
    expect(marketingStyles).toMatch(
      /@container \(max-width: 430px\)[\s\S]*?\.mpd-profile-add span,[\s\S]*?display: none;/,
    )
  })

  it('draws mounted checklist checkmarks without an inward press transform', () => {
    expect(dossierSource).toContain('<AnimatedCheckmark checked={submitted}')
    expect(dossierSource).toContain('<AnimatedCheckmark checked={task.done}')
    expect(indexStyles).toMatch(
      /\.checklist-check-btn:active:not\(:disabled\)\s*\{[^}]*transform:\s*none;/,
    )
    expect(indexStyles).toMatch(
      /\.animated-checkmark\.is-checked \.animated-checkmark-tick\s*\{[^}]*stroke-dashoffset:\s*0;/,
    )
    expect(indexStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.animated-checkmark-tick,[\s\S]*?transition-duration:\s*0\.01ms !important;/,
    )
    expect(marketingStyles).toMatch(
      /\.mwd-check-toggle:active:not\(:disabled\),[\s\S]*?transform:\s*none;/,
    )
  })

  it('keeps registration verification controls compact and grouped on phones', () => {
    expect(authSource).toContain('className="icon-action captcha-refresh-action"')
    expect(authSource).toContain('aria-busy={captchaLoading || undefined}')
    expect(authSource).toContain("<PendingLabel label={tx('working')}")
    expect(marketingStyles).toMatch(
      /\.auth-marketing-page \.captcha-row\s*\{[^}]*grid-template-columns:\s*max-content minmax\(0,\s*1fr\) 34px/s,
    )
    expect(marketingStyles).toMatch(
      /\.auth-marketing-page \.auth-sheet \.captcha-row > input,[\s\S]*?min-height:\s*36px;[\s\S]*?height:\s*36px;/,
    )
    expect(marketingStyles).toMatch(
      /@media \(max-width: 560px\)[\s\S]*?\.auth-marketing-page \.email-code-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto/s,
    )
    expect(marketingStyles).not.toMatch(
      /\.auth-marketing-page \.email-code-row,\s*\.auth-marketing-page \.captcha-row\s*\{[^}]*grid-template-columns:\s*1fr/s,
    )
  })

  it('keeps pointer-open language controls calm while retaining keyboard focus visibility', () => {
    expect(indexStyles).toMatch(
      /\.auth-language-control \.custom-select-trigger\.custom-select-trigger\.open,[\s\S]*?box-shadow:\s*none;/,
    )
    expect(indexStyles).toMatch(
      /\.auth-language-control \.custom-select-trigger\.custom-select-trigger:focus-visible,[\s\S]*?box-shadow:\s*0 0 0 3px var\(--accent-ring\);/,
    )
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
      /@container \(max-width: 650px\)[\s\S]*?\.auth-story-real-workspace \.mwd-shell,[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/,
    )
    expect(marketingStyles).toContain('@container (max-width: 430px)')
    expect(marketingStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation-duration: 0\.01ms !important;/,
    )
    expect(marketingStyles).toMatch(
      /\.upgrade-plan-comparison\s*\{[\s\S]*?overflow-x: auto;[\s\S]*?overscroll-behavior-x: contain;/,
    )
  })
})
