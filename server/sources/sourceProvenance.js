/**
 * `sourceUrl` is where a person should be sent to read this fact -- an award
 * page, a project page, a thread. `apiUrl` is the machine endpoint the row was
 * actually parsed from. Keeping them apart is what lets provenance offer a
 * readable link first and the raw JSON only to whoever asks for it.
 */
export function provenanceRecord({
  kind,
  value,
  sourceId,
  sourceUrl,
  apiUrl,
  fetchedAt,
  confidence = 1,
  extra = {},
} = {}) {
  return {
    kind,
    value,
    sourceId,
    sourceUrl,
    ...(apiUrl && apiUrl !== sourceUrl ? { apiUrl } : {}),
    fetchedAt,
    confidence,
    ...extra,
  }
}

function deepEqual(left, right) {
  if (Object.is(left, right)) return true
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => (
    Object.prototype.hasOwnProperty.call(right, key) && deepEqual(left[key], right[key])
  ))
}

/**
 * Groups provenance records by a stable fact key. If multiple sources disagree
 * about the value, the result records a disagreement instead of silently
 * choosing one source.
 */
export function compareFactSources(records, {
  getFactKey = (record) => record?.value?.id,
  getValue = (record) => record?.value,
  getSourceId = (record) => record?.sourceId,
  getSourceUrl = (record) => record?.sourceUrl,
  getFetchedAt = (record) => record?.fetchedAt,
  getConfidence = (record) => record?.confidence,
} = {}) {
  const byFact = new Map()
  for (const record of records || []) {
    const factKey = getFactKey(record)
    if (!factKey) continue
    const group = byFact.get(factKey) || {
      factKey,
      values: [],
      disagreement: false,
    }
    const value = getValue(record)
    const entry = {
      value,
      sourceId: getSourceId(record),
      sourceUrl: getSourceUrl(record),
      fetchedAt: getFetchedAt(record),
      confidence: getConfidence(record),
    }
    if (!group.values.some((existing) => deepEqual(existing.value, value))) {
      group.values.push(entry)
    }
    group.disagreement = group.values.length > 1
    byFact.set(factKey, group)
  }
  return [...byFact.values()].sort((left, right) => String(left.factKey).localeCompare(String(right.factKey)))
}

export function mergeWithProvenance(records, options = {}) {
  return compareFactSources(records, options).map((group) => {
    if (group.disagreement) {
      return {
        factKey: group.factKey,
        status: 'disagreement',
        value: null,
        sources: group.values,
      }
    }
    const entry = group.values[0]
    return {
      factKey: group.factKey,
      status: 'confirmed',
      value: entry.value,
      provenance: entry,
    }
  })
}
