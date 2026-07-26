import { describe, expect, it } from 'vitest'
import teamStyles from '../../styles/team.css?raw'

const normalizedTeamStyles = teamStyles.replace(/\r\n/g, '\n')

describe('team portrait library card grid CSS', () => {
  it('uses the same fixed-card wrapping flow and spacing as the personal library', () => {
    expect(normalizedTeamStyles).toMatch(
      /\.team-portrait-library-view\.is-cards\s*\{[^}]*container-name:\s*team-portrait-library;[^}]*container-type:\s*inline-size;[^}]*\}/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /\.team-portrait-snippet-card-grid\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;[^}]*gap:\s*24px 28px;[^}]*overflow-anchor:\s*none;[^}]*\}/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /@container team-portrait-library \(max-width:\s*720px\)\s*\{[\s\S]*?\.team-portrait-snippet-card-grid\s*\{[^}]*gap:\s*20px;[^}]*\}\s*\}/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /@media \(max-width:\s*820px\)\s*\{[\s\S]*?\.team-portrait-snippet-card-grid\s*\{[^}]*gap:\s*20px;[^}]*\}\s*\}/s,
    )
  })
})
