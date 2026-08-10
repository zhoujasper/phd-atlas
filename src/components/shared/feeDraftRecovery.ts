import { clearVerifiedStorageItem, setVerifiedStorageItem } from '../../verifiedStorage'

const FEE_DRAFT_RECOVERY_PREFIX = 'phd-atlas-fee-draft:v1'

export type RecoverableFeeAddDraft = {
  amount: string
  currency: string
  notes: string
  waived: boolean
}

export type RecoverableFeeEditDraft = RecoverableFeeAddDraft & {
  paid: boolean
  paidDate: string
}

export type RecoverableFeeDraft =
  | {
      version: 1
      kind: 'add'
      draft: RecoverableFeeAddDraft
      updatedAt: number
    }
  | {
      version: 1
      kind: 'edit'
      feeId: string
      draft: RecoverableFeeEditDraft
      baseline: RecoverableFeeEditDraft
      updatedAt: number
    }

function recoveryKey(userId: string, applicationId: string) {
  return `${FEE_DRAFT_RECOVERY_PREFIX}:${encodeURIComponent(userId)}:${encodeURIComponent(applicationId)}`
}

function validShortString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length <= maximum
}

function validAddDraft(value: unknown): value is RecoverableFeeAddDraft {
  if (!value || typeof value !== 'object') return false
  const draft = value as Partial<RecoverableFeeAddDraft>
  return validShortString(draft.amount, 64)
    && typeof draft.currency === 'string'
    && /^[A-Z]{3}$/u.test(draft.currency)
    && validShortString(draft.notes, 500)
    && typeof draft.waived === 'boolean'
}

function validEditDraft(value: unknown): value is RecoverableFeeEditDraft {
  if (!validAddDraft(value)) return false
  const draft = value as Partial<RecoverableFeeEditDraft>
  return typeof draft.paid === 'boolean'
    && typeof draft.paidDate === 'string'
    && (draft.paidDate === '' || /^\d{4}-\d{2}-\d{2}$/u.test(draft.paidDate))
}

function parseRecovery(value: unknown): RecoverableFeeDraft | null {
  if (!value || typeof value !== 'object') return null
  const recovery = value as Partial<RecoverableFeeDraft>
  if (recovery.version !== 1 || !Number.isFinite(recovery.updatedAt)) return null
  if (recovery.kind === 'add' && validAddDraft(recovery.draft)) {
    return recovery as RecoverableFeeDraft
  }
  if (
    recovery.kind === 'edit'
    && typeof recovery.feeId === 'string'
    && recovery.feeId.length > 0
    && recovery.feeId.length <= 256
    && validEditDraft(recovery.draft)
    && validEditDraft(recovery.baseline)
  ) {
    return recovery as RecoverableFeeDraft
  }
  return null
}

export function loadRecoverableFeeDraft(
  userId: string,
  applicationId: string,
  storage?: Pick<Storage, 'getItem'>,
) {
  try {
    const target = storage ?? globalThis.sessionStorage
    if (!target || !userId || !applicationId) return null
    const raw = target.getItem(recoveryKey(userId, applicationId))
    if (!raw) return null
    return parseRecovery(JSON.parse(raw))
  } catch {
    return null
  }
}

export function saveRecoverableFeeDraft(
  userId: string,
  applicationId: string,
  draft: RecoverableFeeDraft,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
) {
  try {
    const target = storage ?? globalThis.sessionStorage
    if (!target || !userId || !applicationId || !parseRecovery(draft)) return false
    return setVerifiedStorageItem(target, recoveryKey(userId, applicationId), JSON.stringify(draft))
  } catch {
    return false
  }
}

export function clearRecoverableFeeDraft(
  userId: string,
  applicationId: string,
  storage?: Pick<Storage, 'getItem' | 'removeItem'> & Partial<Pick<Storage, 'setItem'>>,
) {
  try {
    const target = storage ?? globalThis.sessionStorage
    if (!target || !userId || !applicationId) return false
    return clearVerifiedStorageItem(target, recoveryKey(userId, applicationId))
  } catch {
    return false
  }
}
