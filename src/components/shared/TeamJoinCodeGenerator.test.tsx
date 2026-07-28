import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { getDict, t, tpl } from '../../i18n'
import { I18nContext } from '../hooks/useI18n'
import { TeamJoinCodeGenerator } from './TeamJoinCodeGenerator'

const teachers = [{
  id: 'teacher-member-1',
  userId: 'teacher-user-1',
  displayName: 'Dr. Mei Chen',
  invitedEmail: 'mei@example.com',
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
  it('shows teachers a calm fixed student-role summary instead of a redundant selector', async () => {
    renderGenerator(['member'])

    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.getByText('team.roleMember')).toBeVisible()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dr. Mei Chen' })).toHaveAttribute('aria-pressed', 'true'))
  })

  it('uses descriptive role rows for administrators and submits the selected student assignment', async () => {
    const { onGenerate } = renderGenerator(['admin', 'member'])

    expect(screen.getByRole('radiogroup', { name: 'team.joinCodeRole' })).toBeVisible()
    fireEvent.click(screen.getByRole('radio', { name: /team\.roleMember/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dr. Mei Chen' })).toHaveAttribute('aria-pressed', 'true'))
    fireEvent.click(screen.getByRole('button', { name: 'team.joinCodeGenerate' }))

    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith({
      role: 'member',
      teacherIds: ['teacher-member-1'],
    }))
  })
})
