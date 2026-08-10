import { act, render, screen, within } from '@testing-library/react'
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
  'offlineStatus.blockedReason.conflict': 'The local value is preserved until you review it.',
  'offlineStatus.blockedReason.missing': 'This application no longer exists on the server.',
  'offlineStatus.blockedReason.permission': 'Access to this application changed while you were offline.',
  'offlineStatus.reviewLocalCopy': 'Review local copy',
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

type QueueState = { pending: number; blocked: number; blockedReason?: string | null }

function renderCenter(
  overrides: Partial<ConnectivitySnapshot> = {},
  queue: QueueState = { pending: 2, blocked: 0 },
) {
  const onToggleOffline = vi.fn()
  const onRetry = vi.fn()
  const renderStatusCenter = (
    nextOverrides: Partial<ConnectivitySnapshot>,
    nextQueue: QueueState,
  ) => (
    <OfflineStatusCenter
      connectivity={{ ...baseConnectivity, ...nextOverrides }}
      language="en"
      snapshotActive
      snapshotSavedAt="2026-07-19T09:30:00.000Z"
      offlineAccessExpiresAt="2026-07-19T21:30:00.000Z"
      pendingCount={nextQueue.pending}
      blockedCount={nextQueue.blocked}
      blockedReason={nextQueue.blockedReason ?? null}
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
      nextQueue: QueueState = queue,
    ) => view.rerender(renderStatusCenter(nextOverrides, nextQueue)),
  }
}

function syncQueueValue() {
  const dialog = screen.getByRole('dialog', { name: 'Connection and offline status' })
  return within(dialog).getByText('Sync queue').closest('div')?.querySelector('strong')?.textContent
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

  it('offers no manual recovery for an unsynced change, only retry', async () => {
    const user = userEvent.setup()
    const { onRetry } = renderCenter(
      { mode: 'online', serverReachable: true },
      { pending: 0, blocked: 1, blockedReason: 'conflict:program' },
    )

    await user.click(screen.getByRole('button', { name: /1 not synced/i }))

    expect(screen.getByText('The local value is preserved until you review it.')).toBeTruthy()
    // Reconnecting is the whole recovery flow now: a divergent edit is settled
    // by authoring time on the next sync, so there is nothing to hand-resolve.
    expect(screen.queryByRole('button', { name: 'Review local copy' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^save$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^discard$/i })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Retry and sync' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('never reports a blocked change as merely pending', async () => {
    const user = userEvent.setup()
    renderCenter({ mode: 'online', serverReachable: true }, { pending: 2, blocked: 1 })

    const trigger = screen.getByRole('button', { name: /1 not synced/i })
    expect(screen.queryByRole('button', { name: /3 pending/i })).toBeNull()

    await user.click(trigger)

    expect(syncQueueValue()).toBe('2 pending · 1 not synced')
  })

  it('summarizes a queue that is only waiting to upload without a blocked count', async () => {
    const user = userEvent.setup()
    renderCenter({ mode: 'online', serverReachable: true }, { pending: 2, blocked: 0 })

    await user.click(screen.getByRole('button', { name: /2 pending/i }))

    expect(syncQueueValue()).toBe('2 pending')
  })

  it('explains the reason the server actually refused the change', async () => {
    const user = userEvent.setup()
    renderCenter(
      { mode: 'online', serverReachable: true },
      { pending: 0, blocked: 1, blockedReason: 'missing' },
    )

    await user.click(screen.getByRole('button', { name: /1 not synced/i }))

    expect(screen.getByText('This application no longer exists on the server.')).toBeTruthy()
    expect(screen.queryByText('The local value is preserved until you review it.')).toBeNull()
  })
})
