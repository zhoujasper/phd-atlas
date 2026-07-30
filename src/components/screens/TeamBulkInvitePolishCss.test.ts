import { describe, expect, it } from 'vitest'
import settingsSource from './SettingsScreen.tsx?raw'
import teamSource from './TeamScreen.tsx?raw'
import settingsStyles from '../../styles/settings.css?raw'
import teamStyles from '../../styles/team.css?raw'

describe('team bulk invitation and stable ID surfaces', () => {
  it('keeps responsible-teacher selection inside each bulk record', () => {
    expect(teamSource.match(/renderInviteTeacherPicker\(\)/g)).toHaveLength(2)
    expect(teamSource).toContain('buildTeamBulkInvitePreview(bulkInviteText, invitationTeachers, roles)')
    expect(teamSource).toContain('row.teacherMemberIds')
    expect(teamSource).toContain("tx('team.bulkInviteIssueUnavailableRole')")
  })

  it('offers CSV import, a role-aware template, and a review-before-send list', () => {
    expect(teamSource).toContain('accept=".csv,text/csv"')
    expect(teamSource).toContain('createTeamBulkInviteTemplate(invitationTeachers, allowedRoles)')
    expect(teamSource).toContain('className="team-bulk-invite-preview-list"')
    expect(teamSource).toContain('|| !bulkInviteReady')
  })

  it('uses one continuous responsive workspace instead of nested cards', () => {
    expect(teamStyles).toMatch(
      /\.team-bulk-invite-workspace\s*\{[^}]*overflow:\s*hidden[^}]*border:\s*1px solid var\(--border\)[^}]*border-radius:\s*var\(--radius\)/s,
    )
    expect(teamStyles).toMatch(
      /\.team-bulk-invite-input\s*\{[^}]*border:\s*0[^}]*border-radius:\s*0/s,
    )
    expect(teamStyles).toMatch(
      /\.team-bulk-invite-preview-list > div\s*\{[^}]*border-top:\s*1px solid var\(--border\)/s,
    )
    expect(teamStyles).toMatch(
      /@media \(max-width:\s*560px\)\s*\{[\s\S]*?\.team-bulk-invite-toolbar-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s,
    )
  })

  it('shows copyable User and Team IDs at their existing permission boundaries', () => {
    expect(settingsSource).toContain("tx('settings.userIdLabel')")
    expect(settingsSource).toContain('<code title={session.user.id}>{session.user.id}</code>')
    expect(teamSource).toContain("tx('team.settingsTeamIdLabel')")
    expect(teamSource).toContain('<code title={summary?.team.id}>{summary?.team.id}</code>')
    expect(settingsStyles).toMatch(
      /\.settings-account-id\s*\{[^}]*grid-template-columns:\s*13px minmax\(0,\s*1fr\) 26px/s,
    )
    expect(teamStyles).toMatch(
      /\.team-organization-id-row\s*\{[^}]*grid-template-columns:\s*30px minmax\(0,\s*1fr\) 30px/s,
    )
  })

  it('keeps the Settings User ID on one line and progressively reveals copy', () => {
    expect(settingsStyles).toMatch(
      /\.settings-account-id > span\s*\{[^}]*display:\s*flex[^}]*align-items:\s*baseline[^}]*gap:\s*4px/s,
    )
    expect(settingsStyles).toMatch(
      /\.settings-account-id-copy\.copy-button\s*\{[^}]*opacity:\s*0[^}]*transform:\s*translate3d\(3px,\s*0,\s*0\) scale\(0\.94\)[^}]*pointer-events:\s*none[^}]*transition:[^}]*opacity var\(--duration-fast\) var\(--ease-out\)[^}]*transform var\(--duration\) var\(--ease-out\)/s,
    )
    expect(settingsStyles).toMatch(
      /\.settings-account-id:hover \.settings-account-id-copy\.copy-button,\s*\.settings-account-id:focus-within \.settings-account-id-copy\.copy-button\s*\{[^}]*opacity:\s*1[^}]*transform:\s*translate3d\(0,\s*0,\s*0\) scale\(1\)[^}]*pointer-events:\s*auto/s,
    )
    expect(settingsStyles).toMatch(
      /@media \(hover:\s*none\), \(pointer:\s*coarse\)\s*\{[\s\S]*?\.settings-account-id-copy\.copy-button\s*\{[^}]*opacity:\s*1[^}]*pointer-events:\s*auto/s,
    )
    expect(settingsStyles).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.settings-account-id-copy\.copy-button,[\s\S]*?transition-duration:\s*0\.01ms !important/s,
    )
  })
})
