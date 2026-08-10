import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  phdApi,
  type CodexAuthorizationSummary,
  type CodexDeviceAuthorizationPreview,
} from '../../api/phdApi'
import { getDict, preloadLanguage, t, tpl } from '../../i18n'
import { I18nContext } from '../hooks/useI18n'
import { CodexAuthorizationManager } from './CodexAuthorizationManager'

function authorization(overrides: Partial<CodexAuthorizationSummary> = {}): CodexAuthorizationSummary {
  return {
    id: 'authorization-1',
    name: 'Research laptop',
    clientName: 'Codex',
    deviceName: 'Lab Surface',
    scopeVersion: 2,
    scopes: ['applications:read'],
    createdAt: '2026-08-01T09:00:00.000Z',
    lastUsedAt: '2026-08-06T09:00:00.000Z',
    expiresAt: '2027-08-01T09:00:00.000Z',
    revokedAt: null,
    disabledAt: null,
    status: 'active',
    tokenHint: 'phda_cdx_••••9K2F',
    ...overrides,
  }
}

function managerNode(userId = 'user-1', onNotify = vi.fn(), sessionToken = `session-${userId}`) {
  return (
    <I18nContext.Provider
      value={{ lang: 'en', t: getDict('en'), format: tpl, tx: (path, fallback) => t('en', path, fallback) }}
    >
      <CodexAuthorizationManager
        sessionToken={sessionToken}
        userId={userId}
        onNotify={onNotify}
      />
    </I18nContext.Provider>
  )
}

async function renderManager(userId = 'user-1', onNotify = vi.fn(), waitForInitialLoad = true) {
  await preloadLanguage('en', ['settings'])
  const view = render(managerNode(userId, onNotify))
  if (waitForInitialLoad) {
    await waitFor(() => expect(screen.queryByText('Loading Codex authorizations…')).not.toBeInTheDocument())
  }
  return { ...view, user: userEvent.setup(), onNotify }
}

