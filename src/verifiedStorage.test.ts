import { describe, expect, it } from 'vitest'
import { removeVerifiedStorageItem, setVerifiedStorageItem } from './verifiedStorage'

describe('verified browser storage', () => {
  it('rejects privacy shims that silently ignore writes', () => {
    const storage = {
      getItem: () => null,
      setItem: () => undefined,
    }
    expect(setVerifiedStorageItem(storage, 'draft', 'exact bytes')).toBe(false)
  })

  it('rejects a stale value when a shim silently ignores deletion', () => {
    const storage = {
      getItem: () => 'stale draft',
      removeItem: () => undefined,
    }
    expect(removeVerifiedStorageItem(storage, 'draft')).toBe(false)
  })

  it('acknowledges only an exact write and an observed deletion', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    }
    expect(setVerifiedStorageItem(storage, 'draft', 'exact bytes')).toBe(true)
    expect(removeVerifiedStorageItem(storage, 'draft')).toBe(true)
  })
})
