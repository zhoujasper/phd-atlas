import { describe, expect, it } from 'vitest'
import teamStyles from '../../styles/team.css?raw'

const normalizedTeamStyles = teamStyles.replace(/\r\n/g, '\n')

describe('Team mobile UI CSS', () => {
  it('keeps the contact readiness content inside the narrow summary row', () => {
    expect(normalizedTeamStyles).toMatch(
      /@media \(max-width:\s*560px\)\s*\{[\s\S]*?\.team-contact-profile-summary\s*\{[^}]*grid-template-columns:\s*38px minmax\(0,\s*1fr\) 24px;[^}]*\}/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /\.team-collaboration-row-main,\s*\.team-teacher-directory-row,\s*\.team-contact-profile-summary\s*\{[^}]*overflow:\s*hidden;[^}]*\}/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /\.team-contact-profile-readiness\s*\{[^}]*grid-column:\s*2;[^}]*grid-row:\s*2;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto;[^}]*\}/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /\.team-contact-profile-readiness strong\s*\{[^}]*max-width:\s*96px;[^}]*\}/s,
    )
  })

  it('uses compact mobile collaboration controls without fixed-width toolbar overflow', () => {
    expect(normalizedTeamStyles).toMatch(
      /\.team-collaboration-toolbar \.team-member-view-switch\s*\{[^}]*min-width:\s*0;[^}]*\}/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /\.team-collaboration-toolbar-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*0\.82fr\) minmax\(0,\s*1\.18fr\);[^}]*\}/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /\.team-collaboration-mode-switch button\s*\{[^}]*height:\s*31px;[^}]*\}/s,
    )
  })

  it('removes sticky desktop lift feedback on coarse touch devices', () => {
    expect(normalizedTeamStyles).toMatch(
      /@media \(hover:\s*none\) and \(pointer:\s*coarse\)\s*\{[\s\S]*?:hover\s*\{[^}]*transform:\s*none;[^}]*\}/s,
    )
  })
})
