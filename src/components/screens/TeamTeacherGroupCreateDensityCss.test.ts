import { describe, expect, it } from 'vitest'
import mobileStyles from '../../styles/mobile.css?raw'
import teamStyles from '../../styles/team.css?raw'

describe('Team teacher-group inline creator density', () => {
  it('keeps the nav editor compact on desktop and phone', () => {
    expect(mobileStyles).toMatch(
      /body input:not\(\[type='checkbox'\]\):not\(\[type='radio'\]\):not\(\[type='range'\]\)\s*\{[^}]*height:\s*var\(--mobile-control-height\)[^}]*min-height:\s*var\(--mobile-control-height\)/s,
    )
    expect(teamStyles).toMatch(
      /\.team-screen \.team-teacher-group-nav \.team-teacher-group-create\.is-inline input\s*\{[^}]*height:\s*26px[^}]*min-height:\s*26px[^}]*padding:\s*0 6px[^}]*font-size:\s*12px/s,
    )
    expect(teamStyles).toMatch(
      /\.team-teacher-group-create-actions button\s*\{[^}]*width:\s*24px[^}]*min-width:\s*24px[^}]*height:\s*24px[^}]*min-height:\s*24px[^}]*flex:\s*0 0 24px/s,
    )
    expect(teamStyles).toMatch(
      /\.team-teacher-group-nav > button\s*\{[^}]*min-height:\s*36px/s,
    )
    expect(teamStyles).not.toContain('.team-teacher-group-nav button')
  })
})
