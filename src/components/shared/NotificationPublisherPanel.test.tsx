import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nContext, type I18nContextValue } from '../hooks/useI18n'
import { NotificationPublisherPanel } from './NotificationPublisherPanel'

const copy: Record<string, string> = {
  'notificationPublisher.manageGroups': 'Manage groups',
  'notificationPublisher.groupDialogEyebrow': 'Recipient groups',
  'notificationPublisher.groupDialogTitle': 'Manage groups',
  'notificationPublisher.groupDialogDesc': 'Create reusable groups or import them from CSV.',
  'notificationPublisher.csvImportTitle': 'Import from CSV',
  'notificationPublisher.closeDialog': 'Close dialog',
  'notificationPublisher.savedGroupsTitle': 'Saved groups',
  'notificationPublisher.savedGroups': 'Saved groups',
  'notificationPublisher.groupCount': '{count} groups',
  'notificationPublisher.groupMemberCount': '{count} members',
  'notificationPublisher.deleteGroup': 'Delete {name}',
  'notificationPublisher.manualGroupTitle': 'Create manually',
  'notificationPublisher.groupBuilderHint': 'Create a reusable recipient collection.',
  'notificationPublisher.groupName': 'Group name',
  'notificationPublisher.groupNamePlaceholder': 'Example: Fall cohort',
  'notificationPublisher.searchRecipients': 'Search recipients',
  'notificationPublisher.noRecipients': 'No recipients found.',
  'notificationPublisher.clearTargets': 'Clear selection',
  'notificationPublisher.createGroup': 'Save group ({count})',
  'notificationPublisher.groupCreated': 'Group saved.',
  working: 'Working',
  done: 'Done',
}

const i18nContext: I18nContextValue = {
  lang: 'en',
  t: {},
  format: (template, values) => template.replace(
    /\{(\w+)\}/g,
    (_, key: string) => String(values[key] ?? ''),
  ),
  tx: (path, fallback) => copy[path] ?? fallback ?? path,
}

describe('NotificationPublisherPanel group manager', () => {
  afterEach(cleanup)

  it('keeps the saved-group rail separate from one continuous builder and saves from the footer', async () => {
    const onCreateGroup = vi.fn().mockResolvedValue(undefined)
    render(
      <I18nContext.Provider value={i18nContext}>
        <NotificationPublisherPanel
          eyebrow="Broadcast"
          title="Publish notifications"
          recipientField="userIds"
          recipients={[
            {
              id: 'user-1',
              label: 'Jasper',
              description: 'jasper@example.com',
              badge: 'Pro',
            },
          ]}
          groups={[
            {
              id: 'group-1',
              scope: 'admin',
              name: 'Existing group',
              memberIds: ['user-1'],
              createdAt: '2026-07-28T00:00:00.000Z',
              updatedAt: '2026-07-28T00:00:00.000Z',
            },
          ]}
          audiences={[]}
          onPublish={vi.fn()}
          onCreateGroup={onCreateGroup}
          onDeleteGroup={vi.fn()}
        />
      </I18nContext.Provider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Manage groups' }))
    const dialog = screen.getByRole('dialog', { name: 'Manage groups' })
    expect(dialog.querySelector('.notification-group-library')).toBeInTheDocument()
    expect(dialog.querySelector('.notification-group-builder')).toBeInTheDocument()

    const nameInput = within(dialog).getByRole('textbox', { name: 'Group name' })
    fireEvent.change(nameInput, { target: { value: 'Priority reviewers' } })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Jasper/ }))

    const saveButton = within(dialog).getByRole('button', { name: 'Save group (1)' })
    expect(saveButton.closest('.notification-dialog-footer')).toBeInTheDocument()
    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(onCreateGroup).toHaveBeenCalledWith('Priority reviewers', ['user-1'])
      expect(within(dialog).getByRole('status')).toHaveTextContent('Group saved.')
    })
  })
})
