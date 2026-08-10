// Payload length is part of the covering metadata projection. Keeping this
// batch deliberately small bounds the time spent inside one synchronous
// better-sqlite3 call even when every encrypted row is unusually large.
export const DEFAULT_SCOPED_KEYSET_BATCH_SIZE = 32

/**
 * Turns a keyset batch loader into the one-row-at-a-time interface used by the
 * workspace cursors. Only compact metadata is buffered; decoded payloads keep
 * their separate per-row memory lease and never accumulate in this reader.
 */
export function createBatchedKeysetReader({
  batchSize = DEFAULT_SCOPED_KEYSET_BATCH_SIZE,
  loadBatch,
  cursorFromRow,
}) {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1_024) {
    throw new RangeError('A scoped keyset batch size must be an integer between 1 and 1024.')
  }
  if (typeof loadBatch !== 'function' || typeof cursorFromRow !== 'function') {
    throw new TypeError('A scoped keyset reader requires batch and cursor functions.')
  }

  let cursor = null
  let rows = []
  let rowIndex = 0
  let exhausted = false

  return () => {
    if (rowIndex >= rows.length) {
      if (exhausted) return null
      const loaded = loadBatch(cursor, batchSize)
      if (!Array.isArray(loaded) || loaded.length > batchSize) {
        throw new TypeError('A scoped keyset batch loader returned an invalid batch.')
      }
      rows = loaded
      rowIndex = 0
      if (rows.length === 0) {
        exhausted = true
        return null
      }
      if (rows.length < batchSize) exhausted = true
    }

    const row = rows[rowIndex]
    rowIndex += 1
    if (row === null || row === undefined) {
      throw new TypeError('A scoped keyset batch cannot contain an empty row.')
    }
    cursor = cursorFromRow(row)
    return row
  }
}
