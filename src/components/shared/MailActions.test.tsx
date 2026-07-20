import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InlineTestEmailAction } from './InlineTestEmailAction'
import { VerificationResendAction } from './VerificationResendAction'
import { AsyncActionButton } from './AsyncActionButton'

describe('mail actions', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('morphs the test action into an inline recipient form and can cancel without a dialog', () => {
    const onSend = vi.fn()
    render(
      <InlineTestEmailAction
        defaultEmail="default@example.com"
        openLabel="Send Test Email"
        inputLabel="Test recipient email"
        inputPlaceholder="recipient@example.com"
        sendLabel="Send"
        cancelLabel="Cancel"
        sendingLabel="Sending…"
        invalidEmailLabel="Enter a valid email address."
        onSend={onSend}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Send Test Email' }))
    expect(screen.getByLabelText('Test recipient email')).toHaveValue('default@example.com')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Send Test Email' })).toBeVisible()
    expect(onSend).not.toHaveBeenCalled()
  })

  it('sends the normalized address through the inline form', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined)
    render(
      <InlineTestEmailAction
        openLabel="Send Test Email"
        inputLabel="Test recipient email"
        inputPlaceholder="recipient@example.com"
        sendLabel="Send"
        cancelLabel="Cancel"
        sendingLabel="Sending…"
        invalidEmailLabel="Enter a valid email address."
        onSend={onSend}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Send Test Email' }))
    fireEvent.change(screen.getByLabelText('Test recipient email'), { target: { value: '  Research@Example.com ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(onSend).toHaveBeenCalledWith('research@example.com'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send Test Email' })).toBeVisible())
  })

  it('shows pending, success, and failure language without allowing a duplicate async action', async () => {
    let resolveSend: (() => void) | undefined
    const onAction = vi.fn(() => new Promise<void>((resolve) => {
      resolveSend = resolve
    }))
    const { rerender } = render(
      <AsyncActionButton
        idleLabel="Send test email"
        pendingLabel="Sending…"
        successLabel="Test email sent"
        errorLabel="Send failed — retry"
        onAction={onAction}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Send test email' }))
    const pendingButton = screen.getByRole('button', { name: 'Sending…' })
    expect(pendingButton).toBeDisabled()
    expect(pendingButton).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(pendingButton)
    expect(onAction).toHaveBeenCalledOnce()

    await act(async () => resolveSend?.())
    expect(screen.getByRole('button', { name: 'Test email sent' })).toHaveAttribute('data-state', 'success')

    const failingAction = vi.fn().mockRejectedValue(new Error('SMTP unavailable'))
    rerender(
      <AsyncActionButton
        idleLabel="Send test email"
        pendingLabel="Sending…"
        successLabel="Test email sent"
        errorLabel="Send failed — retry"
        onAction={failingAction}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Test email sent' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send failed — retry' })).toHaveAttribute('data-state', 'error'))
  })

  it('continues a persisted resend cooldown and returns to the ready state after 60 seconds', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-18T12:00:00.000Z'))
    const onResend = vi.fn().mockResolvedValue('2026-07-18T12:00:45.000Z')
    render(
      <VerificationResendAction
        sentAt="2026-07-18T11:59:45.000Z"
        resendLabel="Resend"
        sendingLabel="Sending…"
        countdownLabel={(seconds) => `Resend in ${seconds}s`}
        onResend={onResend}
      />,
    )

    expect(screen.getByRole('button', { name: 'Resend in 45s' })).toBeDisabled()
    await act(async () => {
      vi.advanceTimersByTime(45_000)
    })
    const resendButton = screen.getByRole('button', { name: 'Resend' })
    expect(resendButton).toBeEnabled()

    await act(async () => {
      fireEvent.click(resendButton)
      await Promise.resolve()
    })
    expect(onResend).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Resend in 60s' })).toBeDisabled()
  })
})
