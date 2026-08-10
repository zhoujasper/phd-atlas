import { AlertTriangle, Check, Pencil, Plus, ReceiptText, Save, Trash2, Undo2, X } from 'lucide-react'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { normalizeErrorMessage } from '../../errorMessages'
import { formatCount } from '../../i18n'
import { registerSafeReloadGuard } from '../../safeReload'
import { useI18n } from '../hooks/useI18n'
import { getMotionDelay, useAnimatedClose } from '../hooks/useAnimatedClose'
import { DatePicker } from './DatePicker'
import { CollapsiblePanel } from './CollapsiblePanel'
import { InlinePresence } from './InlinePresence'
import { InlineConfirm } from './InlineConfirm'
import { ModalPortal } from './ModalPortal'
import { Select } from './Select'
import { formatFeeAmount } from './feeFormatting'
import {
  clearRecoverableFeeDraft,
  loadRecoverableFeeDraft,
  saveRecoverableFeeDraft,
  type RecoverableFeeAddDraft,
  type RecoverableFeeDraft,
  type RecoverableFeeEditDraft,
} from './feeDraftRecovery'

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
  userId: string
  applicationId: string
  fees: Fee[]
  onAdd: (fee: { amount: number; currency: string; paidDate?: string; waived: boolean; notes: string }) => boolean | void | Promise<boolean | void>
  onDelete: (feeId: string) => void | Promise<void>
  onUpdate: (feeId: string, patch: { amount?: number; currency?: string; paidDate?: string | null; waived?: boolean; notes?: string }) => boolean | void | Promise<boolean | void>
  onRegisterExitGuard?: (guard: FeeTrackerExitGuard | null) => void
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info' | 'warning') => void
}

export type FeeTrackerExitGuard = (proceed: () => void) => boolean

type FeeEditDraft = RecoverableFeeEditDraft

type FeeStatus = 'outstanding' | 'paid' | 'waived'

interface FeeStatusControlProps {
  value: FeeStatus
  ariaLabel: string
  outstandingLabel: string
  paidLabel: string
  waivedLabel: string
  includePaid?: boolean
  onChange: (status: FeeStatus) => void
}

function FeeStatusControl({
  value,
  ariaLabel,
  outstandingLabel,
  paidLabel,
  waivedLabel,
  includePaid = true,
  onChange,
}: FeeStatusControlProps) {
  const options: Array<{ value: FeeStatus; label: string }> = [
    { value: 'outstanding', label: outstandingLabel },
    ...(includePaid ? [{ value: 'paid' as const, label: paidLabel }] : []),
    { value: 'waived', label: waivedLabel },
  ]
  const activeIndex = Math.max(0, options.findIndex((option) => option.value === value))
  const statusStyle = {
    '--fee-status-count': options.length,
    '--fee-status-index': activeIndex,
  } as CSSProperties

  return (
    <div
      className="fee-status-control"
      role="group"
      aria-label={ariaLabel}
      style={statusStyle}
    >
      <span className="fee-status-indicator" aria-hidden="true" />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`fee-status-option is-${option.value}${value === option.value ? ' is-active' : ''}`}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  )
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

function draftsEqual(left: FeeEditDraft, right: FeeEditDraft): boolean {
  return left.amount === right.amount
    && left.currency === right.currency
    && left.notes === right.notes
    && left.waived === right.waived
    && left.paid === right.paid
    && left.paidDate === right.paidDate
}

function defaultAddDraft(): RecoverableFeeAddDraft {
  return { amount: '', currency: 'USD', notes: '', waived: false }
}

function addDraftIsDirty(draft: RecoverableFeeAddDraft) {
  const baseline = defaultAddDraft()
  return draft.amount.trim().length > 0
    || draft.currency !== baseline.currency
    || draft.notes.trim().length > 0
    || draft.waived !== baseline.waived
}

