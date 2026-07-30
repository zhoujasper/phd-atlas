import { describe, expect, it } from 'vitest'
import workspaceStyles from '../../index.css?raw'
import teamStyles from '../../styles/team.css?raw'

const normalizedWorkspaceStyles = workspaceStyles.replace(/\r\n/g, '\n')
const normalizedTeamStyles = teamStyles.replace(/\r\n/g, '\n')

describe('team application row context CSS', () => {
  it('lets the accent rail follow the complete Team row height', () => {
    expect(normalizedWorkspaceStyles).toMatch(
      /\.application-line\.has-team-context \.line-status\s*\{[^}]*align-self:\s*stretch;[^}]*height:\s*auto;[^}]*margin-block:\s*2px;/s,
    )
  })

  it('uses one calm two-row label and value grid for teachers and student', () => {
    expect(normalizedTeamStyles).toMatch(
      /\.team-line-context\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*max-content minmax\(0,\s*1fr\);[^}]*row-gap:\s*1px;[^}]*border:\s*0;[^}]*background:\s*transparent;/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /\.team-line-context small\s*\{[^}]*font-size:\s*9px;[^}]*font-weight:\s*650;[^}]*white-space:\s*nowrap;/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /\.team-line-context b\s*\{[^}]*font-size:\s*10px;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s,
    )
    expect(normalizedTeamStyles).not.toMatch(/\.team-line-context svg/u)
  })
})
