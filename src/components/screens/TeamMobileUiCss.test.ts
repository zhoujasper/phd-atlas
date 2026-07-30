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

  it('keeps phone notification copy beside its icon and refines all four launcher actions', () => {
    expect(normalizedTeamStyles).toMatch(
      /@media \(max-width:\s*640px\)\s*\{[\s\S]*?\.team-notification-launcher \.notification-publisher-title\s*\{[^}]*grid-template-columns:\s*30px minmax\(0,\s*1fr\);[^}]*gap:\s*8px;[^}]*\}/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /\.team-notification-launcher \.notification-publisher-icon\s*\{[^}]*width:\s*30px;[^}]*height:\s*30px;[^}]*\}/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /body \.team-notification-launcher \.notification-publisher-head-actions :is\(\.quiet-action,\s*\.primary-action\)\s*\{[^}]*height:\s*var\(--action-height-compact\);[^}]*min-height:\s*var\(--action-height-compact\) !important;[^}]*padding-inline:\s*8px;[^}]*font-size:\s*11px;[^}]*\}/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /@media \(max-width:\s*560px\)\s*\{[\s\S]*?\.team-collaboration-hero-actions \.quiet-action,\s*\.team-collaboration-hero-actions \.primary-action\s*\{[^}]*height:\s*var\(--action-height-compact\);[^}]*min-height:\s*var\(--action-height-compact\) !important;[^}]*padding-inline:\s*8px;[^}]*font-size:\s*11px;[^}]*\}/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /\.team-collaboration-hero-actions :is\(\.quiet-action,\s*\.primary-action\) svg\s*\{[^}]*width:\s*12px;[^}]*height:\s*12px;[^}]*\}/s,
    )
  })

  it('removes sticky desktop lift feedback on coarse touch devices', () => {
    expect(normalizedTeamStyles).toMatch(
      /@media \(hover:\s*none\) and \(pointer:\s*coarse\)\s*\{[\s\S]*?:hover\s*\{[^}]*transform:\s*none;[^}]*\}/s,
    )
  })

  it('turns the phone overview into a compact signal rail with restrained details', () => {
    expect(normalizedTeamStyles).toMatch(
      /@media \(max-width:\s*560px\)\s*\{[\s\S]*?\.team-overview-queue-list\s*\{[^}]*--team-overview-mobile-step:\s*80px;[^}]*display:\s*flex;[^}]*overflow-x:\s*auto;[^}]*scroll-snap-type:\s*x proximity;/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /\.team-overview-queue-slider\s*\{[^}]*width:\s*var\(--team-overview-mobile-step\);[^}]*transform:\s*translate3d\(\s*calc\(var\(--team-overview-selected-index\) \* 100%\)/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /\.team-overview-queue-item\s*\{[^}]*height:\s*52px;[^}]*flex:\s*0 0 var\(--team-overview-mobile-step\);/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /\.team-overview-preview-icon,\s*\.team-overview-preview-avatar\s*\{[^}]*width:\s*32px;[^}]*height:\s*32px;/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /\.team-overview-preview-metrics\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/s,
    )
    expect(normalizedTeamStyles).toMatch(
      /\.team-screen \.team-overview-preview-summary \.primary-action,[\s\S]*?\.team-screen \.team-overview-preview-footer \.quiet-action\s*\{[^}]*width:\s*auto;[^}]*min-height:\s*34px;/s,
    )
  })
})
