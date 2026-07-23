import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NotificationRecord } from '../../api/phdApi'
import { getDict, t, tpl, type Language } from '../../i18n'
import { I18nContext } from '../hooks/useI18n'
import { NotificationCenter } from './NotificationCenter'

const notifications: NotificationRecord[] = [
  {
    id: 'notif_unread',
    type: 'task_due',
    applicationId: 'app_1',
    title: 'Task due: Submit statement',
    body: '"Submit statement" for MIT is due 2026-07-12.',
    triggerDate: '2026-07-12',
    createdAt: '2026-07-09T12:00:00.000Z',
    readAt: null,
    emailedAt: null,
  },
  {
    id: 'notif_read',
    type: 'new_email_imported',
    applicationId: 'app_2',
    title: 'New email from Professor Lee',
    body: '"Follow-up" was imported into Stanford correspondence.',
    triggerDate: '2026-07-09',
    createdAt: '2026-07-08T12:00:00.000Z',
    readAt: '2026-07-08T12:30:00.000Z',
    metadata: {
      senderEmail: 'professor.lee@stanford.edu',
      recipientEmail: 'jasper@example.com',
      subject: 'Follow-up',
    },
    emailedAt: null,
  },
  {
    id: 'notif_announcement',
    type: 'admin_announcement',
    applicationId: null,
    title: 'Maintenance window',
    body: 'Email imports will pause for 30 minutes while the server is updated.',
    triggerDate: '2026-07-09',
    createdAt: '2026-07-09T09:00:00.000Z',
    readAt: null,
    targetPath: '/settings',
    metadata: {
      actorName: 'QA Admin',
      actorEmail: 'admin@phd-atlas.local',
      channels: ['in_app', 'email'],
      recipientName: 'Jasper',
      recipientEmail: 'jasper@example.com',
      emailRecipients: ['jasper@example.com'],
      audiences: ['all'],
    },
    emailedAt: '2026-07-09T09:01:00.000Z',
  },
  {
    id: 'notif_archived',
    type: 'material_reminder',
    applicationId: 'app_1',
    title: 'Archived writing sample reminder',
    body: 'This reminder was kept for reference.',
    triggerDate: '2026-07-06',
    createdAt: '2026-07-06T09:00:00.000Z',
    readAt: '2026-07-06T09:00:00.000Z',
    archivedAt: '2026-07-06T10:00:00.000Z',
    emailedAt: null,
  },
]

function renderNotificationCenter(lang: Language = 'en') {
  const handlers = {
    onClose: vi.fn(),
    onMarkRead: vi.fn(),
    onMarkUnread: vi.fn(),
    onMarkAllRead: vi.fn(),
    onArchive: vi.fn(),
    onOpenNotification: vi.fn(),
  }

  render(
    <I18nContext.Provider
      value={{
        lang,
        t: getDict(lang),
        format: tpl,
        tx: (path, fallback) => t(lang, path, fallback),
      }}
    >
      <NotificationCenter
        open
        notifications={notifications}
        loading={false}
        {...handlers}
      />
    </I18nContext.Provider>,
  )

  return handlers
}

