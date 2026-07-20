import { AlertTriangle, CheckCircle2, Pencil, Plus, ReceiptText, Save, Trash2, Undo2, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { formatCount, localeForLanguage } from '../../i18n'
import { useI18n } from '../hooks/useI18n'
import { getMotionDelay, useAnimatedClose } from '../hooks/useAnimatedClose'
import { DatePicker } from './DatePicker'
import { CollapsiblePanel } from './CollapsiblePanel'
import { InlinePresence } from './InlinePresence'
import { InlineConfirm } from './InlineConfirm'
import { ModalPortal } from './ModalPortal'
import { Select } from './Select'

interface Fee {
  id: string
  amount: number
  currency: string
  paidDate?: string | null
  waived: boolean
  notes: string
  createdAt: string
}

interface FeeTrackerProps {
  fees: Fee[]
  onAdd: (fee: { amount: number; currency: string; paidDate?: string; waived: boolean; notes: string }) => void
  onDelete: (feeId: string) => void | Promise<void>
  onUpdate: (feeId: string, patch: { amount?: number; currency?: string; paidDate?: string | null; waived?: boolean; notes?: string }) => void | Promise<void>
}

interface FeeEditDraft {
  amount: string
  currency: string
  paid: boolean
  paidDate: string
  waived: boolean
  notes: string
}

function draftFromFee(fee: Fee): FeeEditDraft {
  return {
    amount: String(fee.amount),
    currency: fee.currency,
    paid: Boolean(fee.paidDate),
    paidDate: fee.paidDate ?? '',
    waived: fee.waived,
    notes: fee.notes ?? '',
  }
}

function draftEqualsFee(draft: FeeEditDraft, fee: Fee): boolean {
  const paid = Boolean(fee.paidDate)
  const paidDate = fee.paidDate ?? ''
  const amount = Number(draft.amount)
  const feeAmount = fee.amount
  const amountMatch = Number.isFinite(amount) && amount === feeAmount
  const draftPaidDate = draft.paid && !draft.waived ? draft.paidDate : ''
  const feePaidDate = paid && !fee.waived ? paidDate : ''
  return (
    amountMatch
    && draft.currency === fee.currency
    && draft.paid === paid
    && draftPaidDate === feePaidDate
    && draft.waived === fee.waived
    && (draft.notes ?? '') === (fee.notes ?? '')
  )
}

function formatMoney(value: number, currency: string, lang: string): string {
  try {
    return new Intl.NumberFormat(localeForLanguage(lang), {
      style: 'currency',
      currency,
      currencyDisplay: 'code',
      maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
    }).format(value)
  } catch {
    return `${value} ${currency}`
  }
}

export default function FeeTracker(props: FeeTrackerProps) {
  const { tx, lang } = useI18n()
  const [adding, setAdding] = useState(false)
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [notes, setNotes] = useState('')
  const [waived, setWaived] = useState(false)
  const [editingFeeId, setEditingFeeId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<FeeEditDraft | null>(null)
  const [savingFeeId, setSavingFeeId] = useState<string | null>(null)
  const [pendingDeleteFeeId, setPendingDeleteFeeId] = useState<string | null>(null)
  const [removingFeeIds, setRemovingFeeIds] = useState<Set<string>>(() => new Set())
  const [closePromptOpen, setClosePromptOpen] = useState(false)
  const [pendingSwitchToId, setPendingSwitchToId] = useState<string | null>(null)

  const totalFees = props.fees.filter(function (f) { return !f.waived }).reduce(function (sum, f) { return sum + f.amount }, 0)
  const totalPaid = props.fees.filter(function (f) { return f.paidDate && !f.waived }).reduce(function (sum, f) { return sum + f.amount }, 0)
  const displayCurrency = props.fees.find(function (f) { return !f.waived })?.currency ?? currency
  const currencyOptions = ['USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD', 'CNY', 'JPY', 'KRW'].map(function (code) {
    return { value: code, label: code }
  })

  const editingFee = editingFeeId ? props.fees.find((fee) => fee.id === editingFeeId) ?? null : null
  const isDirty = Boolean(
    editingFeeId
    && editDraft
    && editingFee
    && !draftEqualsFee(editDraft, editingFee),
  )

  function handleAdd() {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0 || amt > 10000) return
    props.onAdd({ amount: amt, currency: currency, waived: waived, notes: notes })
    setAmount('')
    setNotes('')
    setWaived(false)
    setAdding(false)
  }

  async function confirmFeeDelete(feeId: string) {
    setPendingDeleteFeeId(null)
    setRemovingFeeIds((current) => new Set(current).add(feeId))
    await new Promise<void>((resolve) => window.setTimeout(resolve, getMotionDelay(380)))
    try {
      await props.onDelete(feeId)
    } catch {
      // The caller owns the failure toast. Restore the row so it remains usable.
      setRemovingFeeIds((current) => {
        const next = new Set(current)
        next.delete(feeId)
        return next
      })
    }
  }

  function openEditing(fee: Fee) {
    setAdding(false)
    setClosePromptOpen(false)
    setPendingSwitchToId(null)
    setEditingFeeId(fee.id)
    setEditDraft(draftFromFee(fee))
  }

  function forceCloseEditing() {
    setClosePromptOpen(false)
    setEditingFeeId(null)
    setEditDraft(null)
    setPendingSwitchToId(null)
  }

  function requestCloseEditing(nextFeeId: string | null = null) {
    if (savingFeeId) return
    if (!editingFeeId) {
      if (nextFeeId) {
        const fee = props.fees.find((item) => item.id === nextFeeId)
        if (fee) openEditing(fee)
      }
      return
    }
    if (isDirty) {
      setPendingSwitchToId(nextFeeId)
      setClosePromptOpen(true)
      return
    }
    forceCloseEditing()
    if (nextFeeId) {
      const fee = props.fees.find((item) => item.id === nextFeeId)
      if (fee) openEditing(fee)
    }
  }

  function toggleEditing(fee: Fee) {
    if (savingFeeId) return
    if (editingFeeId === fee.id) {
      requestCloseEditing(null)
      return
    }
    if (editingFeeId && isDirty) {
      requestCloseEditing(fee.id)
      return
    }
    openEditing(fee)
  }

  function cancelEditing() {
    requestCloseEditing(null)
  }

  async function persistEdit(feeId: string): Promise<boolean> {
    if (!editDraft) return false
    const nextAmount = Number(editDraft.amount)
    if (!Number.isFinite(nextAmount) || nextAmount <= 0 || nextAmount > 10000) return false

    setSavingFeeId(feeId)
    try {
      await props.onUpdate(feeId, {
        amount: nextAmount,
        currency: editDraft.currency,
        paidDate: editDraft.paid && !editDraft.waived ? editDraft.paidDate || new Date().toISOString().slice(0, 10) : null,
        waived: editDraft.waived,
        notes: editDraft.notes,
      })
      return true
    } finally {
      setSavingFeeId(null)
    }
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>, feeId: string) {
    event.preventDefault()
    const ok = await persistEdit(feeId)
    if (!ok) return
    forceCloseEditing()
  }

  async function handlePromptSave() {
    if (!editingFeeId) return
    const ok = await persistEdit(editingFeeId)
    if (!ok) return
    const nextId = pendingSwitchToId
    forceCloseEditing()
    if (nextId) {
      const fee = props.fees.find((item) => item.id === nextId)
      if (fee) openEditing(fee)
    }
  }

  function handlePromptDiscard() {
    const nextId = pendingSwitchToId
    forceCloseEditing()
    if (nextId) {
      const fee = props.fees.find((item) => item.id === nextId)
      if (fee) openEditing(fee)
    }
  }

  function handlePromptCancel() {
    setClosePromptOpen(false)
    setPendingSwitchToId(null)
  }

  const { exiting: closePromptExiting, requestClose: requestClosePrompt } = useAnimatedClose(
    closePromptOpen,
    handlePromptCancel,
  )

  return (
    <div className="fee-tracker">
      <div className="fee-summary">
        <div className="fee-stat">
          <span className="fee-stat-value">{formatCount(lang, props.fees.length)}</span>
          <span className="fee-stat-label">{tx('fees.totalFees', 'Total Fees')}</span>
        </div>
        <div className="fee-stat">
          <span className="fee-stat-value">{formatMoney(totalFees, displayCurrency, lang)}</span>
          <span className="fee-stat-label">{tx('fees.amount', 'Amount')}</span>
        </div>
        <div className="fee-stat">
          <span className="fee-stat-value">{formatMoney(totalPaid, displayCurrency, lang)}</span>
          <span className="fee-stat-label">{tx('fees.paid', 'Paid')}</span>
        </div>
        <div className="fee-stat">
          <span className="fee-stat-value">{formatMoney(totalFees - totalPaid, displayCurrency, lang)}</span>
          <span className="fee-stat-label">{tx('fees.remaining', 'Remaining')}</span>
        </div>
      </div>

      <div className="fee-list">
        {props.fees.length === 0 ? (
          <div className="fee-empty">
            <span className="fee-empty-icon" aria-hidden="true"><ReceiptText size={18} /></span>
            <div>
              <strong>{tx('fees.emptyTitle', 'No fees tracked')}</strong>
              <p>{tx('fees.emptyHint', 'Add tuition deposits, application fees, or testing costs when they appear.')}</p>
            </div>
          </div>
        ) : props.fees.map(function (fee) {
          const isEditing = editingFeeId === fee.id && Boolean(editDraft)
          const isSaving = savingFeeId === fee.id
          const isRemoving = removingFeeIds.has(fee.id)
          const rowDraft = isEditing && editDraft ? editDraft : draftFromFee(fee)
          const editableAmount = Number(editDraft?.amount ?? '')
          const canSave = Number.isFinite(editableAmount) && editableAmount > 0 && editableAmount <= 10000
          return (
            <article
              key={fee.id}
              id={`fee-${fee.id}`}
              className={'fee-item' + (fee.waived ? ' waived' : '') + (fee.paidDate ? ' paid' : '') + (isEditing ? ' editing' : '') + (isRemoving ? ' is-removing' : '')}
              aria-busy={isSaving || isRemoving || undefined}
            >
              <button
                type="button"
                className="fee-item-main fee-item-open"
                onClick={function () { toggleEditing(fee) }}
                disabled={isRemoving}
                aria-label={
                  isEditing
                    ? `${tx('fees.collapseFee', 'Collapse fee')}: ${fee.amount} ${fee.currency}`
                    : `${tx('fees.editFee', 'Edit fee')}: ${fee.amount} ${fee.currency}`
                }
                aria-expanded={isEditing}
              >
                <span className="fee-amount">{formatMoney(fee.amount, fee.currency, lang)}</span>
                <InlinePresence present={fee.waived} parentGap="6px">
                  <span className="fee-badge waived">{tx('fees.waived', 'Waived')}</span>
                </InlinePresence>
                <InlinePresence present={Boolean(fee.paidDate)} parentGap="6px">
                  <span className="fee-badge paid">{tx('fees.paid', 'Paid')}</span>
                </InlinePresence>
                <InlinePresence present={Boolean(fee.notes)} parentGap="6px">
                  <span className="fee-notes">{fee.notes}</span>
                </InlinePresence>
              </button>
              <div className="fee-item-actions">
                <InlinePresence present={!fee.paidDate && !fee.waived} parentGap="6px">
                  <button type="button" className="quiet-action" disabled={isRemoving} onClick={function () {
                    void props.onUpdate(fee.id, { paidDate: new Date().toISOString().slice(0, 10), waived: false })
                  }}><CheckCircle2 size={13} aria-hidden="true" /> {tx('fees.markPaid', 'Mark Paid')}</button>
                </InlinePresence>
                <button
                  type="button"
                  className="quiet-action"
                  onClick={function () { toggleEditing(fee) }}
                  disabled={isRemoving}
                  title={isEditing ? tx('fees.collapseFee', 'Collapse fee') : tx('fees.editFee', 'Edit fee')}
                aria-label={isEditing ? tx('fees.collapseFee', 'Collapse fee') : tx('fees.editFee', 'Edit fee')}
                aria-expanded={isEditing}
              >
                  <InlinePresence present={isEditing} parentGap="6px">
                    <span className="fee-action-label"><X size={13} aria-hidden="true" />{tx('fees.collapseFee', 'Collapse')}</span>
                  </InlinePresence>
                  <InlinePresence present={!isEditing} parentGap="6px">
                    <span className="fee-action-label"><Pencil size={13} aria-hidden="true" />{tx('fees.editFee', 'Edit fee')}</span>
                  </InlinePresence>
                </button>
                <InlineConfirm
                  className="fee-delete-confirm"
                  open={pendingDeleteFeeId === fee.id}
                  busy={isRemoving}
                  disabled={isSaving || isRemoving}
                  confirmLabel={tx('fees.remove', 'Remove')}
                  cancelLabel={tx('fees.cancel', 'Cancel')}
                  confirmTone="danger"
                  idleTitle={tx('fees.remove', 'Remove')}
                  idleAriaLabel={tx('fees.remove', 'Remove')}
                  onOpen={() => setPendingDeleteFeeId(fee.id)}
                  onCancel={() => setPendingDeleteFeeId(null)}
                  onConfirm={() => { void confirmFeeDelete(fee.id) }}
                >
                  <Trash2 size={13} aria-hidden="true" /> {tx('fees.remove', 'Remove')}
                </InlineConfirm>
              </div>
              <CollapsiblePanel
                open={isEditing}
                keepMounted
                className="fee-edit-collapse"
                innerClassName="fee-edit-collapse-inner"
                openMs={380}
                closeMs={320}
              >
                <form
                  className={`fee-edit-form ${rowDraft.paid && !rowDraft.waived ? 'has-paid-date' : ''}`}
                  onSubmit={function (event) { void saveEdit(event, fee.id) }}
                >
                  <label className="fee-edit-field">
                    <span>{tx('fees.amount', 'Amount')}</span>
                    <input
                      type="number"
                      className="settings-input"
                      min="0.01"
                      max="10000"
                      step="0.01"
                      value={rowDraft.amount}
                      onChange={function (event) { setEditDraft({ ...rowDraft, amount: event.target.value }) }}
                    />
                  </label>
                  <label className="fee-edit-field">
                    <span>{tx('fees.currency', 'Currency')}</span>
                    <Select
                      value={rowDraft.currency}
                      options={currencyOptions}
                      onChange={function (value) { setEditDraft({ ...rowDraft, currency: value }) }}
                      ariaLabel={tx('fees.currency', 'Currency')}
                      size="small"
                    />
                  </label>
                  <label className="fee-edit-toggle">
                    <input
                      type="checkbox"
                      checked={rowDraft.paid}
                      onChange={function (event) {
                        const paid = event.target.checked
                        setEditDraft({
                          ...rowDraft,
                          paid,
                          paidDate: paid ? rowDraft.paidDate || new Date().toISOString().slice(0, 10) : '',
                          waived: paid ? false : rowDraft.waived,
                        })
                      }}
                    />
                    <span>{tx('fees.paid', 'Paid')}</span>
                  </label>
                  <label className="fee-edit-toggle">
                    <input
                      type="checkbox"
                      checked={rowDraft.waived}
                      onChange={function (event) {
                        const nextWaived = event.target.checked
                        setEditDraft({
                          ...rowDraft,
                          waived: nextWaived,
                          paid: nextWaived ? false : rowDraft.paid,
                          paidDate: nextWaived ? '' : rowDraft.paidDate,
                        })
                      }}
                    />
                    <span>{tx('fees.waivedLabel', 'Waived')}</span>
                  </label>
                  <CollapsiblePanel
                    open={rowDraft.paid && !rowDraft.waived}
                    keepMounted
                    className="fee-edit-date-collapse"
                    innerClassName="fee-edit-date-collapse-inner"
                  >
                    <div className="fee-edit-field fee-edit-date">
                      <span>{tx('fees.paidDate', 'Paid date')}</span>
                      <DatePicker
                        value={rowDraft.paidDate}
                        onChange={function (value) { setEditDraft({ ...rowDraft, paidDate: value }) }}
                        allowClear
                      />
                    </div>
                  </CollapsiblePanel>
                  <label className="fee-edit-field fee-edit-notes">
                    <span>{tx('fees.notes', 'Notes')}</span>
                    <input
                      type="text"
                      className="settings-input"
                      maxLength={500}
                      value={rowDraft.notes}
                      placeholder={tx('fees.notesPlaceholder', 'Notes (optional)')}
                      onChange={function (event) { setEditDraft({ ...rowDraft, notes: event.target.value }) }}
                    />
                  </label>
                  <div className="fee-edit-actions">
                    <button type="button" className="quiet-action" onClick={cancelEditing} disabled={isSaving}>
                      <X size={13} aria-hidden="true" /> {tx('fees.cancel', 'Cancel')}
                    </button>
                    <button type="submit" className="primary-action save-action" disabled={!canSave || isSaving}>
                      <Save size={13} aria-hidden="true" /> {tx('fees.saveChanges', 'Save changes')}
                    </button>
                  </div>
                </form>
              </CollapsiblePanel>
            </article>
          )
        })}
      </div>

      <CollapsiblePanel open={adding} keepMounted className="fee-add-collapse" innerClassName="fee-add-collapse-inner" openMs={380} closeMs={320}>
        <div className="fee-add-form">
          <input type="number" placeholder={tx('fees.amountPlaceholder', 'Amount')} value={amount} onChange={function (e) { setAmount(e.target.value) }} className="settings-input" min="0.01" max="10000" step="0.01" />
          <Select value={currency} options={currencyOptions} onChange={setCurrency} ariaLabel={tx('fees.currency', 'Currency')} size="small" />
          <label className="fee-waived-label">
            <input type="checkbox" checked={waived} onChange={function (e) { setWaived(e.target.checked) }} /> {tx('fees.waivedLabel', 'Waived')}
          </label>
          <input type="text" placeholder={tx('fees.notesPlaceholder', 'Notes (optional)')} value={notes} onChange={function (e) { setNotes(e.target.value) }} className="settings-input" />
          <div className="fee-add-actions">
            <button type="button" className="quiet-action" onClick={function () { setAdding(false) }}>{tx('fees.cancel', 'Cancel')}</button>
            <button type="button" className="primary-action" onClick={handleAdd}>{tx('fees.addFee', 'Add Fee')}</button>
          </div>
        </div>
      </CollapsiblePanel>
      <InlinePresence present={!adding}>
        <button type="button" className="secondary-action fee-add-trigger" onClick={function () {
          if (isDirty) {
            requestCloseEditing(null)
            return
          }
          forceCloseEditing()
          setAdding(true)
        }}>
          <Plus size={14} aria-hidden="true" /> {tx('fees.addFeeTitle', 'Add Fee')}
        </button>
      </InlinePresence>

      {closePromptOpen ? (
        <ModalPortal>
          <div
            className={`dialog-layer${closePromptExiting ? ' exiting' : ''}`}
            onClick={(event) => {
              if (event.target === event.currentTarget) requestClosePrompt()
            }}
          >
            <section
              className="confirm-dialog fee-unsaved-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="fee-unsaved-title"
              aria-describedby="fee-unsaved-message"
            >
              <div className="confirm-icon">
                <AlertTriangle size={22} aria-hidden="true" />
              </div>
              <h3 id="fee-unsaved-title">{tx('fees.unsavedTitle', 'Save fee changes?')}</h3>
              <p id="fee-unsaved-message">
                {tx('fees.unsavedMessage', 'You changed this fee. Save the changes, discard them, or keep editing.')}
              </p>
              <div className="confirm-actions fee-unsaved-actions">
                <button
                  type="button"
                  className="primary-action"
                  disabled={Boolean(savingFeeId)}
                  onClick={() => void handlePromptSave()}
                >
                  <Save size={13} aria-hidden="true" />
                  {tx('fees.saveChanges', 'Save changes')}
                </button>
                <button
                  type="button"
                  className="warning-action"
                  disabled={Boolean(savingFeeId)}
                  onClick={handlePromptDiscard}
                >
                  <Undo2 size={13} aria-hidden="true" />
                  {tx('fees.discardChanges', 'Discard')}
                </button>
                <button
                  type="button"
                  className="quiet-action"
                  disabled={Boolean(savingFeeId)}
                  onClick={() => requestClosePrompt()}
                >
                  <X size={13} aria-hidden="true" />
                  {tx('fees.cancel', 'Cancel')}
                </button>
              </div>
            </section>
          </div>
        </ModalPortal>
      ) : null}
    </div>
  )
}
