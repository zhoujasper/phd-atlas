import { describe, expect, it } from 'vitest'
import teamStyles from '../../styles/team.css?raw'

const normalizedTeamStyles = teamStyles.replace(/\r\n/g, '\n')

describe('team portrait library card grid CSS', () => {
  it('uses a compact four-up wrapping flow while retaining the personal stack mechanics', () => {
    expect(normalizedTeamStyles).toMatch(
      /\.team-portrait-library-view\.is-cards\s*\{[^}]*container-name:\s*team-portrait-library;[^}]*container-type:\s*inline-size;[^}]*\}/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /\.team-portrait-snippet-card-grid\s*\{[^}]*--snippet-stack-card-width:\s*200px;[^}]*--snippet-stack-gap:\s*16px;[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;[^}]*gap:\s*20px 16px;[^}]*overflow-anchor:\s*none;[^}]*\}/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /\.team-portrait-snippet-card-grid\s*>\s*\.snippet-stack\s*\{[^}]*--snippet-stack-card-width:\s*200px;[^}]*--snippet-stack-gap:\s*16px;[^}]*\}/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /@media \(max-width:\s*820px\)\s*\{[\s\S]*?\.team-portrait-snippet-card-grid\s*\{[^}]*gap:\s*20px 16px;[^}]*\}\s*\}/s,
    )
  })

  it('uses one moving selection surface and one opacity-only portrait handoff', () => {
    expect(normalizedTeamStyles).toMatch(
      /\.team-portrait-student-selection\s*\{[^}]*transform:\s*translate3d\(0,\s*var\(--team-portrait-selection-y,\s*0\),\s*0\);[^}]*transition:[^}]*transform var\(--duration\) var\(--ease-out\)/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /\.team-portrait-student-list\.has-selection-slider \.team-portrait-student-row\.selected\s*\{[^}]*background:\s*transparent;/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /@keyframes team-portrait-student-handoff-a\s*\{\s*from\s*\{\s*opacity:\s*0\.52;\s*\}\s*to\s*\{\s*opacity:\s*1;\s*\}\s*\}/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /\.team-portrait-profile-content\[data-student-portrait-stable='true'\] \.team-portrait-library-view,\s*\.team-portrait-profile-content\[data-student-portrait-stable='true'\] \.team-portrait-snippet-card\s*\{\s*animation:\s*none;/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.team-portrait-student-selection,[\s\S]*?\.team-portrait-profile-content,[\s\S]*?transition-duration:\s*0\.01ms !important;/s,
    )
  })
})
