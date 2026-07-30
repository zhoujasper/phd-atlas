import { describe, expect, it } from 'vitest'
import teamStyles from '../../styles/team.css?raw'

describe('Team notification launcher phone density', () => {
  it('keeps the icon and two-level title compact without changing the desktop launcher', () => {
    expect(teamStyles).toMatch(
      /@media \(max-width:\s*640px\)[\s\S]*?\.team-notification-launcher\.notification-publisher\s*\{[^}]*gap:\s*8px[^}]*padding-block:\s*12px/s,
    )
    expect(teamStyles).toMatch(
      /\.team-notification-launcher \.notification-publisher-title\s*\{[^}]*grid-template-columns:\s*30px minmax\(0,\s*1fr\)[^}]*gap:\s*8px[^}]*align-items:\s*center/s,
    )
    expect(teamStyles).toMatch(
      /\.team-notification-launcher \.notification-publisher-icon\s*\{[^}]*width:\s*30px[^}]*height:\s*30px[^}]*border-radius:\s*var\(--radius-sm\)/s,
    )
    expect(teamStyles).toMatch(
      /\.team-notification-launcher \.notification-publisher-title \.eyebrow\s*\{[^}]*font-size:\s*10px[^}]*line-height:\s*1\.15/s,
    )
    expect(teamStyles).toMatch(
      /\.team-notification-launcher \.notification-publisher-head h3\s*\{[^}]*margin:\s*1px 0 0[^}]*font-size:\s*17px[^}]*line-height:\s*1\.2/s,
    )
  })

  it('uses the compact action token for the two launcher controls on phones', () => {
    expect(teamStyles).toMatch(
      /body \.team-notification-launcher \.notification-publisher-head-actions :is\(\.quiet-action,\s*\.primary-action\)\s*\{[^}]*height:\s*var\(--action-height-compact\)[^}]*min-height:\s*var\(--action-height-compact\) !important[^}]*padding-inline:\s*8px[^}]*gap:\s*4px[^}]*font-size:\s*11px/s,
    )
    expect(teamStyles).toMatch(
      /\.team-notification-launcher \.notification-publisher-head-actions :is\(\.quiet-action,\s*\.primary-action\) svg\s*\{[^}]*width:\s*12px[^}]*height:\s*12px/s,
    )
  })
})
