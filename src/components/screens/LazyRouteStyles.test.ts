import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('lazy route stylesheet ownership', () => {
  it('keeps feature-only styles out of the synchronous browser entry', () => {
    const mainSource = source('src/main.tsx')
    for (const stylesheet of [
      'ai.css',
      'settings.css',
      'discover.css',
      'dossier-collapsed.css',
      'application-transfer.css',
      'dashboard-guidance.css',
      'application-pipeline.css',
      'onboarding.css',
      'mail-actions.css',
      'school-logo.css',
      'project-footer.css',
      'marketing.css',
      'homepage.css',
    ]) {
      expect(mainSource).not.toContain(stylesheet)
    }
    expect(mainSource).not.toContain("import './styles/mobile.css'")
    expect(mainSource).toContain("from './styles/mobile.css?url'")
    expect(mainSource).toContain("installResponsiveStylesheet('mobile-product-shell'")
  })

  it.each([
    ['src/components/screens/Dashboard.tsx', "import '../../styles/dashboard-guidance.css'"],
    ['src/components/screens/DiscoverScreen.tsx', "import '../../styles/discover.css'"],
    ['src/components/screens/SettingsScreen.tsx', "import '../../styles/settings.css'"],
    ['src/components/screens/KanbanBoard.tsx', "import '../../styles/application-pipeline.css'"],
    ['src/components/screens/DossierView.tsx', "import '../../styles/dossier-collapsed.css'"],
    ['src/components/screens/DossierView.tsx', "import '../../styles/application-transfer.css'"],
    ['src/components/shared/AiDraftPanel.tsx', "import '../../styles/ai.css'"],
    ['src/components/shared/AiProfilePanel.tsx', "import '../../styles/ai.css'"],
    ['src/components/shared/AiKeyManager.tsx', "import '../../styles/ai.css'"],
    ['src/components/shared/OnboardingTour.tsx', "import '../../styles/onboarding.css'"],
    ['src/components/shared/AsyncActionButton.tsx', "import '../../styles/mail-actions.css'"],
    ['src/components/shared/SchoolLogo.tsx', "import '../../styles/school-logo.css'"],
    ['src/components/shared/ProjectFooter.tsx', "import '../../styles/project-footer.css'"],
    ['src/components/screens/AuthScreen.tsx', "import '../../styles/marketing.css'"],
    ['src/components/screens/AuthScreen.tsx', "import '../../styles/homepage.css'"],
    ['src/components/screens/UpgradeProScreen.tsx', "import '../../styles/marketing.css'"],
  ])('%s owns %s', (modulePath, stylesheetImport) => {
    expect(source(modulePath)).toContain(stylesheetImport)
  })

  it('keeps the lazy onboarding stylesheet self-contained on phones', () => {
    const onboardingSource = source('src/styles/onboarding.css')
    const mobileSource = source('src/styles/mobile.css')

    expect(onboardingSource).toContain('bottom: calc(var(--mobile-tab-bar-height) + 10px')
    expect(onboardingSource).toContain('body .atlas-guide-actions :is(.quiet-action, .primary-action)')
    expect(mobileSource).not.toContain('body .atlas-guide-actions :is(.quiet-action, .primary-action)')
  })

  it('keeps the signed-out marketing surface out of the authenticated App graph', () => {
    const appSource = source('src/App.tsx')

    expect(appSource).not.toContain("import { AuthScreen } from './components/screens/AuthScreen'")
    expect(appSource).toContain("import('./components/screens/AuthScreen')")
    expect(appSource).toContain('void loadAuthScreen()')
  })
})
