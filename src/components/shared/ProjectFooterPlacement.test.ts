import { describe, expect, it } from 'vitest'
import appSource from '../../App.tsx?raw'
import dashboardSource from '../screens/Dashboard.tsx?raw'
import profileSource from '../screens/ProfileScreen.tsx?raw'
import settingsSource from '../screens/SettingsScreen.tsx?raw'
import teamSource from '../screens/TeamScreen.tsx?raw'
import standaloneSource from '../StandaloneProviders.tsx?raw'
import footerStyles from '../../styles/project-footer.css?raw'

describe('ProjectFooter placement', () => {
  it('stays in long-page content flow instead of the application shell', () => {
    expect(footerStyles).toMatch(/\.project-footer\s*\{[^}]*position:\s*relative;/s)
    expect(footerStyles).not.toContain('position: fixed')
    expect(footerStyles).not.toContain('with-project-footer')

    expect(appSource).not.toContain('<ProjectFooter')
    expect(standaloneSource).not.toContain('<ProjectFooter')
    expect(dashboardSource).toContain('<ProjectFooter />')
    expect(profileSource).toContain('<ProjectFooter />')
    expect(settingsSource).toContain('<ProjectFooter />')
    expect(teamSource).toContain("displayedSection === 'overview' || displayedSection === 'settings'")
  })
})
