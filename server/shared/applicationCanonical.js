import {
  APPLICATION_SERVER_AUTHORITY_FIELDS,
  COMMUNICATION_SERVER_AUTHORITY_FIELDS,
  SCHOOL_SERVER_AUTHORITY_FIELDS,
  VAULT_REFERENCE_FIELDS,
  isApplicationServerAuthorityPath,
} from './applicationAuthorityFields.js'
const STRING_CHUNK_CODE_UNITS = 8 * 1024

function excludedProjectionField(path, key) {
  return isApplicationServerAuthorityPath([...path, key])
}

function * quotedChunks(value) {
  yield '"'
  let sliceStart = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    let escaped = null
    if (code === 0x22) escaped = '\\"'
    else if (code === 0x5c) escaped = '\\\\'
    else if (code === 0x08) escaped = '\\b'
    else if (code === 0x0c) escaped = '\\f'
    else if (code === 0x0a) escaped = '\\n'
    else if (code === 0x0d) escaped = '\\r'
    else if (code === 0x09) escaped = '\\t'
    else if (code < 0x20 || (code >= 0xd800 && code <= 0xdfff)) {
      if (
        code >= 0xd800
        && code <= 0xdbff
        && index + 1 < value.length
        && value.charCodeAt(index + 1) >= 0xdc00
        && value.charCodeAt(index + 1) <= 0xdfff
      ) {
        index += 1
      } else {
        escaped = `\\u${code.toString(16).padStart(4, '0')}`
      }
    }
    if (escaped !== null) {
      if (index > sliceStart) yield value.slice(sliceStart, index)
      yield escaped
      sliceStart = index + 1
      continue
    }
    if (index - sliceStart + 1 >= STRING_CHUNK_CODE_UNITS) {
      yield value.slice(sliceStart, index + 1)
      sliceStart = index + 1
    }
  }
  if (sliceStart < value.length) yield value.slice(sliceStart)
  yield '"'
}

function * canonicalChunks(value, path, excludeApplicationAuthority, ancestors) {
  if (value === null) {
    yield 'null'
    return
  }
  const valueType = typeof value
  if (valueType === 'string') {
    yield * quotedChunks(value)
    return
  }
  if (valueType === 'number') {
    yield Number.isFinite(value) ? String(value) : 'null'
    return
  }
  if (valueType === 'boolean') {
    yield value ? 'true' : 'false'
    return
  }
  if (valueType === 'bigint') throw new TypeError('BigInt is not valid canonical JSON.')
  if (valueType !== 'object') {
    yield 'null'
    return
  }
  if (ancestors.has(value)) throw new TypeError('Circular values are not valid canonical JSON.')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      yield '['
      for (let index = 0; index < value.length; index += 1) {
        if (index > 0) yield ','
        const item = value[index]
        yield * canonicalChunks(
          item === undefined || typeof item === 'function' || typeof item === 'symbol' ? null : item,
          [...path, index],
          excludeApplicationAuthority,
          ancestors,
        )
      }
      yield ']'
      return
    }

    yield '{'
    const keys = Object.keys(value)
      .filter((key) => {
        const item = value[key]
        return item !== undefined
          && typeof item !== 'function'
          && typeof item !== 'symbol'
          && (
            !excludeApplicationAuthority
            || !excludedProjectionField(path, key)
          )
      })
      .sort()
    for (let index = 0; index < keys.length; index += 1) {
      if (index > 0) yield ','
      const key = keys[index]
      yield * quotedChunks(key)
      yield ':'
      yield * canonicalChunks(value[key], [...path, key], excludeApplicationAuthority, ancestors)
    }
    yield '}'
  } finally {
    ancestors.delete(value)
  }
}

/** Deterministic, allocation-bounded JSON chunks for arbitrary JSON values. */
export function canonicalJsonChunks(value) {
  return canonicalChunks(value, [], false, new WeakSet())
}

/**
 * Deterministic application projection shared by browser and API persistence
 * acknowledgements. Server-owned fields are skipped while walking rather than
 * copied into a second multi-megabyte object.
 */
export function canonicalApplicationProjectionChunks(application) {
  return canonicalChunks(application, [], true, new WeakSet())
}

export const canonicalApplicationAuthorityFields = Object.freeze({
  application: [...APPLICATION_SERVER_AUTHORITY_FIELDS],
  vault: [...VAULT_REFERENCE_FIELDS],
  communication: [...COMMUNICATION_SERVER_AUTHORITY_FIELDS],
  school: [...SCHOOL_SERVER_AUTHORITY_FIELDS],
})