describe('CodexAuthorizationManager', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.history.replaceState({}, '', '/settings')
    vi.spyOn(phdApi, 'listCodexAuthorizations').mockResolvedValue([])
  })

  it('distinguishes loading from an acknowledged empty connection list', async () => {
    let resolveList: ((items: CodexAuthorizationSummary[]) => void) | undefined
    vi.spyOn(phdApi, 'listCodexAuthorizations').mockReturnValue(new Promise((resolve) => {
      resolveList = resolve
    }))

    await renderManager('user-1', vi.fn(), false)
    expect(screen.getByText('Loading Codex authorizations…')).toBeInTheDocument()
    expect(screen.queryByText('No Codex authorizations yet')).not.toBeInTheDocument()

    resolveList?.([])
    expect(await screen.findByText('No Codex authorizations yet')).toBeInTheDocument()
  })

  it('offers direct Codex and Claude installs without a manual authorization surface', async () => {
    const { container, user } = await renderManager()

    expect(container.querySelector('a[href="/downloads/phd-atlas-codex-plugin.zip"]')).toHaveAttribute('download')
    expect(screen.queryByRole('button', { name: 'New authorization' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Let Codex work with/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Every request stays inside/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Claude Desktop' }))
    expect(container.querySelector('a[href="/downloads/phd-atlas-claude.mcpb"]')).toHaveAttribute('download')
    expect(screen.getByText(/Open the MCPB file with Claude Desktop/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Downloads and verification' }))
    expect(container.querySelector('a[href="/downloads/phd-atlas-claude.mcpb.sha256"]')).toHaveAttribute('download')
  })

  it('shows only the requested connected-device fields and actions', async () => {
    vi.spyOn(phdApi, 'listCodexAuthorizations').mockResolvedValue([authorization()])
    await renderManager()

    expect(await screen.findByText('Research laptop')).toBeInTheDocument()
    expect(screen.getAllByText('Codex')).toHaveLength(2)
    expect(screen.getByText('Lab Surface')).toBeInTheDocument()
    expect(screen.getByText('Last used')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.queryByText('phda_cdx_••••9K2F')).not.toBeInTheDocument()
    expect(screen.queryByText('applications:read')).not.toBeInTheDocument()
    expect(screen.queryByText(/Created/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Expires/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Permissions' })).not.toBeInTheDocument()
  })

  it('renames a connection in place', async () => {
    const listed = authorization()
    vi.spyOn(phdApi, 'listCodexAuthorizations').mockResolvedValue([listed])
    const rename = vi.spyOn(phdApi, 'updateCodexAuthorization')
      .mockResolvedValue({ ...listed, name: 'Office desktop' })
    const { user } = await renderManager()

    await user.click(await screen.findByRole('button', { name: 'Rename Research laptop' }))
    const input = screen.getByRole('textbox', { name: 'Authorization name' })
    await user.clear(input)
    await user.type(input, 'Office desktop')
    await user.click(screen.getByRole('button', { name: 'Save name' }))

    expect(rename).toHaveBeenCalledWith('session-user-1', 'authorization-1', 'Office desktop')
    expect(await screen.findByText('Office desktop')).toBeInTheDocument()
  })

  it('keeps failed rename and delete actions retryable', async () => {
    vi.spyOn(phdApi, 'listCodexAuthorizations').mockResolvedValue([authorization()])
    vi.spyOn(phdApi, 'updateCodexAuthorization').mockRejectedValue(new Error('Rename failed on server'))
    vi.spyOn(phdApi, 'deleteCodexAuthorization').mockRejectedValue(new Error('Delete failed on server'))
    const { user } = await renderManager()

    await user.click(await screen.findByRole('button', { name: 'Rename Research laptop' }))
    const input = screen.getByRole('textbox', { name: 'Authorization name' })
    await user.clear(input)
    await user.type(input, 'Office desktop')
    await user.click(screen.getByRole('button', { name: 'Save name' }))
    expect(await screen.findByText('Rename failed on server')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Office desktop')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel rename' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const confirm = screen.getByRole('alertdialog', { name: 'Delete' })
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(within(confirm).getByRole('button', { name: 'Delete' })).toBeEnabled())
    expect(screen.getByRole('alertdialog', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.getByText('Research laptop')).toBeInTheDocument()
  })

  it('pauses and resumes a connection without removing it', async () => {
    const listed = authorization()
    vi.spyOn(phdApi, 'listCodexAuthorizations').mockResolvedValue([listed])
    const setDisabled = vi.spyOn(phdApi, 'setCodexAuthorizationDisabled')
      .mockImplementation(async (_token, _id, disabled) => ({
        ...listed,
        disabledAt: disabled ? '2026-08-06T09:00:00.000Z' : null,
        status: disabled ? 'disabled' : 'active',
      }))
    const { user } = await renderManager()

    await user.click(await screen.findByRole('button', { name: 'Pause' }))
    expect(setDisabled).toHaveBeenLastCalledWith('session-user-1', 'authorization-1', true)
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeInTheDocument()
    expect(screen.getByText('Research laptop')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Resume' }))
    expect(setDisabled).toHaveBeenLastCalledWith('session-user-1', 'authorization-1', false)
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeInTheDocument()
  })

  it('previews an mcpCode request and keeps a return-to-client confirmation after approval', async () => {
    const preview: CodexDeviceAuthorizationPreview = {
      id: 'device-request-1',
      status: 'pending',
      clientName: 'Claude Desktop',
      deviceName: 'Research workstation',
      scopeVersion: 2,
      requestedScopes: ['applications:read', 'communications:send'],
      requestedExpiresInDays: 365,
      expiresAt: '2026-10-01T12:00:00.000Z',
    }
    window.history.replaceState({}, '', '/settings?mcpCode=ABCD-EFGH')
    vi.spyOn(phdApi, 'previewCodexDeviceAuthorization').mockResolvedValue(preview)
    const approve = vi.spyOn(phdApi, 'approveCodexDeviceAuthorization').mockResolvedValue({
      deviceAuthorization: { ...preview, status: 'approved' },
    })
    const { user } = await renderManager()

    const dialog = await screen.findByRole('dialog', { name: 'Approve MCP connection' })
    expect(within(dialog).getByText('Claude Desktop')).toBeInTheDocument()
    expect(within(dialog).getByText('communications:send')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Approve connection' }))

    await waitFor(() => expect(approve).toHaveBeenCalledWith('session-user-1', 'ABCD-EFGH'))
    expect(await within(dialog).findByText('Connected. You can close this page and return to Claude Desktop.')).toBeInTheDocument()
    expect(window.location.search).toBe('')
    expect(screen.getByRole('dialog', { name: 'Approve MCP connection' })).toBeInTheDocument()
  })

  it('still accepts the legacy codexCode callback and aborts preview on close', async () => {
    let resolvePreview: ((value: CodexDeviceAuthorizationPreview) => void) | undefined
    const previewRequest = vi.spyOn(phdApi, 'previewCodexDeviceAuthorization').mockReturnValue(
      new Promise((resolve) => { resolvePreview = resolve }),
    )
    window.history.replaceState({}, '', '/settings?codexCode=ABCD-EFGH')
    const { user } = await renderManager()

    const dialog = await screen.findByRole('dialog', { name: 'Approve MCP connection' })
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(window.location.search).toBe('')
    expect(previewRequest).toHaveBeenCalledWith(
      'session-user-1',
      'ABCD-EFGH',
      { signal: expect.any(AbortSignal) },
    )

    resolvePreview?.({
      id: 'late',
      status: 'pending',
      clientName: 'Codex',
      deviceName: 'Late device',
      scopeVersion: 2,
      requestedScopes: ['applications:read'],
      requestedExpiresInDays: 365,
      expiresAt: null,
    })
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    expect(screen.queryByRole('dialog', { name: 'Approve MCP connection' })).not.toBeInTheDocument()
  })
})
