import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { OfflineUnavailableScreen } from './OfflineUnavailableScreen'

const labels: Record<string, string> = {
  appTitle: 'PhD Atlas',
  'offlineStatus.launchTitle': "You're offline",
  'offlineStatus.launchDetail': 'Previously authorized personal data can open offline.',
  'offlineStatus.noLocalCopy': 'No authorized local workspace is available.',
  'offlineStatus.retry': 'Retry connection',
  'offlineStatus.checking': 'Checking connection',
  'offlineStatus.permissionProtected': 'The server rechecks permissions before sync.',
}

describe('OfflineUnavailableScreen', () => {
  it('explains the secure offline boundary and retries connectivity', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn().mockResolvedValue(undefined)

    render(
      <OfflineUnavailableScreen
        onRetry={onRetry}
        tx={(key, fallback) => labels[key] ?? fallback ?? key}
      />,
    )

    expect(screen.getByRole('heading', { name: "You're offline" })).toBeTruthy()
    expect(screen.getByText('No authorized local workspace is available.')).toBeTruthy()
    expect(screen.getByText('The server rechecks permissions before sync.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Retry connection' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
