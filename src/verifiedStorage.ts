export type VerifiableStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/**
 * Browser storage implementations and privacy shims are allowed to reject a
 * write without throwing. A recovery snapshot is trustworthy only after the
 * exact bytes can be read back from the same key.
 */
export function setVerifiedStorageItem(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  key: string,
  value: string,
) {
  try {
    storage.setItem(key, value)
    return storage.getItem(key) === value
  } catch {
    return false
  }
}

/** A cleared recovery record is acknowledged only when a read returns null. */
export function removeVerifiedStorageItem(
  storage: Pick<Storage, 'getItem' | 'removeItem'>,
  key: string,
) {
  try {
    storage.removeItem(key)
    return storage.getItem(key) === null
  } catch {
    return false
  }
}

const CLEARED_RECOVERY_TOMBSTONE = '{"cleared":true,"version":1}'

/**
 * Some privacy shims accept removeItem but leave the old value in place. When
 * writes still work, replace that stale draft with a verified non-draft
 * tombstone so it cannot reappear after a successful server save.
 */
export function clearVerifiedStorageItem(
  storage: Pick<Storage, 'getItem' | 'removeItem'> & Partial<Pick<Storage, 'setItem'>>,
  key: string,
) {
  if (removeVerifiedStorageItem(storage, key)) return true
  if (typeof storage.setItem !== 'function') return false
  return setVerifiedStorageItem(
    storage as Pick<Storage, 'getItem' | 'setItem'>,
    key,
    CLEARED_RECOVERY_TOMBSTONE,
  )
}
