import { describe, expect, it } from 'vitest'
import mobileStyles from '../../styles/mobile.css?raw'
import teamStyles from '../../styles/team.css?raw'

describe('Team organization-name action density', () => {
  it('keeps Save name and Cancel compact without weakening the phone control floor', () => {
    expect(teamStyles).toMatch(
      /\.team-organization-name-actions\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*gap:\s*6px/s,
    )
    expect(teamStyles).toMatch(
      /\.team-organization-name-row \.quiet-action,\s*\.team-organization-name-actions \.quiet-action,\s*\.team-organization-name-actions \.primary-action\s*\{[^}]*height:\s*var\(--action-height\)[^}]*min-height:\s*var\(--action-height\)[^}]*padding-inline:\s*10px[^}]*gap:\s*4px[^}]*border-radius:\s*var\(--radius-sm\)[^}]*font-size:\s*12px[^}]*line-height:\s*1/s,
    )
    expect(teamStyles).toMatch(
      /\.team-organization-name-actions :is\(\.quiet-action, \.primary-action\) svg\s*\{[^}]*width:\s*12px[^}]*height:\s*12px[^}]*flex:\s*0 0 auto/s,
    )
    expect(mobileStyles).toMatch(
      /body button:is\(\.primary-action, \.secondary-action, \.quiet-action, \.danger-action\)\s*\{[^}]*min-height:\s*32px !important/s,
    )
  })
})
