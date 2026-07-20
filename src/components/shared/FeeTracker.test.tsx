import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { I18nContext } from '../hooks/useI18n'
import FeeTracker from './FeeTracker'

const paidFee = {
  id: 'paid-fee',
  amount: 80,
  currency: 'GBP',
  paidDate: '2026-07-15',
  waived: false,
  notes: 'Generated payment case.',
  createdAt: '2026-07-15T09:00:00.000Z',
}

const unpaidFee = {
  id: 'unpaid-fee',
  amount: 50,
  currency: 'USD',
  paidDate: null,
  waived: false,
  notes: '',
  createdAt: '2026-07-15T10:00:00.000Z',
}

type FeePatch = {
  amount?: number
  currency?: string
  paidDate?: string | null
  waived?: boolean
  notes?: string
}

function renderFeeTracker(
  onUpdate: (feeId: string, patch: FeePatch) => void | Promise<void>,
  fees: Array<typeof paidFee | typeof unpaidFee> = [paidFee],
  onDelete = vi.fn(),
) {
  return render(
    <I18nContext.Provider value={{
      lang: 'en',
      t: {},
      format: (template) => template,
      tx: (path, fallback) => fallback ?? path,
    }}>
      <FeeTracker
        fees={fees}
        onAdd={vi.fn()}
        onUpdate={onUpdate}
        onDelete={onDelete}
      />
    </I18nContext.Provider>,
  )
}

describe('FeeTracker editing', () => {
  it('morphs removal into confirmation, then collapses the fee before deleting it', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    renderFeeTracker(vi.fn(async () => {}), [paidFee], onDelete)

    const fee = document.getElementById('fee-paid-fee')!
    await user.click(within(fee).getByRole('button', { name: 'Remove' }))
    expect(within(fee).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()

    await user.click(fee.querySelector<HTMLButtonElement>('.inline-confirm-commit')!)
    expect(fee).toHaveClass('is-removing')
    expect(onDelete).not.toHaveBeenCalled()

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('paid-fee'), { timeout: 1_000 })
  })

  it('lets a paid fee be reopened, changed, and marked unpaid', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn(async (_feeId: string, _patch: FeePatch) => {})
    renderFeeTracker(onUpdate)

    const fee = document.getElementById('fee-paid-fee')
    expect(fee).toBeInTheDocument()
    await user.click(within(fee!).getByRole('button', { name: 'Edit fee: 80 GBP' }))

    const amount = within(fee!).getByRole('spinbutton', { name: 'Amount' })
    await user.clear(amount)
    await user.type(amount, '95')
    await user.click(within(fee!).getByRole('checkbox', { name: 'Paid' }))

    const notes = within(fee!).getByRole('textbox', { name: 'Notes' })
    await user.clear(notes)
    await user.type(notes, 'Updated payment case.')
    await user.click(within(fee!).getByRole('button', { name: 'Save changes' }))

    expect(onUpdate).toHaveBeenCalledWith('paid-fee', {
      amount: 95,
      currency: 'GBP',
      paidDate: null,
      waived: false,
      notes: 'Updated payment case.',
    })
    await waitFor(() => expect(fee).not.toHaveClass('editing'))
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  })

  it('toggles expand and collapse with a single click when nothing changed', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn(async () => {})
    renderFeeTracker(onUpdate)

    const fee = document.getElementById('fee-paid-fee')!
    const openBtn = within(fee).getByRole('button', { name: 'Edit fee: 80 GBP' })

    await user.click(openBtn)
    expect(fee).toHaveClass('editing')
    expect(within(fee).getByRole('spinbutton', { name: 'Amount' })).toBeInTheDocument()

    const collapseBtn = within(fee).getByRole('button', { name: 'Collapse fee: 80 GBP' })
    await user.click(collapseBtn)
    expect(fee).not.toHaveClass('editing')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('prompts save / discard / cancel when closing with unsaved edits', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn(async () => {})
    renderFeeTracker(onUpdate)

    const fee = document.getElementById('fee-paid-fee')!
    await user.click(within(fee).getByRole('button', { name: 'Edit fee: 80 GBP' }))

    const amount = within(fee).getByRole('spinbutton', { name: 'Amount' })
    await user.clear(amount)
    await user.type(amount, '120')

    await user.click(within(fee).getByRole('button', { name: 'Collapse fee: 80 GBP' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Save fee changes?')
    expect(within(dialog).getByRole('button', { name: /Save changes/i })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /Discard/i })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /Cancel/i })).toBeInTheDocument()
    expect(fee).toHaveClass('editing')
  })

  it('keeps editing when the unsaved dialog is cancelled', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn(async () => {})
    renderFeeTracker(onUpdate)

    const fee = document.getElementById('fee-paid-fee')!
    await user.click(within(fee).getByRole('button', { name: 'Edit fee: 80 GBP' }))
    const amount = within(fee).getByRole('spinbutton', { name: 'Amount' })
    await user.clear(amount)
    await user.type(amount, '99')

    await user.click(within(fee).getByRole('button', { name: 'Collapse fee: 80 GBP' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: /Cancel/i }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(fee).toHaveClass('editing')
    expect(within(fee).getByRole('spinbutton', { name: 'Amount' })).toHaveValue(99)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('discards unsaved edits and collapses without calling onUpdate', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn(async () => {})
    renderFeeTracker(onUpdate)

    const fee = document.getElementById('fee-paid-fee')!
    await user.click(within(fee).getByRole('button', { name: 'Edit fee: 80 GBP' }))
    const amount = within(fee).getByRole('spinbutton', { name: 'Amount' })
    await user.clear(amount)
    await user.type(amount, '150')

    await user.click(within(fee).getByRole('button', { name: 'Collapse fee: 80 GBP' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: /Discard/i }))

    await waitFor(() => expect(fee).not.toHaveClass('editing'))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('saves from the unsaved dialog then collapses', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn(async () => {})
    renderFeeTracker(onUpdate)

    const fee = document.getElementById('fee-paid-fee')!
    await user.click(within(fee).getByRole('button', { name: 'Edit fee: 80 GBP' }))
    const amount = within(fee).getByRole('spinbutton', { name: 'Amount' })
    await user.clear(amount)
    await user.type(amount, '110')

    await user.click(within(fee).getByRole('button', { name: 'Collapse fee: 80 GBP' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: /Save changes/i }))

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith('paid-fee', expect.objectContaining({
        amount: 110,
        currency: 'GBP',
      }))
    })
    await waitFor(() => expect(fee).not.toHaveClass('editing'))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('prompts when switching to another fee with dirty edits', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn(async () => {})
    renderFeeTracker(onUpdate, [paidFee, unpaidFee])

    const paid = document.getElementById('fee-paid-fee')!
    const unpaid = document.getElementById('fee-unpaid-fee')!

    await user.click(within(paid).getByRole('button', { name: 'Edit fee: 80 GBP' }))
    const amount = within(paid).getByRole('spinbutton', { name: 'Amount' })
    await user.clear(amount)
    await user.type(amount, '200')

    await user.click(within(unpaid).getByRole('button', { name: 'Edit fee: 50 USD' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toBeInTheDocument()
    expect(paid).toHaveClass('editing')
    expect(unpaid).not.toHaveClass('editing')

    await user.click(within(dialog).getByRole('button', { name: /Discard/i }))
    await waitFor(() => expect(unpaid).toHaveClass('editing'))
    expect(paid).not.toHaveClass('editing')
    expect(onUpdate).not.toHaveBeenCalled()
  })
})
