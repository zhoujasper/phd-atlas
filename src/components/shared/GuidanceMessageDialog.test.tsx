import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareForSafeReload } from '../../safeReload'
import { I18nContext, type I18nContextValue } from '../hooks/useI18n'
import { GuidanceMessageDialog } from './GuidanceMessageDialog'
import { loadRecoverableGuidanceMessageDraft } from './residentCommunicationDraftStorage'

const copy: Record<string, string> = {
  'notificationPublisher.inApp': 'In app',
  'notificationPublisher.messageDetailsHint': 'Write a direct message.',
  'notificationPublisher.closeDialog': 'Close dialog',
  'notificationPublisher.titleLabel': 'Title',
  'notificationPublisher.titlePlaceholder': 'Message title',
  'notificationPublisher.bodyLabel': 'Message',
  'notificationPublisher.bodyPlaceholder': 'Message body',
  'notificationPublisher.send': 'Send',
  'dashboard.guidanceMessageTitle': 'Message {name}',
  'apiErrors.REQUEST_FAILED': 'Request failed.',
  localRecoveryUnavailable: 'Local draft recovery is unavailable.',
  cancel: 'Cancel',
  working: 'Working',
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

const baseScope = { userId: 'student-1', workspaceId: 'team-1' }

function dialog(props: Partial<ComponentProps<typeof GuidanceMessageDialog>> = {}) {
  return (
    <I18nContext.Provider value={i18nContext}>
      <GuidanceMessageDialog
        open
        recipientId="teacher-1"
        recipientName="Professor One"
        draftScope={baseScope}
        onClose={vi.fn()}
        onSend={vi.fn().mockResolvedValue(undefined)}
        {...props}
      />
    </I18nContext.Provider>
  )
}

describe('GuidanceMessageDialog resident draft continuity', () => {
  beforeEach(() => sessionStorage.clear())
  afterEach(() => cleanup())

  it('keeps authored fields when a background snapshot changes only the recipient name', () => {
    const view = render(dialog())
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Interview plan' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Can we meet tomorrow?' } })

    view.rerender(dialog({ recipientName: 'Professor One, PhD' }))

    expect(screen.getByRole('heading', { name: 'Message Professor One, PhD' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Interview plan')
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Can we meet tomorrow?')
  })

  it('recovers on same-scope remount without leaking to another recipient', async () => {
    const first = render(dialog())
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Draft title' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Resident body' } })
    first.unmount()

    const second = render(dialog())
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Draft title')
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Resident body')
    second.unmount()

    render(dialog({ recipientId: 'teacher-2', recipientName: 'Professor Two' }))
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('')
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('')
  })

  it('retains the exact draft after a rejected send', async () => {
    const onSend = vi.fn().mockRejectedValue(new Error('Delivery failed'))
    render(dialog({ onSend }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Keep this' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Do not discard me' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Delivery failed'))
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Keep this')
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Do not discard me')
    expect(loadRecoverableGuidanceMessageDraft({ ...baseScope, recipientId: 'teacher-1' })).toEqual({
      title: 'Keep this',
      body: 'Do not discard me',
    })
  })

  it('clears recovery only after the send promise acknowledges success', async () => {
    let acknowledge!: () => void
    const onSend = vi.fn(() => new Promise<void>((resolve) => {
      acknowledge = resolve
    }))
    const onClose = vi.fn()
    render(dialog({ onSend, onClose }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Acknowledged title' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Acknowledged body' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(loadRecoverableGuidanceMessageDraft({ ...baseScope, recipientId: 'teacher-1' })).not.toBeNull()
    acknowledge()

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(loadRecoverableGuidanceMessageDraft({ ...baseScope, recipientId: 'teacher-1' })).toBeNull()
  })

  it('blocks safe reload while dirty after first verifying the recovery copy', async () => {
    render(dialog())
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Resident title' } })

    await expect(prepareForSafeReload({ reason: 'application-update' })).resolves.toBe(false)
    expect(loadRecoverableGuidanceMessageDraft({ ...baseScope, recipientId: 'teacher-1' })).toEqual({
      title: 'Resident title',
      body: '',
    })
  })
})
