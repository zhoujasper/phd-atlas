import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { getDict, t, tpl } from '../../i18n'
import joinCodeStyles from '../../styles/team-join-code.css?raw'
import { I18nContext } from '../hooks/useI18n'
import { TeamJoinCodeGenerator } from './TeamJoinCodeGenerator'

const teachers = [{
  id: 'teacher-member-1',
  userId: 'teacher-user-1',
  displayName: 'Dr. Mei Chen',
  invitedEmail: 'mei@example.com',
}, {
  id: 'teacher-member-2',
  userId: 'teacher-user-2',
  displayName: 'Prof. Alex Rivera',
  invitedEmail: 'alex@example.com',
}]

function renderGenerator(
  roles: Array<'owner' | 'admin' | 'member'>,
  onGenerate = vi.fn().mockResolvedValue({
    id: 'code-1',
    teamId: 'team-1',
    teamName: 'Atlas Lab',
    role: 'member',
    code: 'ABCD-EFGH',
    url: '/team/join/ABCD-EFGH',
    teacherIds: ['teacher-member-1'],
    managerNames: ['Dr. Mei Chen'],
    expiresAt: '2026-07-26T12:30:00.000Z',
    maxUses: null,
    useCount: 0,
    reusable: true,
    createdAt: '2026-07-26T12:00:00.000Z',
    updatedAt: '2026-07-26T12:00:00.000Z',
  }),
) {
  return {
    onGenerate,
    ...render(
      <I18nContext.Provider value={{
        lang: 'en',
        t: getDict('en'),
        format: tpl,
        tx: (path, fallback) => t('en', path, fallback),
      }}>
        <TeamJoinCodeGenerator
          roles={roles}
          teachers={teachers}
          onGenerate={onGenerate}
        />
      </I18nContext.Provider>,
    ),
  }
}

describe('TeamJoinCodeGenerator', () => {
  it('keeps teacher search focus on one composite boundary', () => {
    expect(joinCodeStyles).toMatch(
      /\.team-join-code-teacher-search:focus-within\s*\{[^}]*border-color:\s*var\(--border-strong\)[^}]*box-shadow:\s*0 0 0 2px color-mix\(in srgb,\s*var\(--text\) 7%,\s*transparent\)/s,
    )
    expect(joinCodeStyles).toMatch(
      /\.team-join-code-teacher-search input:focus,\s*\.team-join-code-teacher-search input:focus-visible\s*\{[^}]*border-color:\s*transparent[^}]*outline:\s*none[^}]*box-shadow:\s*none/s,
    )
  })

  it('keeps the role travel and reduced-motion paths in the shared stylesheet', () => {
    expect(joinCodeStyles).toMatch(
      /\.team-join-code-role-indicator\s*\{[^}]*height:\s*var\(--team-join-role-height\)[^}]*transform:\s*translate3d\(\s*0,\s*var\(--team-join-role-y\),\s*0\s*\)[^}]*transition:[^}]*height var\(--duration\) var\(--ease-out\)[^}]*transform var\(--duration\) var\(--ease-out\)/s,
    )
    expect(joinCodeStyles).toMatch(
      /\.team-join-code-role-options button > b svg\s*\{[^}]*opacity:\s*0[^}]*transform:\s*scale\(0\.62\) rotate\(-18deg\)/s,
    )
    expect(joinCodeStyles).toMatch(
      /\.team-join-code-role-options button\.selected > b svg\s*\{[^}]*opacity:\s*1[^}]*transform:\s*scale\(1\) rotate\(0deg\)/s,
    )
    expect(joinCodeStyles).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.team-join-code-role-indicator,[\s\S]*?transition-duration:\s*0\.01ms/,
    )
  })

  it('shows teachers a calm fixed student-role summary instead of a redundant selector', async () => {
    renderGenerator(['member'])

    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.getByText('team.roleMember')).toBeVisible()
    const trigger = await waitFor(() => screen.getByRole('button', {
      name: /team\.joinCodeTeacherAssignment: Dr\. Mei Chen/,
    }))
    expect(screen.queryByRole('listbox')).toBeNull()

    fireEvent.click(trigger)
    expect(screen.getByRole('listbox', { name: 'team.joinCodeTeacherAssignment' })).toBeVisible()
    expect(screen.getByRole('option', { name: /Dr\. Mei Chen/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: /Prof\. Alex Rivera/ })).toHaveAttribute('aria-selected', 'false')
  })

  it('uses descriptive role rows and submits the teachers selected from the dropdown', async () => {
    const { onGenerate } = renderGenerator(['admin', 'member'])

    const roleGroup = screen.getByRole('radiogroup', { name: 'team.joinCodeRole' })
    const roleIndicator = roleGroup.querySelector('.team-join-code-role-indicator')
    const assignment = document.querySelector('.team-join-code-assignment-collapse')
    const adminRole = screen.getByRole('radio', { name: /team\.roleAdmin/ })
    const memberRole = screen.getByRole('radio', { name: /team\.roleMember/ })

    expect(roleGroup).toBeVisible()
    expect(roleIndicator).toHaveClass('is-ready')
    expect(roleGroup.querySelectorAll('button > b svg')).toHaveLength(2)
    expect(assignment).toHaveAttribute('data-collapsible-open', 'false')

    fireEvent.click(memberRole)
    expect(assignment).toHaveAttribute('data-collapsible-open', 'true')
    const trigger = await waitFor(() => screen.getByRole('button', {
      name: /team\.joinCodeTeacherAssignment: Dr\. Mei Chen/,
    }))

    fireEvent.click(adminRole)
    expect(assignment).toHaveAttribute('data-collapsible-open', 'false')
    expect(assignment?.querySelector('.team-join-code-teacher-trigger')).toBeInTheDocument()

    fireEvent.click(memberRole)
    expect(assignment).toHaveAttribute('data-collapsible-open', 'true')
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('option', { name: /Prof\. Alex Rivera/ }))
    fireEvent.click(screen.getByRole('button', { name: /done/i }))
    fireEvent.click(screen.getByRole('button', { name: 'team.joinCodeGenerate' }))

    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith({
      role: 'member',
      teacherIds: ['teacher-member-1', 'teacher-member-2'],
    }))
  })
})