describe('NotificationCenter', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('marks selected unread notifications as read', async () => {
    const user = userEvent.setup()
    const handlers = renderNotificationCenter()

    await user.click(screen.getByRole('button', { name: 'Manage' }))
    await user.click(screen.getByLabelText('Select Task due: Submit statement'))
    await user.click(screen.getByRole('button', { name: 'Mark read' }))

    expect(handlers.onMarkRead).toHaveBeenCalledWith(['notif_unread'])
  })

  it('plays a lightweight clear transition before committing mark all as read', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const handlers = renderNotificationCenter()

    await user.click(screen.getByRole('button', { name: /mark all read/i }))

    expect(handlers.onMarkAllRead).not.toHaveBeenCalled()
    expect(document.querySelector('.notification-center-list.is-clearing-all')).not.toBeNull()
    expect(document.querySelector('.notification-center-item.is-clearing-unread')).not.toBeNull()
    expect(document.querySelector('.notification-center-dot.is-clearing')).not.toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(320)
    })
    expect(handlers.onMarkAllRead).toHaveBeenCalledTimes(1)
  })

  it('enters bulk mode from Ctrl/Cmd selection without opening the notification', () => {
    const handlers = renderNotificationCenter()
    const item = screen.getByRole('button', { name: 'View details for Task due: Submit statement' })

    fireEvent.click(item, { ctrlKey: true })

    expect(screen.getByRole('button', { name: 'Done' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Select Task due: Submit statement')).toBeChecked()
    expect(document.querySelector('.notification-center-selection-presence')).toHaveAttribute('data-present', 'true')
    expect(handlers.onMarkRead).not.toHaveBeenCalled()
  })

  it('uses Shift to select the visible range from the latest bulk-selection anchor', () => {
    renderNotificationCenter()
    const first = screen.getByRole('button', { name: 'View details for Task due: Submit statement' })
    const last = screen.getByRole('button', { name: 'View details for Maintenance window' })

    fireEvent.click(first, { ctrlKey: true })
    fireEvent.click(last, { shiftKey: true })

    expect(screen.getByLabelText('Select Task due: Submit statement')).toBeChecked()
    expect(screen.getByLabelText('Select New email from Professor Lee')).toBeChecked()
    expect(screen.getByLabelText('Select Maintenance window')).toBeChecked()
  })

  it('opens bulk actions from the right-click menu for selected notifications', () => {
    const handlers = renderNotificationCenter()
    const unread = screen.getByRole('button', { name: 'View details for Task due: Submit statement' })
    const read = screen.getByRole('button', { name: 'View details for New email from Professor Lee' })

    fireEvent.click(unread, { ctrlKey: true })
    fireEvent.click(read, { ctrlKey: true })
    fireEvent.contextMenu(unread, { clientX: 220, clientY: 180 })

    expect(screen.getByRole('menu', { name: '2 selected' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Mark read' })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: 'Mark unread' })).toBeEnabled()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }))
    expect(handlers.onArchive).toHaveBeenCalledWith(['notif_unread', 'notif_read'])
  })

  it('keeps the bulk right-click menu scoped to selected notifications', () => {
    renderNotificationCenter()
    const selected = screen.getByRole('button', { name: 'View details for Task due: Submit statement' })
    const unselected = screen.getByRole('button', { name: 'View details for New email from Professor Lee' })

    fireEvent.click(selected, { ctrlKey: true })
    fireEvent.contextMenu(unselected, { clientX: 220, clientY: 180 })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes the bulk context menu before closing the notification center on Escape', () => {
    vi.useFakeTimers()
    const handlers = renderNotificationCenter()
    const selected = screen.getByRole('button', { name: 'View details for Task due: Submit statement' })

    fireEvent.click(selected, { ctrlKey: true })
    fireEvent.contextMenu(selected, { clientX: 220, clientY: 180 })
    fireEvent.keyDown(document, { key: 'Escape' })
    vi.advanceTimersByTime(240)

    expect(handlers.onClose).not.toHaveBeenCalled()
  })

  it('marks selected read notifications as unread', async () => {
    const user = userEvent.setup()
    const handlers = renderNotificationCenter()

    await user.click(screen.getByRole('button', { name: 'Manage' }))
    await user.click(screen.getByLabelText('Select New email from Professor Lee'))
    await user.click(screen.getByRole('button', { name: 'Mark unread' }))

    expect(handlers.onMarkUnread).toHaveBeenCalledWith(['notif_read'])
  })

  it('keeps the bulk toolbar mounted while animating its entrance and exit', async () => {
    const user = userEvent.setup()
    renderNotificationCenter()

    const presence = document.querySelector('.notification-center-selection-presence')
    expect(presence).toHaveAttribute('data-present', 'false')
    expect(presence).toHaveAttribute('inert')
    expect(presence).toHaveClass('inline-presence-instant')

    await user.click(screen.getByRole('button', { name: 'Manage' }))
    expect(screen.getByRole('button', { name: 'Done' }).querySelectorAll('.inline-presence-instant')).toHaveLength(2)
    await user.click(screen.getByLabelText('Select Task due: Submit statement'))

    expect(presence).toHaveAttribute('data-present', 'true')
    expect(presence).not.toHaveAttribute('inert')

    await user.click(screen.getByRole('button', { name: 'Clear selection' }))

    expect(document.querySelector('.notification-center-selection-presence')).toBe(presence)
    expect(presence).toHaveAttribute('data-present', 'false')
    expect(presence).toHaveAttribute('inert')
  })

  it('archives selected notifications', async () => {
    const user = userEvent.setup()
    const handlers = renderNotificationCenter()

    await user.click(screen.getByRole('button', { name: 'Manage' }))
    await user.click(screen.getByLabelText('Select Task due: Submit statement'))
    await user.click(screen.getByRole('button', { name: 'Archive' }))

    expect(handlers.onArchive).toHaveBeenCalledWith(['notif_unread'])
  })

  it('keeps bulk controls out of the browsing flow and filters to unread updates', async () => {
    const user = userEvent.setup()
    renderNotificationCenter()

    expect(screen.queryByLabelText('Select Task due: Submit statement')).not.toBeInTheDocument()
    expect(document.querySelector('.notification-center-select-slot')).toHaveAttribute('inert')
    expect(screen.getByRole('button', { name: 'Manage' })).toHaveAttribute('aria-pressed', 'false')

    await user.click(screen.getByRole('button', { name: 'Unread' }))

    expect(screen.getByRole('button', { name: 'Unread' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: 'View details for New email from Professor Lee' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Manage' }))

    expect(screen.getByRole('button', { name: 'Done' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Select Task due: Submit statement')).toBeInTheDocument()
    expect(document.querySelector('.notification-center-select-slot')).not.toHaveAttribute('inert')
  })

  it('keeps an opened unread notification in context by returning to all notifications', async () => {
    const user = userEvent.setup()
    renderNotificationCenter()

    await user.click(screen.getByRole('button', { name: 'Unread' }))
    await user.click(screen.getByRole('button', { name: 'View details for Task due: Submit statement' }))

    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: 'Task due: Submit statement' })).toBeInTheDocument()
  })

  it('keeps select all inline with the filters and exposes archived notifications', async () => {
    const user = userEvent.setup()
    renderNotificationCenter()

    await user.click(screen.getByRole('button', { name: 'Manage' }))
    expect(document.querySelector('.notification-center-toolbar')).toHaveClass('is-editing')
    const selectAll = screen.getByLabelText('Select all')
    const toolbarLeading = selectAll.closest('.notification-center-toolbar-leading')
    expect(toolbarLeading).not.toBeNull()
    expect(toolbarLeading).toHaveClass('is-editing')
    expect(selectAll.closest('.notification-center-select-all-slot')).not.toHaveAttribute('inert')

    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(document.querySelector('.notification-center-select-all-slot')).toHaveAttribute('inert')
    await user.click(screen.getByRole('button', { name: 'Archived' }))

    expect(screen.getByRole('button', { name: 'Archived' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'View details for Archived writing sample reminder' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Manage' })).not.toBeInTheDocument()
  })

  it('slides into a focused detail view on compact screens and returns to the list', async () => {
    const originalMatchMedia = window.matchMedia
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      }),
    })

    try {
      const user = userEvent.setup()
      renderNotificationCenter()
      const dialog = screen.getByRole('dialog', { name: 'Notifications' })

      await user.click(screen.getByRole('button', { name: 'View details for New email from Professor Lee' }))

      expect(dialog).toHaveClass('mobile-detail-open')
      expect(document.querySelector('.notification-center-head')).toHaveAttribute('inert')
      expect(document.querySelector('.notification-center-controls')).toHaveAttribute('inert')
      expect(document.querySelector('.notification-center-list-pane')).toHaveAttribute('inert')
      expect(document.querySelector('.notification-center-detail-pane')).not.toHaveAttribute('inert')
      await user.click(screen.getByRole('button', { name: 'All notifications' }))
      expect(dialog).not.toHaveClass('mobile-detail-open')
      expect(document.querySelector('.notification-center-head')).not.toHaveAttribute('inert')
      expect(document.querySelector('.notification-center-controls')).not.toHaveAttribute('inert')
      expect(document.querySelector('.notification-center-list-pane')).not.toHaveAttribute('inert')
      expect(document.querySelector('.notification-center-detail-pane')).toHaveAttribute('inert')
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: originalMatchMedia,
      })
    }
  })

  it('previews a notification before jumping to its destination', async () => {
    const user = userEvent.setup()
    const handlers = renderNotificationCenter()

    await user.click(screen.getByRole('button', { name: 'View details for New email from Professor Lee' }))

    expect(screen.getByRole('heading', { name: 'Follow-up' })).toBeInTheDocument()
    expect(screen.getByText('jasper@example.com')).toBeInTheDocument()
    expect(handlers.onOpenNotification).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Go to target for New email from Professor Lee' }))

    await waitFor(() => {
      expect(handlers.onOpenNotification).toHaveBeenCalledWith(notifications[1])
    })
  })

  it('shows announcement sender and delivery context', async () => {
    const user = userEvent.setup()
    renderNotificationCenter()

    await user.click(screen.getByRole('button', { name: 'View details for Maintenance window' }))

    expect(screen.getByRole('heading', { name: 'Maintenance window' })).toBeInTheDocument()
    expect(screen.getByText('QA Admin')).toBeInTheDocument()
    expect(screen.getAllByText('jasper@example.com').length).toBeGreaterThan(0)
    expect(screen.getByText('Announcement details')).toBeInTheDocument()
    expect(screen.getByText('Email layout')).toBeInTheDocument()
  })
})
