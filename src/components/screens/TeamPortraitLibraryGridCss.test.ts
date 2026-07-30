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

  it('uses one white moving selection surface, animated fallback inversion, and one opacity-only portrait handoff', () => {
    expect(normalizedTeamStyles).toMatch(
      /\.team-portrait-student-selection\s*\{[^}]*border:\s*1px solid var\(--border\);[^}]*background:\s*var\(--surface\);[^}]*box-shadow:\s*var\(--shadow-sm\);[^}]*transform:\s*translate3d\(0,\s*var\(--team-portrait-selection-y,\s*0\),\s*0\);[^}]*transition:[^}]*transform var\(--duration\) var\(--ease-out\)/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /\.team-portrait-student-list\.has-selection-slider \.team-portrait-student-row\.selected\s*\{[^}]*background:\s*transparent;/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /\.team-portrait-student-selection\.is-moving ~ \.team-portrait-student-row:hover,\s*\.team-portrait-student-selection\.is-moving ~ \.team-portrait-student-row:active\s*\{[^}]*background:\s*transparent;[^}]*transform:\s*none;[^}]*background 0ms linear,[^}]*transform 0ms linear;/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /@keyframes team-portrait-student-handoff-a\s*\{\s*from\s*\{\s*opacity:\s*0\.52;\s*\}\s*to\s*\{\s*opacity:\s*1;\s*\}\s*\}/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /\.team-portrait-student-avatar\.team-member-avatar-fallback\s*\{[^}]*background-color:\s*color-mix\([^;]+;[^}]*background-image:\s*none;[^}]*transition:[^}]*background-color var\(--duration\) var\(--ease-out\),[^}]*color var\(--duration\) var\(--ease-out\)/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /\.team-portrait-student-row\.selected \.team-portrait-student-avatar\.team-member-avatar-fallback\s*\{[^}]*background-color:\s*var\(--accent\);[^}]*color:\s*var\(--text-inverse\);/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /::view-transition-old\(team-portrait-student-profile\),\s*::view-transition-new\(team-portrait-student-profile\)\s*\{[^}]*animation-duration:\s*190ms;[^}]*mix-blend-mode:\s*plus-lighter;/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /html\[data-team-portrait-transition-token\]\s*\{\s*view-transition-name:\s*none;\s*\}/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /html\[data-team-portrait-transition-token\] \.screen-stage\s*\{\s*view-transition-name:\s*none;\s*\}/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /::view-transition-group\(team-portrait-student-profile\)\s*\{[^}]*animation:\s*none;/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /\.team-portrait-profile-content\s*\{[^}]*overflow-anchor:\s*none;/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /\.team-portrait-profile-content\.is-native-handoff\.is-handoff-a,[^}]*\{[^}]*animation:\s*none;/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /\.team-portrait-profile-content\[data-student-portrait-stable='true'\] \.team-portrait-library-view,\s*\.team-portrait-profile-content\[data-student-portrait-stable='true'\] \.team-portrait-snippet-card\s*\{\s*animation:\s*none;/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?::view-transition-old\(team-portrait-student-profile\),[\s\S]*?\.team-portrait-student-selection,[\s\S]*?\.team-portrait-profile-content,[\s\S]*?transition-duration:\s*0\.01ms !important;/s,
    )
  })

  it('keeps the empty copy intact, makes the full preset target clickable, and avoids a leading picker gutter', () => {
    expect(normalizedTeamStyles).toMatch(
      /\.team-portrait-profile-empty\s*\{[^}]*grid-template-columns:\s*36px minmax\(0,\s*1fr\);[^}]*text-align:\s*left;/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /\.team-portrait-profile-empty-copy\s*>\s*strong\s*\{[^}]*word-break:\s*keep-all;/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /\.team-portrait-dossier-scroll\s*\{[^}]*scrollbar-gutter:\s*stable both-edges;/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /\.team-portrait-template-pane\s*\{[^}]*scrollbar-gutter:\s*stable both-edges;[^}]*border:\s*0;/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /\.team-portrait-preset-target\s*\{[^}]*display:\s*block;[^}]*border:\s*1px solid var\(--border\);/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /\.team-portrait-preset-target \.anchored-popover-root\s*\{[^}]*width:\s*100%;[^}]*display:\s*block;/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /\.team-portrait-preset-target-trigger\s*\{[^}]*width:\s*100%;[^}]*grid-template-columns:\s*auto 30px minmax\(0,\s*1fr\) 14px;[^}]*padding:\s*0 8px 0 0;/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /\.team-portrait-preset-target-options\s*\{[^}]*scrollbar-gutter:\s*stable;[^}]*\}/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.team-portrait-preset-target-trigger > svg:last-child,[^}]*\.team-portrait-preset-target-options > button > svg:last-child[^}]*transition-duration:\s*0\.01ms !important;/s,
    )
  })
})
