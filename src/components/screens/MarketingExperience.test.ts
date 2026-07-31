/// <reference types="node" />

import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import authSource from './AuthScreen.tsx?raw'
import dossierSource from './DossierView.tsx?raw'
import featureTourSource from './MarketingFeatureTour.tsx?raw'
import screenshotSource from './MarketingProductScreenshot.tsx?raw'
import upgradeSource from './UpgradeProScreen.tsx?raw'
import motionSource from '../hooks/useMarketingMotion.ts?raw'
import indexStyles from '../../index.css?raw'
import homepageStyles from '../../styles/homepage.css?raw'
import marketingStyles from '../../styles/marketing.css?raw'
import captureSource from '../../../tools/capture-product-tour-screenshots.mjs?raw'

const screenshotDirectory = join(process.cwd(), 'public', 'assets', 'product-tour')

describe('signed-out and Pro marketing experiences', () => {
  it('keeps product storytelling connected to the real authentication surface', () => {
    expect(authSource).toContain('className="auth-marketing-hero"')
    expect(authSource).toContain('className="auth-access-section"')
    expect(authSource).toContain('className="auth-sheet"')
    expect(authSource).toContain('<MarketingProductScreenshot')
    expect(authSource).toContain('language={lang}')
    expect(authSource).toContain('theme={theme}')
    expect(authSource).toContain('const MarketingFeatureTour = lazy(createRecoverableModuleLoader(')
    expect(authSource).toContain('<MarketingFeatureTour />')
    expect(authSource).not.toContain('MarketingWorkspaceDemo')
    expect(authSource).not.toContain('MarketingProductDemo')
    expect(featureTourSource).not.toContain('MarketingDashboardDemo')
    expect(featureTourSource).not.toContain('MarketingTeamDemo')
    expect(featureTourSource).not.toContain('MarketingContinuityDemo')
    expect(featureTourSource).not.toContain('MarketingProductDemo')
    expect(featureTourSource).not.toContain('MarketingWorkspaceDemo')
    expect(featureTourSource).toContain('const workflows = [')
    for (const surface of ['workspace', 'correspondence', 'funding', 'timeline', 'discover', 'profile']) {
      expect(featureTourSource).toContain(`key: '${surface}'`)
    }
    expect(featureTourSource).toContain('aria-pressed={activeScene === key}')
    expect(featureTourSource).toContain('surface={activeScene}')
    expect(featureTourSource).toContain('className="auth-workflow-directory" data-marketing-reveal')
    expect(featureTourSource).not.toMatch(/<article[^>]*data-marketing-reveal/)
    expect(featureTourSource).not.toContain('auth-capability-index')
    expect(featureTourSource).not.toContain('>03</span>')
    expect(screenshotSource).toContain("${surface}-${language}-${theme}${mobile ? '-mobile' : ''}.webp")
    expect(screenshotSource).toContain("loading: imageLoading = 'eager'")
    expect(screenshotSource).toContain("const fallbackSource = screenshotUrl('workspace'")
    expect(screenshotSource).toContain('const image = new Image()')
    expect(screenshotSource).toContain('await image.decode()')
    expect(screenshotSource).toContain('setDisplayedSource(requestedSource)')
    expect(authSource).toContain("marketingHeroTitleLines(tx('authMarketingHeroTitle'))")
    expect(authSource).toContain('auth-marketing-title-line')
    expect(homepageStyles).toMatch(/\.auth-marketing-title-line\.is-accent\s*\{[\s\S]*?color: var\(--accent\);/)
    expect(homepageStyles).not.toContain('linear-gradient(')
    expect(homepageStyles).toContain('@media (max-width: 700px)')
    expect(homepageStyles).toContain('@media (max-width: 430px)')
    expect(authSource).toContain("scrollIntoView({ behavior: reduced ? 'auto' : 'smooth'")
  })

  it('ships a complete high-density capture set for every supported language and theme', () => {
    const languages = ['de', 'en', 'es', 'fr', 'it', 'ja', 'ko', 'pt', 'ru', 'th', 'vi', 'zh']
    const surfaces = ['correspondence', 'discover', 'funding', 'profile', 'timeline', 'workspace']
    const expectedFiles = surfaces.flatMap((surface) => languages.flatMap((language) => (
      ['dark', 'light'].flatMap((theme) => [
        `${surface}-${language}-${theme}.webp`,
        `${surface}-${language}-${theme}-mobile.webp`,
      ])
    ))).sort()
    const actualFiles = readdirSync(screenshotDirectory).filter((file) => file.endsWith('.webp')).sort()

    expect(actualFiles).toEqual(expectedFiles)
    expect(actualFiles).toHaveLength(288)
    expect(captureSource).toContain('deviceScaleFactor: 2')
    expect(captureSource).toContain('quality: 100')
    expect(captureSource).toContain("mobile: { width: 390, height: 844")
    expect(captureSource).toContain("type: 'team-discover'")
    expect(captureSource).toContain("localStorage.setItem('phd-atlas-session'")
    for (const file of actualFiles) {
      const minimumBytes = file.includes('-mobile.webp') ? 80_000 : 200_000
      expect(statSync(join(screenshotDirectory, file)).size, file).toBeGreaterThan(minimumBytes)
    }
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