function addDraftsEqual(left: RecoverableFeeAddDraft, right: RecoverableFeeAddDraft) {
  return left.amount === right.amount
    && left.currency === right.currency
    && left.notes === right.notes
    && left.waived === right.waived
}

function usableRecovery(recovery: RecoverableFeeDraft | null, fees: Fee[]): RecoverableFeeDraft | null {
  if (!recovery) return null
  if (recovery.kind === 'edit' && !fees.some((fee) => fee.id === recovery.feeId)) return null
  return recovery
}

export default function FeeTracker(props: FeeTrackerProps) {
  const { tx, lang } = useI18n()
  const { onNotify, onRegisterExitGuard } = props
  const safeReloadGuardId = useId()
  const initialRecoveryRef = useRef<RecoverableFeeDraft | null>(null)
  const initialRecoveryLoadedRef = useRef(false)
  if (!initialRecoveryLoadedRef.current) {
    initialRecoveryLoadedRef.current = true
    initialRecoveryRef.current = usableRecovery(
      loadRecoverableFeeDraft(props.userId, props.applicationId),
      props.fees,
    )
  }
  const initialRecovery = initialRecoveryRef.current
  const initialAddDraft = initialRecovery?.kind === 'add' ? initialRecovery.draft : defaultAddDraft()
  const initialEditRecovery = initialRecovery?.kind === 'edit' ? initialRecovery : null
  const [adding, setAdding] = useState(initialRecovery?.kind === 'add')
  const [amount, setAmount] = useState(initialAddDraft.amount)
  const [currency, setCurrency] = useState(initialAddDraft.currency)
  const [notes, setNotes] = useState(initialAddDraft.notes)
  const [waived, setWaived] = useState(initialAddDraft.waived)
  const [editingFeeId, setEditingFeeId] = useState<string | null>(initialEditRecovery?.feeId ?? null)
  const [editDraft, setEditDraft] = useState<FeeEditDraft | null>(initialEditRecovery?.draft ?? null)
  const [editBaseline, setEditBaseline] = useState<FeeEditDraft | null>(initialEditRecovery?.baseline ?? null)
  const [savingFeeId, setSavingFeeId] = useState<string | null>(null)
  const [updatingFeeIds, setUpdatingFeeIds] = useState<Set<string>>(() => new Set())
  const [addingBusy, setAddingBusy] = useState(false)
  const [mutationError, setMutationError] = useState('')
  const [pendingDeleteFeeId, setPendingDeleteFeeId] = useState<string | null>(null)
  const [removingFeeIds, setRemovingFeeIds] = useState<Set<string>>(() => new Set())
  const [closePromptOpen, setClosePromptOpen] = useState(false)
  const pendingContinuationRef = useRef<(() => void) | null>(null)
  const acknowledgedAddRef = useRef<RecoverableFeeAddDraft | null>(null)
  const recoveryWarningShownRef = useRef(false)
  const scopeRef = useRef({
    key: `${props.userId}\u0000${props.applicationId}`,
    userId: props.userId,
    applicationId: props.applicationId,
  })

  const totalFees = props.fees.filter(function (f) { return !f.waived }).reduce(function (sum, f) { return sum + f.amount }, 0)
  const totalPaid = props.fees.filter(function (f) { return f.paidDate && !f.waived }).reduce(function (sum, f) { return sum + f.amount }, 0)
  const displayCurrency = props.fees.find(function (f) { return !f.waived })?.currency ?? currency
  const currencyOptions = ['USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD', 'CNY', 'JPY', 'KRW'].map(function (code) {
    return { value: code, label: code }
  })

  const addDraft: RecoverableFeeAddDraft = { amount, currency, notes, waived }
  const addDirty = adding && addDraftIsDirty(addDraft)
  const editDirty = Boolean(editingFeeId && editDraft && editBaseline && !draftsEqual(editDraft, editBaseline))
  const isDirty = addDirty || editDirty
  const dirtyRef = useRef(isDirty)
  const recoveryRef = useRef<RecoverableFeeDraft | null>(null)
  dirtyRef.current = isDirty
  recoveryRef.current = addDirty
    ? { version: 1, kind: 'add', draft: addDraft, updatedAt: Date.now() }
    : editDirty && editingFeeId && editDraft && editBaseline
      ? { version: 1, kind: 'edit', feeId: editingFeeId, draft: editDraft, baseline: editBaseline, updatedAt: Date.now() }
      : null

  const notifyRecoveryFailure = useCallback(() => {
    if (recoveryWarningShownRef.current) return
    recoveryWarningShownRef.current = true
    onNotify?.(tx(
      'localRecoveryUnavailable',
      'Local draft recovery is unavailable. This page will not reload automatically; save or discard your changes before leaving.',
    ), 'warning')
  }, [onNotify, tx])

  const persistRecovery = useCallback(() => {
    const recovery = recoveryRef.current
    if (!recovery) return true
    const scope = scopeRef.current
    const saved = saveRecoverableFeeDraft(scope.userId, scope.applicationId, recovery)
    if (!saved) notifyRecoveryFailure()
    else recoveryWarningShownRef.current = false
    return saved
  }, [notifyRecoveryFailure])

  const clearRecovery = useCallback(() => {
    const scope = scopeRef.current
    const cleared = clearRecoverableFeeDraft(scope.userId, scope.applicationId)
    if (!cleared) notifyRecoveryFailure()
    else recoveryWarningShownRef.current = false
    return cleared
  }, [notifyRecoveryFailure])

  useLayoutEffect(() => {
    if (isDirty) persistRecovery()
  }, [amount, currency, editBaseline, editDraft, editingFeeId, isDirty, notes, persistRecovery, waived])

  useEffect(() => registerSafeReloadGuard(`fee-tracker:${safeReloadGuardId}`, {
    prepare: persistRecovery,
    hasUnsavedChanges: () => dirtyRef.current,
  }), [persistRecovery, safeReloadGuardId])

  useEffect(() => {
    const handlePageHide = () => persistRecovery()
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return
      persistRecovery()
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [persistRecovery])

  useEffect(() => () => {
    persistRecovery()
  }, [persistRecovery])

  useEffect(() => {
    const nextKey = `${props.userId}\u0000${props.applicationId}`
    if (scopeRef.current.key === nextKey) return
    persistRecovery()
    const nextRecovery = usableRecovery(
      loadRecoverableFeeDraft(props.userId, props.applicationId),
      props.fees,
    )
    scopeRef.current = {
      key: nextKey,
      userId: props.userId,
      applicationId: props.applicationId,
    }
    acknowledgedAddRef.current = null
    pendingContinuationRef.current = null
    setClosePromptOpen(false)
    setMutationError('')
    if (nextRecovery?.kind === 'add') {
      setAdding(true)
      setAmount(nextRecovery.draft.amount)
      setCurrency(nextRecovery.draft.currency)
      setNotes(nextRecovery.draft.notes)
      setWaived(nextRecovery.draft.waived)
      setEditingFeeId(null)
      setEditDraft(null)
      setEditBaseline(null)
      return
    }
    const addBaseline = defaultAddDraft()
    setAdding(false)
    setAmount(addBaseline.amount)
    setCurrency(addBaseline.currency)
    setNotes(addBaseline.notes)
    setWaived(addBaseline.waived)
    setEditingFeeId(nextRecovery?.kind === 'edit' ? nextRecovery.feeId : null)
    setEditDraft(nextRecovery?.kind === 'edit' ? nextRecovery.draft : null)
    setEditBaseline(nextRecovery?.kind === 'edit' ? nextRecovery.baseline : null)
  }, [persistRecovery, props.applicationId, props.fees, props.userId])

  async function handleAdd(): Promise<boolean> {
    if (addingBusy) return false
    const amt = parseFloat(amount)
    if (!amt || amt <= 0 || amt > 10000) return false
    setAddingBusy(true)
    setMutationError('')
    try {
      const submittedDraft = { amount, currency, notes, waived }
      if (!acknowledgedAddRef.current || !addDraftsEqual(acknowledgedAddRef.current, submittedDraft)) {
        const saved = await props.onAdd({ amount: amt, currency, waived, notes })
        if (saved === false) return false
        acknowledgedAddRef.current = submittedDraft
      }
      if (!clearRecovery()) return false
      acknowledgedAddRef.current = null
      setAmount('')
      setCurrency('USD')
      setNotes('')
      setWaived(false)
      setAdding(false)
      return true
    } catch (reason) {
      setMutationError(normalizeErrorMessage(reason, lang, tx('apiErrors.REQUEST_FAILED')))
      persistRecovery()
      return false
    } finally {
      setAddingBusy(false)
    }
  }

  async function confirmFeeDelete(feeId: string) {
    setPendingDeleteFeeId(null)
    setRemovingFeeIds((current) => new Set(current).add(feeId))
    await new Promise<void>((resolve) => window.setTimeout(resolve, getMotionDelay(380)))
    try {
      await props.onDelete(feeId)
    } catch (reason) {
      // The caller owns the failure toast. Restore the row so it remains usable.
      setMutationError(normalizeErrorMessage(reason, lang, tx('apiErrors.REQUEST_FAILED')))
      setRemovingFeeIds((current) => {
        const next = new Set(current)
        next.delete(feeId)
        return next
      })
    } finally {
      // A successful parent update removes the row; if a caller keeps the row
      // mounted, it must still become usable instead of remaining permanently
      // disabled after the request settles.
      setRemovingFeeIds((current) => {
        if (!current.has(feeId)) return current
        const next = new Set(current)
        next.delete(feeId)
        return next
      })
    }
  }

  function openEditing(fee: Fee) {
    setAdding(false)
    setClosePromptOpen(false)
    setEditingFeeId(fee.id)
    const nextDraft = draftFromFee(fee)
    setEditDraft(nextDraft)
    setEditBaseline(nextDraft)
  }

  function forceCloseEditing() {
    setClosePromptOpen(false)
    setEditingFeeId(null)
    setEditDraft(null)
    setEditBaseline(null)
  }

  function forceCloseAdding() {
    const baseline = defaultAddDraft()
    acknowledgedAddRef.current = null
    setAdding(false)
    setAmount(baseline.amount)
    setCurrency(baseline.currency)
    setNotes(baseline.notes)
    setWaived(baseline.waived)
  }

  function requestResidentExit(proceed: () => void): boolean {
    if (savingFeeId || addingBusy) return false
    if (dirtyRef.current) {
      pendingContinuationRef.current = proceed
      setClosePromptOpen(true)
      return false
    }
    proceed()
    return true
  }

  function requestCloseEditing(nextFeeId: string | null = null) {
    requestResidentExit(() => {
      forceCloseEditing()
      if (nextFeeId) {
        const fee = props.fees.find((item) => item.id === nextFeeId)
        if (fee) openEditing(fee)
      }
    })
  }

  function toggleEditing(fee: Fee) {
    if (savingFeeId) return
    if (editingFeeId === fee.id) {
      requestCloseEditing(null)
      return
    }
    requestCloseEditing(fee.id)
  }

  function cancelEditing() {
    requestCloseEditing(null)
  }

  async function persistEdit(feeId: string): Promise<boolean> {
    if (!editDraft) return false
    const nextAmount = Number(editDraft.amount)
    if (!Number.isFinite(nextAmount) || nextAmount <= 0 || nextAmount > 10000) return false

    setSavingFeeId(feeId)
    setMutationError('')
    try {
      const saved = await props.onUpdate(feeId, {
        amount: nextAmount,
        currency: editDraft.currency,
        paidDate: editDraft.paid && !editDraft.waived ? editDraft.paidDate || new Date().toISOString().slice(0, 10) : null,
        waived: editDraft.waived,
        notes: editDraft.notes,
      })
      if (saved === false) return false
      return true
    } catch (reason) {
      setMutationError(normalizeErrorMessage(reason, lang, tx('apiErrors.REQUEST_FAILED')))
      return false
    } finally {
      setSavingFeeId(null)
    }
  }

  async function markPaid(feeId: string) {
    if (updatingFeeIds.has(feeId) || removingFeeIds.has(feeId)) return
    setMutationError('')
    setUpdatingFeeIds((current) => new Set(current).add(feeId))
    try {
      await props.onUpdate(feeId, { paidDate: new Date().toISOString().slice(0, 10), waived: false })
    } catch (reason) {
      setMutationError(normalizeErrorMessage(reason, lang, tx('apiErrors.REQUEST_FAILED')))
    } finally {
      setUpdatingFeeIds((current) => {
        if (!current.has(feeId)) return current
        const next = new Set(current)
        next.delete(feeId)
        return next
      })
    }
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>, feeId: string) {
    event.preventDefault()
    const ok = await persistEdit(feeId)
    if (!ok) return
    if (!clearRecovery()) return
    forceCloseEditing()
  }

  async function handlePromptSave() {
    const wasAdding = adding
    const ok = wasAdding
      ? await handleAdd()
      : editingFeeId
        ? await persistEdit(editingFeeId)
        : false
    if (!ok) return
    if (!wasAdding && !clearRecovery()) return
    if (!wasAdding) forceCloseEditing()
    const continuation = pendingContinuationRef.current
    pendingContinuationRef.current = null
    setClosePromptOpen(false)
    continuation?.()
  }

  function handlePromptDiscard() {
    if (!clearRecovery()) return
    if (adding) forceCloseAdding()
    else forceCloseEditing()
    const continuation = pendingContinuationRef.current
    pendingContinuationRef.current = null
    setClosePromptOpen(false)
    continuation?.()
  }

  function handlePromptCancel() {
    setClosePromptOpen(false)
    pendingContinuationRef.current = null
  }

  function cancelAdding() {
    requestResidentExit(forceCloseAdding)
  }

  function beginAdding() {
    requestResidentExit(() => {
      forceCloseEditing()
      setAdding(true)
    })
  }

  const exitGuardRef = useRef<FeeTrackerExitGuard>(() => true)
  exitGuardRef.current = requestResidentExit

  useEffect(() => {
    if (!onRegisterExitGuard) return
    const guard: FeeTrackerExitGuard = (proceed) => exitGuardRef.current(proceed)
    onRegisterExitGuard(guard)
    return () => onRegisterExitGuard(null)
  }, [onRegisterExitGuard])

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
          <span className="fee-stat-value">{formatFeeAmount(totalFees, displayCurrency, lang)}</span>
          <span className="fee-stat-label">{tx('fees.amount', 'Amount')}</span>
        </div>
        <div className="fee-stat">
          <span className="fee-stat-value">{formatFeeAmount(totalPaid, displayCurrency, lang)}</span>
          <span className="fee-stat-label">{tx('fees.paid', 'Paid')}</span>
        </div>
        <div className="fee-stat">
          <span className="fee-stat-value">{formatFeeAmount(totalFees - totalPaid, displayCurrency, lang)}</span>
          <span className="fee-stat-label">{tx('fees.remaining', 'Remaining')}</span>
        </div>
      </div>
      {mutationError ? <p className="fee-mutation-error" role="alert">{mutationError}</p> : null}

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
          const isUpdating = updatingFeeIds.has(fee.id)
          const isRemoving = removingFeeIds.has(fee.id)
          const rowDraft = isEditing && editDraft ? editDraft : draftFromFee(fee)
          const feeStatus: FeeStatus = fee.waived ? 'waived' : fee.paidDate ? 'paid' : 'outstanding'
          const draftStatus: FeeStatus = rowDraft.waived ? 'waived' : rowDraft.paid ? 'paid' : 'outstanding'
          const editableAmount = Number(editDraft?.amount ?? '')
          const canSave = Number.isFinite(editableAmount) && editableAmount > 0 && editableAmount <= 10000
          return (
            <article
              key={fee.id}
              id={`fee-${fee.id}`}
              className={'fee-item' + (fee.waived ? ' waived' : '') + (fee.paidDate ? ' paid' : '') + (isEditing ? ' editing' : '') + (isRemoving ? ' is-removing' : '')}
              aria-busy={isSaving || isUpdating || isRemoving || undefined}
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
                <span className="fee-amount">{formatFeeAmount(fee.amount, fee.currency, lang)}</span>
                <span className={`fee-status-summary is-${feeStatus}`}>
                  <span>
                    {feeStatus === 'paid'
                      ? tx('fees.paid', 'Paid')
                      : feeStatus === 'waived'
                        ? tx('fees.waived', 'Waived')
                        : tx('fees.remaining', 'Remaining')}
                  </span>
                </span>
                <InlinePresence present={Boolean(fee.notes)} parentGap="6px">
                  <span className="fee-notes">{fee.notes}</span>
                </InlinePresence>
              </button>
              <div className="fee-item-actions">
                <InlinePresence present={!fee.paidDate && !fee.waived} parentGap="2px">
                  <button
                    type="button"
                    className="quiet-action fee-row-action fee-mark-paid-action"
                    disabled={isUpdating || isRemoving}
                    title={tx('fees.markPaid', 'Mark paid')}
                    aria-label={tx('fees.markPaid', 'Mark paid')}
                    onClick={function () {
                      void markPaid(fee.id)
                    }}
                  >
                    <Check size={13} aria-hidden="true" />
                  </button>
                </InlinePresence>
                <button
                  type="button"
                  className={`quiet-action fee-row-action fee-edit-action${isEditing ? ' is-editing' : ''}`}
                  onClick={function () { toggleEditing(fee) }}
                  disabled={isUpdating || isRemoving}
                  title={isEditing ? tx('fees.collapseFee', 'Collapse fee') : tx('fees.editFee', 'Edit fee')}
                  aria-label={isEditing ? tx('fees.collapseFee', 'Collapse fee') : tx('fees.editFee', 'Edit fee')}
                  aria-expanded={isEditing}
                >
                  <span className="fee-action-icon-stage" aria-hidden="true">
                    <Pencil className="fee-action-pencil" size={13} />
                    <X className="fee-action-close" size={13} />
                  </span>
                </button>
                <InlineConfirm
                  className="fee-delete-confirm"
                  idleClassName="fee-row-action fee-delete-action"
                  open={pendingDeleteFeeId === fee.id}
                  busy={isRemoving}
                  disabled={isSaving || isUpdating || isRemoving}
                  confirmLabel={tx('fees.remove', 'Remove')}
                  cancelLabel={tx('fees.cancel', 'Cancel')}
                  confirmTone="danger"
                  idleTitle={tx('fees.remove', 'Remove')}
                  idleAriaLabel={tx('fees.remove', 'Remove')}
                  onOpen={() => setPendingDeleteFeeId(fee.id)}
                  onCancel={() => setPendingDeleteFeeId(null)}
                  onConfirm={() => confirmFeeDelete(fee.id)}
                >
                  <Trash2 size={13} aria-hidden="true" />
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
                  <label className="fee-edit-field fee-edit-amount">
                    <span>{tx('fees.amount', 'Amount')}</span>
                    <input
                      type="number"
                      required
                      className="settings-input"
                      min="0.01"
                      max="10000"
                      step="0.01"
                      value={rowDraft.amount}
                      onChange={function (event) { setEditDraft({ ...rowDraft, amount: event.target.value }) }}
                    />
                  </label>
                  <label className="fee-edit-field fee-edit-currency">
                    <span>{tx('fees.currency', 'Currency')}</span>
                    <Select
                      value={rowDraft.currency}
                      options={currencyOptions}
                      onChange={function (value) { setEditDraft({ ...rowDraft, currency: value }) }}
                      ariaLabel={tx('fees.currency', 'Currency')}
                      size="small"
                    />
                  </label>
                  <div className="fee-edit-field fee-edit-status">
                    <span>{tx('dossier.status', 'Status')}</span>
                    <FeeStatusControl
                      value={draftStatus}
                      ariaLabel={tx('dossier.status', 'Status')}
                      outstandingLabel={tx('fees.remaining', 'Remaining')}
                      paidLabel={tx('fees.paid', 'Paid')}
                      waivedLabel={tx('fees.waivedLabel', 'Waived')}
                      onChange={(status) => {
                        const paid = status === 'paid'
                        setEditDraft({
                          ...rowDraft,
                          paid,
                          paidDate: paid ? rowDraft.paidDate || new Date().toISOString().slice(0, 10) : '',
                          waived: status === 'waived',
                        })
                      }}
                    />
                  </div>
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
                      <button type="button" className="quiet-action" onClick={cancelEditing} disabled={isSaving || isUpdating}>
                      <X size={13} aria-hidden="true" /> {tx('fees.cancel', 'Cancel')}
                    </button>
                    <button type="submit" className="primary-action save-action" disabled={!canSave || isSaving || isUpdating}>
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
        <form
          className="fee-add-form"
          onSubmit={function (event) {
            event.preventDefault()
            void handleAdd()
          }}
        >
          <input type="number" required aria-label={tx('fees.amount', 'Amount')} placeholder={tx('fees.amountPlaceholder', 'Amount')} value={amount} onChange={function (e) { setAmount(e.target.value) }} className="settings-input fee-add-amount" min="0.01" max="10000" step="0.01" />
          <Select value={currency} options={currencyOptions} onChange={setCurrency} ariaLabel={tx('fees.currency', 'Currency')} size="small" />
          <div className="fee-add-status">
            <FeeStatusControl
              value={waived ? 'waived' : 'outstanding'}
              ariaLabel={tx('dossier.status', 'Status')}
              outstandingLabel={tx('fees.remaining', 'Remaining')}
              paidLabel={tx('fees.paid', 'Paid')}
              waivedLabel={tx('fees.waivedLabel', 'Waived')}
              includePaid={false}
              onChange={(status) => setWaived(status === 'waived')}
            />
          </div>
          <input type="text" placeholder={tx('fees.notesPlaceholder', 'Notes (optional)')} value={notes} onChange={function (e) { setNotes(e.target.value) }} className="settings-input fee-add-notes" maxLength={500} />
          <div className="fee-add-actions">
            <button type="button" className="quiet-action" onClick={cancelAdding} disabled={addingBusy}>{tx('fees.cancel', 'Cancel')}</button>
            <button type="submit" className="primary-action" disabled={addingBusy} aria-busy={addingBusy || undefined}>{addingBusy ? tx('working') : tx('fees.addFee', 'Add Fee')}</button>
          </div>
        </form>
      </CollapsiblePanel>
      <InlinePresence present={!adding}>
        <button type="button" className="secondary-action fee-add-trigger" onClick={beginAdding}>
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
                  disabled={Boolean(savingFeeId) || addingBusy}
                  onClick={() => void handlePromptSave()}
                >
                  <Save size={12} aria-hidden="true" />
                  {adding ? tx('fees.addFee', 'Add Fee') : tx('fees.saveChanges', 'Save changes')}
                </button>
                <button
                  type="button"
                  className="warning-action"
                  disabled={Boolean(savingFeeId) || addingBusy}
                  onClick={handlePromptDiscard}
                >
                  <Undo2 size={12} aria-hidden="true" />
                  {tx('fees.discardChanges', 'Discard')}
                </button>
                <button
                  type="button"
                  className="quiet-action"
                  disabled={Boolean(savingFeeId) || addingBusy}
                  onClick={() => requestClosePrompt()}
                >
                  <X size={12} aria-hidden="true" />
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
