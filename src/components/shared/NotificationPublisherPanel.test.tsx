import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotificationPublishInput, NotificationPublishResult } from '../../api/phdApi'
import { I18nContext, type I18nContextValue } from '../hooks/useI18n'
import { NotificationPublisherPanel } from './NotificationPublisherPanel'
import { loadRecoverableNotificationPublisherDraft } from './residentCommunicationDraftStorage'

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
  'notificationPublisher.openComposer': 'New message',
  'notificationPublisher.launcherMetaLabel': 'Publisher summary',
  'notificationPublisher.launcherRecipients': '{count} recipients',
  'notificationPublisher.launcherGroups': '{count} groups',
  'notificationPublisher.launcherAudiences': '{count} audiences',
  'notificationPublisher.messageDetails': 'Message details',
  'notificationPublisher.messageDetailsHint': 'Write the notification.',
  'notificationPublisher.titleLabel': 'Title',
  'notificationPublisher.titlePlaceholder': 'Title',
  'notificationPublisher.bodyLabel': 'Message',
  'notificationPublisher.bodyPlaceholder': 'Message',
  'notificationPublisher.delivery': 'Delivery',
  'notificationPublisher.deliveryHint': 'Choose channels.',
  'notificationPublisher.channels': 'Channels',
  'notificationPublisher.inApp': 'In app',
  'notificationPublisher.email': 'Email',
  'notificationPublisher.recipientPanelTitle': 'Recipients',
  'notificationPublisher.targetCount': '{count} selected',
  'notificationPublisher.groups': 'Groups',
  'notificationPublisher.noGroups': 'No groups',
  'notificationPublisher.people': 'People',
  'notificationPublisher.send': 'Send',
  'notificationPublisher.sent': 'Sent to {recipients}; created {created}; emailed {emailed}.',
  localRecoveryUnavailable: 'Local draft recovery is unavailable.',
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
  beforeEach(() => sessionStorage.clear())
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

  const publisher = ({
    scope = { userId: 'owner-1', workspaceId: 'team-1' },
    onPublish = vi.fn().mockResolvedValue({ recipients: 1, created: 1, emailed: 0 }),
  }: {
    scope?: { userId: string; workspaceId: string }
    onPublish?: (input: NotificationPublishInput) => Promise<NotificationPublishResult>
  } = {}) => (
    <I18nContext.Provider value={i18nContext}>
      <NotificationPublisherPanel
        eyebrow="Broadcast"
        title="Publish notifications"
        recipientField="memberIds"
        recipients={[{ id: 'member-1', label: 'Jasper', description: 'jasper@example.com' }]}
        groups={[]}
        audiences={[]}
        draftScope={scope}
        onPublish={onPublish}
        onCreateGroup={vi.fn().mockResolvedValue(undefined)}
        onDeleteGroup={vi.fn().mockResolvedValue(undefined)}
      />
    </I18nContext.Provider>
  )

  function authorComposeDraft() {
    fireEvent.click(screen.getByRole('button', { name: 'New message' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Deadline update' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Submit by Friday.' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Jasper/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Email' }))
  }

  it('recovers a compose draft on same-scope remount and isolates another user', () => {
    const first = render(publisher())
    authorComposeDraft()
    first.unmount()

    const second = render(publisher())
    fireEvent.click(screen.getByRole('button', { name: 'New message' }))
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Deadline update')
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Submit by Friday.')
    expect(screen.getByRole('checkbox', { name: /Jasper/ })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Email' })).toHaveClass('active')
    second.unmount()

    render(publisher({ scope: { userId: 'owner-2', workspaceId: 'team-1' } }))
    fireEvent.click(screen.getByRole('button', { name: 'New message' }))
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('')
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('')
  })

  it('retains fields and recovery after a rejected publish', async () => {
    const onPublish = vi.fn().mockRejectedValue(new Error('Publish failed'))
    render(publisher({ onPublish }))
    authorComposeDraft()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(screen.getByText('Publish failed')).toBeInTheDocument())
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Deadline update')
    expect(loadRecoverableNotificationPublisherDraft({ userId: 'owner-1', workspaceId: 'team-1' })).toEqual(
      expect.objectContaining({ title: 'Deadline update', body: 'Submit by Friday.' }),
    )
  })

  it('does not let an older successful request clear newer authored text', async () => {
    let acknowledge!: (value: NotificationPublishResult) => void
    const onPublish = vi.fn(() => new Promise<NotificationPublishResult>((resolve) => {
      acknowledge = resolve
    }))
    render(publisher({ onPublish }))
    authorComposeDraft()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Newer title' } })

    acknowledge({ recipients: 1, created: 1, emailed: 0 })

    await waitFor(() => expect(screen.getByText(/Sent to 1/)).toBeInTheDocument())
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Newer title')
    await waitFor(() => expect(
      loadRecoverableNotificationPublisherDraft({ userId: 'owner-1', workspaceId: 'team-1' }),
    ).toEqual(expect.objectContaining({ title: 'Newer title' })))
  })
})
