import { act, render, screen } from '@testing-library/react'
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
  'offlineStatus.queueSummary': '{pending} pending · {blocked} not synced',
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
  'offlineStatus.blocked': '{count} not synced',
  'offlineStatus.snapshot': 'Offline snapshot',
  'offlineStatus.accessUntil': 'Offline access until',
  'offlineStatus.personalScopeValue': 'Your personal applications only',
  'offlineStatus.permissionProtected': 'The server rechecks permissions before sync.',
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

function renderCenter(
  overrides: Partial<ConnectivitySnapshot> = {},
  queue: { pending: number; blocked: number } = { pending: 2, blocked: 0 },
) {
  const onToggleOffline = vi.fn()
  const onRetry = vi.fn()
  const renderStatusCenter = (
    nextOverrides: Partial<ConnectivitySnapshot>,
    nextQueue: { pending: number; blocked: number },
  ) => (
    <OfflineStatusCenter
      connectivity={{ ...baseConnectivity, ...nextOverrides }}
      language="en"
      snapshotActive
      snapshotSavedAt="2026-07-19T09:30:00.000Z"
      offlineAccessExpiresAt="2026-07-19T21:30:00.000Z"
      pendingCount={nextQueue.pending}
      blockedCount={nextQueue.blocked}
      syncing={false}
      updateReady={false}
      onRetry={onRetry}
      onInstallUpdate={vi.fn()}
      onToggleOffline={onToggleOffline}
      tx={(key, fallback) => labels[key] ?? fallback ?? key}
    />
  )
  const view = render(renderStatusCenter(overrides, queue))
  return {
    onRetry,
    onToggleOffline,
    rerenderCenter: (
      nextOverrides: Partial<ConnectivitySnapshot>,
      nextQueue: { pending: number; blocked: number } = queue,
    ) => view.rerender(renderStatusCenter(nextOverrides, nextQueue)),
  }
}

describe('OfflineStatusCenter', () => {
  it('briefly reveals changed status text before returning to the icon-only state', () => {
    vi.useFakeTimers()
    try {
      const { rerenderCenter } = renderCenter()

      const trigger = screen.getByRole('button', { name: /Server unavailable/i })
      const center = trigger.closest('.offline-status-center')
      expect(center?.classList.contains('is-status-announcing')).toBe(true)
      expect(trigger.querySelector('.offline-status-pill-content')?.textContent).toContain('Server unavailable')

      act(() => vi.advanceTimersByTime(2800))

      expect(center?.classList.contains('is-status-announcing')).toBe(false)
      expect(trigger.querySelector(':scope > svg')).toBeTruthy()

      rerenderCenter({ mode: 'checking', serverReachable: null })

      expect(screen.getByRole('button', { name: /Checking connection/i })).toBeTruthy()
      expect(center?.classList.contains('is-status-announcing')).toBe(true)
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it('explains a server outage and offers immediate offline work', async () => {
    const user = userEvent.setup()
    const { onToggleOffline } = renderCenter()

    await user.click(screen.getByRole('button', { name: /Server unavailable/i }))

    const dialog = screen.getByRole('dialog', { name: 'Connection and offline status' })
    expect(dialog).toBeTruthy()
    expect(dialog.closest('.offline-status-center')?.getAttribute('data-overflow-reveal')).toBe('off')
    expect(screen.getByText('The server cannot be reached.')).toBeTruthy()
    expect(screen.getByText('Your personal applications only')).toBeTruthy()
    expect(screen.getByText('The server rechecks permissions before sync.')).toBeTruthy()
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

  it('keeps blocked changes on the automatic retry path without opening manual review', async () => {
    const user = userEvent.setup()
    const { onRetry } = renderCenter(
      { mode: 'online', serverReachable: true },
      { pending: 0, blocked: 1 },
    )

    await user.click(screen.getByRole('button', { name: /1 pending/i }))

    expect(screen.queryByRole('button', { name: /review/i })).toBeNull()
    expect(screen.queryByText(/review/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /^save$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^discard$/i })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Retry and sync' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
