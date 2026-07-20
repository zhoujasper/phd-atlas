import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ConnectivitySnapshot } from '../../connectivity'
import { OfflineStatusCenter } from './OfflineStatusCenter'

const labels: Record<string, string> = {
  'offlineStatus.serverUnavailable': 'Server unavailable',
  'offlineStatus.workingOffline': 'Working offline',
  'offlineStatus.serverUnavailableDetail': 'The server cannot be reached.',
  'offlineStatus.manualDetail': 'You chose to work offline.',
  'offlineStatus.panelTitle': 'Connection and offline status',
  'offlineStatus.server': 'Server',
  'offlineStatus.reachable': 'Reachable',
  'offlineStatus.unreachable': 'Unavailable',
  'offlineStatus.localCopy': 'Local copy',
  'offlineStatus.syncQueue': 'Sync queue',
  'offlineStatus.queueSummary': '{pending} pending · {blocked} review',
  'offlineStatus.queueBadge': '{count} local changes',
  'offlineStatus.notAvailable': 'Not saved yet',
  'offlineStatus.retry': 'Retry and sync',
  'offlineStatus.workOffline': 'Work offline',
  'offlineStatus.resumeOnline': 'Resume online',
  'offlineStatus.offline': 'Offline',
  'offlineStatus.offlineDetail': 'Offline detail',
  'offlineStatus.onlineDetail': 'Online detail',
  'offlineStatus.checking': 'Checking connection',
  'offlineStatus.syncing': 'Syncing local changes',
  'offlineStatus.pending': '{count} pending',
  'offlineStatus.blocked': '{count} review',
  'offlineStatus.snapshot': 'Offline snapshot',
}

const baseConnectivity: ConnectivitySnapshot = {
  mode: 'server-unreachable',
  browserOnline: true,
  serverReachable: false,
  manualOffline: false,
  latencyMs: null,
  checkedAt: '2026-07-19T10:00:00.000Z',
  lastOnlineAt: null,
  consecutiveFailures: 1,
}

function renderCenter(overrides: Partial<ConnectivitySnapshot> = {}) {
  const onToggleOffline = vi.fn()
  render(
    <OfflineStatusCenter
      connectivity={{ ...baseConnectivity, ...overrides }}
      language="en"
      snapshotActive
      snapshotSavedAt="2026-07-19T09:30:00.000Z"
      pendingCount={2}
      blockedCount={0}
      syncing={false}
      updateReady={false}
      onRetry={vi.fn()}
      onReviewBlocked={vi.fn()}
      onInstallUpdate={vi.fn()}
      onToggleOffline={onToggleOffline}
      tx={(key, fallback) => labels[key] ?? fallback ?? key}
    />,
  )
  return { onToggleOffline }
}

describe('OfflineStatusCenter', () => {
  it('explains a server outage and offers immediate offline work', async () => {
    const user = userEvent.setup()
    const { onToggleOffline } = renderCenter()

    await user.click(screen.getByRole('button', { name: /Server unavailable/i }))

    expect(screen.getByRole('dialog', { name: 'Connection and offline status' })).toBeTruthy()
    expect(screen.getByText('The server cannot be reached.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Work offline' }))
    expect(onToggleOffline).toHaveBeenCalledTimes(1)
  })

  it('keeps retry disabled until the user leaves manual offline mode', async () => {
    const user = userEvent.setup()
    renderCenter({ mode: 'offline', serverReachable: true, manualOffline: true })

    await user.click(screen.getByRole('button', { name: /Working offline/i }))

    expect(screen.getByText('You chose to work offline.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Retry and sync' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Resume online' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
