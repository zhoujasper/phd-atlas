import { describe, expect, it } from 'vitest'
import teamStyles from '../../styles/team.css?raw'

const normalizedTeamStyles = teamStyles.replace(/\r\n/g, '\n')

describe('teacher overview layout CSS', () => {
  it('keeps the default teacher dashboard out of a separate white side column', () => {
    expect(normalizedTeamStyles).toMatch(
      /\.team-teacher-dashboard-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*\}/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /\.team-teacher-contacts-panel \.team-contact-list\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*300px\),\s*1fr\)\);[^}]*\}/s,
    )
  })
})
