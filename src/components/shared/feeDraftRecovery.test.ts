import { describe, expect, it } from 'vitest'
import {
  clearRecoverableFeeDraft,
  loadRecoverableFeeDraft,
  saveRecoverableFeeDraft,
  type RecoverableFeeDraft,
} from './feeDraftRecovery'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem(key: string) {
      return values.get(key) ?? null
    },
    setItem(key: string, value: string) {
      values.set(key, value)
    },
    removeItem(key: string) {
      values.delete(key)
    },
  }
}

const editRecovery: RecoverableFeeDraft = {
  version: 1,
  kind: 'edit',
  feeId: 'fee-1',
  baseline: {
    amount: '80',
    currency: 'GBP',
    notes: 'Original',
    waived: false,
    paid: true,
    paidDate: '2026-07-15',
  },
  draft: {
    amount: '95',
    currency: 'GBP',
    notes: 'Resident change',
    waived: false,
    paid: false,
    paidDate: '',
  },
  updatedAt: 1,
}

describe('fee draft recovery', () => {
  it('round-trips an exact draft only for its user and application scope', () => {
    const storage = memoryStorage()
    expect(saveRecoverableFeeDraft('user-a', 'app-a', editRecovery, storage)).toBe(true)
    expect(loadRecoverableFeeDraft('user-a', 'app-a', storage)).toEqual(editRecovery)
    expect(loadRecoverableFeeDraft('user-b', 'app-a', storage)).toBeNull()
    expect(loadRecoverableFeeDraft('user-a', 'app-b', storage)).toBeNull()
  })

  it('rejects a storage shim that silently ignores the recovery write', () => {
    const storage = {
      getItem: () => null,
      setItem: () => undefined,
    }
    expect(saveRecoverableFeeDraft('user-a', 'app-a', editRecovery, storage)).toBe(false)
  })

  it('uses a verified tombstone when removeItem leaves stale draft bytes behind', () => {
    const storage = memoryStorage()
    expect(saveRecoverableFeeDraft('user-a', 'app-a', editRecovery, storage)).toBe(true)
    const stickyRemove = {
      getItem: storage.getItem,
      setItem: storage.setItem,
      removeItem: () => undefined,
    }
    expect(clearRecoverableFeeDraft('user-a', 'app-a', stickyRemove)).toBe(true)
    expect(loadRecoverableFeeDraft('user-a', 'app-a', storage)).toBeNull()
  })
})
