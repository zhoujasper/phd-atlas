import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { phdApi, type AdminSettings, type SystemInfo } from '../api/phdApi'
import { AdminScreen } from '../components/screens/AdminScreen'

vi.mock('../edition', () => ({ PUBLIC_EDITION: true }))

const settings: AdminSettings = {
  allowRegistration: true,
  notificationMailbox: 'admin-alerts@phd-atlas.local',
  backupFrequency: 'weekly',
  encryptionAtRest: true,
}

const systemInfo: SystemInfo = {
  version: '0.1.0-beta.1',
  nodeVersion: 'v24.0.0',
  platform: 'linux',
  arch: 'x64',
  uptime: 120,
  cpu: {
    model: 'Test CPU',
    cores: 8,
  },
  hostname: 'test-host',
  pid: 1234,
  nodeEnv: 'production',
  memory: {
    total: 8192,
    used: 4096,
    free: 4096,
  },
  storage: {
    database: 1024,
    uploads: 2048,
    uploadFiles: 4,
    backups: 3072,
    backupFiles: 2,
    total: 6144,
  },
  counts: {
    users: 2,
    applications: 3,
    systemEvents: 4,
    profileAssets: 5,
  },
  databasePath: 'storage/phd-atlas.sqlite',
  uploadRoot: 'storage/uploads',
  backupRoot: 'storage/backups',
}

function renderSystemUpdate({
  onSystemUpdate = vi.fn().mockResolvedValue(true),
  onNotify = vi.fn(),
}: {
  onSystemUpdate?: (file: File) => Promise<boolean>
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info' | 'warning') => void
} = {}) {
  render(
    <AdminScreen
      activeTab="systemInfo"
      currentUserId="admin_1"
      token="admin-token"
      settings={settings}
      users={[]}
      logs={[]}
      systemInfo={systemInfo}
      onRegistration={vi.fn()}
      onSettings={vi.fn()}
      onUserUpdate={vi.fn()}
      onUserDelete={vi.fn()}
      onExportLogs={vi.fn()}
      onClearLogs={vi.fn()}
      onChangePassword={vi.fn()}
      onSystemUpdate={onSystemUpdate}
      onRefreshSystemInfo={vi.fn()}
      onNotify={onNotify}
    />,
  )

  return { onSystemUpdate, onNotify }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AdminScreen public system updates', () => {
  it('checks the public Release, presents the newer version, and installs its exact tag', async () => {
    const user = userEvent.setup()
    const onNotify = vi.fn()
    vi.spyOn(phdApi, 'checkSystemUpdate').mockResolvedValue({
      currentVersion: '0.1.0-beta.1',
      updateAvailable: true,
      release: {
        version: '0.1.0-beta.2',
        tagName: 'v0.1.0-beta.2',
        name: 'PhD Atlas 0.1.0 Beta 2',
        publishedAt: '2026-07-23T12:00:00.000Z',
        htmlUrl: 'https://github.com/zhoujasper/phd-atlas/releases/tag/v0.1.0-beta.2',
        prerelease: true,
        package: {
          name: 'phd-atlas-update-0.1.0-beta.2.tar.gz',
          size: 2048,
        },
      },
      checkedAt: '2026-07-23T12:01:00.000Z',
    })
    vi.spyOn(phdApi, 'installReleaseUpdate').mockResolvedValue({
      received: true,
      fileName: 'phd-atlas-update-0.1.0-beta.2.tar.gz',
      size: 2048,
      storedAs: 'phd-atlas-update-0.1.0-beta.2.tar.gz',
      version: '0.1.0-beta.2',
      verified: true,
      restartScheduled: true,
      message: 'ok',
    })

    renderSystemUpdate({ onNotify })

    expect(screen.getByText('PhD Atlas v0.1.0-beta.1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Check for updates' }))

    expect(await screen.findByText('Version 0.1.0-beta.2 is available.')).toBeInTheDocument()
    expect(phdApi.checkSystemUpdate).toHaveBeenCalledWith('admin-token')
    expect(screen.getByRole('link', { name: /view release/i })).toHaveAttribute(
      'href',
      'https://github.com/zhoujasper/phd-atlas/releases/tag/v0.1.0-beta.2',
    )

    await user.click(screen.getByRole('button', { name: 'Install 0.1.0-beta.2' }))

    await waitFor(() => {
      expect(phdApi.installReleaseUpdate).toHaveBeenCalledWith(
        'admin-token',
        'v0.1.0-beta.2',
      )
    })
    expect(onNotify).toHaveBeenCalledWith(
      'Update installed. PhD Atlas is restarting…',
      'success',
    )
  })

  it('keeps the manual package upload flow available behind progressive disclosure', async () => {
    const user = userEvent.setup()
    const onSystemUpdate = vi.fn().mockResolvedValue(true)
    const { onNotify } = renderSystemUpdate({ onSystemUpdate })

    const manualToggle = screen.getByRole('button', { name: /manual update/i })
    expect(manualToggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(manualToggle)

    expect(manualToggle).toHaveAttribute('aria-expanded', 'true')
    const manualPanel = document.querySelector('#admin-manual-update-panel')
    expect(manualPanel).not.toBeNull()
    const packageInput = manualPanel?.querySelector<HTMLInputElement>('input[type="file"]')
    expect(packageInput).not.toBeNull()
    const updatePackage = new File(
      ['verified-package'],
      'phd-atlas-update-0.1.0-beta.2.tar.gz',
      { type: 'application/gzip' },
    )

    await user.upload(packageInput as HTMLInputElement, updatePackage)

    expect(screen.getByText(/phd-atlas-update-0\.1\.0-beta\.2\.tar\.gz/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Upload package' }))

    await waitFor(() => expect(onSystemUpdate).toHaveBeenCalledWith(updatePackage))
    expect(onNotify).toHaveBeenCalledWith(
      'Upgrade package uploaded. The update will be applied after validation.',
      'success',
    )
  })
})
