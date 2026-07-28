import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TeamTransferPreflight } from '../../api/phdApi'
import { applications } from '../../data/applications'
import { I18nContext, type I18nContextValue } from '../hooks/useI18n'
import { ApplicationTransferDialog } from './ApplicationTransferDialog'

const i18nContext: I18nContextValue = {
  lang: 'en',
  t: {},
  format: (template, values) => template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? '')),
  tx: (path, fallback) => fallback ?? path,
}

describe('ApplicationTransferDialog', () => {
  it('hands the animated checking state over to the result list', async () => {
    const application = {
      ...structuredClone(applications[0]),
      teamId: 'team-1',
    }
    let resolvePreflight!: (value: TeamTransferPreflight) => void
    const preflight = new Promise<TeamTransferPreflight>((resolve) => {
      resolvePreflight = resolve
    })

    render(
      <I18nContext.Provider value={i18nContext}>
        <ApplicationTransferDialog
          open
          application={application}
          direction="leave"
          approvalRequired={false}
          organizations={[{
            teamId: 'team-1',
            name: 'Atlas Lab',
            ownerId: 'owner-1',
            viewerRole: 'admin',
            membershipId: 'member-1',
            memberCount: 2,
            applicationCount: 1,
            pendingTransferCount: 0,
            updatedAt: '2026-07-26T00:00:00.000Z',
          }]}
          onPreflight={() => preflight}
          onSubmit={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nContext.Provider>,
    )

    expect(screen.getByRole('status')).toHaveClass('active')
    expect(document.querySelector('.application-transfer-checking-indicator')).toBeInTheDocument()

    resolvePreflight({
      direction: 'leave',
      teamId: 'team-1',
      teamName: 'Atlas Lab',
      eligible: true,
      checks: [{
        id: 'permission',
        ok: true,
        reasonCode: null,
        used: null,
        limit: null,
      }],
    })

    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(document.querySelector('.application-transfer-check-list.active')).toBeInTheDocument()
    })
  })

  it('ends the checking state and exposes a failed preflight instead of spinning forever', async () => {
    const application = {
      ...structuredClone(applications[0]),
      teamId: 'team-1',
    }

    render(
      <I18nContext.Provider value={i18nContext}>
        <ApplicationTransferDialog
          open
          application={application}
          direction="leave"
          approvalRequired={false}
          organizations={[{
            teamId: 'team-1',
            name: 'Atlas Lab',
            ownerId: 'owner-1',
            viewerRole: 'admin',
            membershipId: 'member-1',
            memberCount: 2,
            applicationCount: 1,
            pendingTransferCount: 0,
            updatedAt: '2026-07-26T00:00:00.000Z',
          }]}
          onPreflight={vi.fn().mockRejectedValue(new Error('Preflight failed'))}
          onSubmit={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nContext.Provider>,
    )

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Preflight failed'))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'dossier.teamVisibilityMoveToPersonal' })).toBeDisabled()
  })

  it('checks the application team directly when the manager workspace summary is temporarily empty', async () => {
    const application = {
      ...structuredClone(applications[0]),
      teamId: 'team-1',
    }
    const onPreflight = vi.fn().mockResolvedValue({
      direction: 'leave',
      teamId: 'team-1',
      teamName: 'Atlas Lab',
      eligible: true,
      checks: [{
        id: 'permission',
        ok: true,
        reasonCode: null,
        used: null,
        limit: null,
      }],
    } satisfies TeamTransferPreflight)

    render(
      <I18nContext.Provider value={i18nContext}>
        <ApplicationTransferDialog
          open
          application={application}
          direction="leave"
          approvalRequired={false}
          organizations={[]}
          onPreflight={onPreflight}
          onSubmit={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nContext.Provider>,
    )

    await waitFor(() => expect(onPreflight).toHaveBeenCalledWith('team-1'))
    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(document.querySelector('.application-transfer-check-list.active')).toBeInTheDocument()
    })
  })

  it('does not cancel and restart an in-flight check when equivalent organization objects rerender', async () => {
    const application = {
      ...structuredClone(applications[0]),
      teamId: 'team-1',
    }
    let resolvePreflight!: (value: TeamTransferPreflight) => void
    const preflight = new Promise<TeamTransferPreflight>((resolve) => {
      resolvePreflight = resolve
    })
    const onPreflight = vi.fn(() => preflight)
    const organization = {
      teamId: 'team-1',
      name: 'Atlas Lab',
      ownerId: 'owner-1',
      viewerRole: 'admin' as const,
      membershipId: 'member-1',
      memberCount: 2,
      applicationCount: 1,
      pendingTransferCount: 0,
      updatedAt: '2026-07-26T00:00:00.000Z',
    }
    const renderDialog = (updatedAt: string) => (
      <I18nContext.Provider value={i18nContext}>
        <ApplicationTransferDialog
          open
          application={application}
          direction="leave"
          approvalRequired={false}
          organizations={[{ ...organization, updatedAt }]}
          onPreflight={onPreflight}
          onSubmit={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nContext.Provider>
    )
    const view = render(renderDialog(organization.updatedAt))

    await waitFor(() => expect(onPreflight).toHaveBeenCalledTimes(1))
    view.rerender(renderDialog('2026-07-26T00:01:00.000Z'))
    await Promise.resolve()
    expect(onPreflight).toHaveBeenCalledTimes(1)

    resolvePreflight({
      direction: 'leave',
      teamId: 'team-1',
      teamName: 'Atlas Lab',
      eligible: true,
      checks: [{
        id: 'permission',
        ok: true,
        reasonCode: null,
        used: null,
        limit: null,
      }],
    })

    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(document.querySelector('.application-transfer-check-list.active')).toBeInTheDocument()
    })
  })
})
