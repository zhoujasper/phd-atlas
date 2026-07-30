import { describe, expect, it } from 'vitest'
import teamStyles from '../../styles/team.css?raw'

const normalizedTeamStyles = teamStyles.replace(/\r\n/g, '\n')
const mobileNavigationStyles = normalizedTeamStyles.slice(
  normalizedTeamStyles.indexOf('Student portraits follow the same phone drill-down model as applications'),
)

describe('Team portrait mobile navigation CSS', () => {
  it('shows exactly one list or profile surface and removes the desktop preset inspector', () => {
    expect(mobileNavigationStyles).toMatch(
      /\.team-portrait-workspace:not\(\.is-mobile-detail-open\) \.team-portrait-list-pane\s*\{\s*display:\s*flex;/s,
    )
    expect(mobileNavigationStyles).toMatch(
      /\.team-portrait-workspace\.has-mobile-navigation:not\(\.is-mobile-detail-open\) \.team-portrait-list-pane\s*\{[^}]*team-portrait-mobile-list-return 220ms/s,
    )
    expect(mobileNavigationStyles).toMatch(
      /\.team-portrait-workspace:not\(\.is-mobile-detail-open\) \.team-portrait-profile-pane,\s*\.team-portrait-workspace\.is-mobile-detail-open \.team-portrait-list-pane,\s*\.team-portrait-template-pane\s*\{\s*display:\s*none;/s,
    )
    expect(mobileNavigationStyles).toMatch(
      /\.team-portrait-workspace\.is-mobile-detail-open \.team-portrait-profile-pane\s*\{[^}]*display:\s*flex;[^}]*team-portrait-mobile-detail-enter 220ms/s,
    )
  })

  it('keeps document scrolling, a clear disclosure affordance, and immediate reduced motion', () => {
    expect(mobileNavigationStyles).toMatch(
      /\.team-portrait-student-row\s*\{[^}]*grid-template-columns:\s*34px minmax\(0,\s*1fr\) 42px 16px;[^}]*touch-action:\s*manipulation;/s,
    )
    expect(mobileNavigationStyles).toMatch(
      /\.team-portrait-student-list\s*\{[^}]*overflow:\s*visible;[^}]*scrollbar-gutter:\s*auto;/s,
    )
    expect(mobileNavigationStyles).toMatch(
      /@media \(max-width:\s*820px\) and \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?animation:\s*none !important;/s,
    )
  })
})
