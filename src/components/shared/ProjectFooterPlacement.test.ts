import { describe, expect, it } from 'vitest'
import appSource from '../../App.tsx?raw'
import authSource from '../screens/AuthScreen.tsx?raw'
import dashboardSource from '../screens/Dashboard.tsx?raw'
import dossierSource from '../screens/DossierView.tsx?raw'
import kanbanSource from '../screens/KanbanBoard.tsx?raw'
import profileSource from '../screens/ProfileScreen.tsx?raw'
import shareViewerSource from '../screens/ShareViewer.tsx?raw'
import settingsSource from '../screens/SettingsScreen.tsx?raw'
import teamSource from '../screens/TeamScreen.tsx?raw'
import standaloneSource from '../StandaloneProviders.tsx?raw'
import marketingStyles from '../../styles/marketing.css?raw'
import footerStyles from '../../styles/project-footer.css?raw'

describe('ProjectFooter placement', () => {
  it('stays in long-page content flow instead of the fixed application shell', () => {
    expect(footerStyles).toMatch(/\.project-footer\s*\{[^}]*position:\s*relative;/s)
    expect(footerStyles).not.toContain('position: fixed')
    expect(footerStyles).not.toContain('with-project-footer')

    expect(appSource).not.toContain('<ProjectFooter')
    expect(standaloneSource).not.toContain('<ProjectFooter')
    expect(authSource).toContain('className="auth-marketing-footer"')
    expect(authSource).toContain('<ProjectFooter />')
    expect(marketingStyles).toMatch(
      /\.auth-marketing-footer\s*\{[^}]*background:\s*var\(--marketing-page-alt\);/s,
    )
    expect(dashboardSource).toContain('<ProjectFooter />')
    expect(dossierSource).toContain('<ProjectFooter />')
    expect(dossierSource).toMatch(/<\/div>\s*<ProjectFooter \/>\s*\{pendingDraftExit/s)
    expect(kanbanSource).toContain('<ProjectFooter />')
    expect(profileSource).toContain('<ProjectFooter />')
    expect(shareViewerSource).toContain('<ProjectFooter />')
    expect(shareViewerSource).toMatch(/<\/section>\s*<ProjectFooter \/>\s*<AttachmentPreviewDialog/s)
    expect(settingsSource).toContain('<ProjectFooter />')
    expect(teamSource).toContain("displayedSection === 'overview' || displayedSection === 'settings'")
  })

  it('keeps the identity inline at ordinary phone widths and wraps only when space is tight', () => {
    const phoneStart = footerStyles.indexOf('@media (max-width: 560px)')
    const narrowPhoneStart = footerStyles.indexOf('@media (max-width: 360px)')
    const printStart = footerStyles.indexOf('@media print')

    expect(phoneStart).toBeGreaterThanOrEqual(0)
    expect(narrowPhoneStart).toBeGreaterThan(phoneStart)
    expect(printStart).toBeGreaterThan(narrowPhoneStart)

    const phoneStyles = footerStyles.slice(phoneStart, narrowPhoneStart)
    const narrowPhoneStyles = footerStyles.slice(narrowPhoneStart, printStart)

    expect(phoneStyles).toMatch(/\.project-footer-inner\s*\{[^}]*display:\s*flex;/s)
    expect(phoneStyles).toMatch(/\.project-footer-author\s*\{[^}]*flex:\s*1 1 auto;[^}]*overflow:\s*hidden;/s)
    expect(phoneStyles).not.toMatch(/\.project-footer-author\s*\{[^}]*grid-row:\s*2;/s)

    expect(narrowPhoneStyles).toMatch(
      /\.project-footer-inner\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto;/s,
    )
    expect(narrowPhoneStyles).toMatch(/\.project-footer-author\s*\{[^}]*grid-row:\s*2;/s)
  })
})
