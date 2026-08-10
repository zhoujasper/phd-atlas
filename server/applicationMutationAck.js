import { Buffer } from 'node:buffer'
import { createHash, timingSafeEqual } from 'node:crypto'
import { setImmediate as yieldToEventLoop } from 'node:timers/promises'
import { canonicalJsonChunks } from '../shared/applicationCanonical.js'
import {
  APPLICATION_SERVER_AUTHORITY_FIELDS,
  COMMUNICATION_SERVER_AUTHORITY_FIELDS,
  SCHOOL_SERVER_AUTHORITY_FIELDS,
  VAULT_REFERENCE_FIELDS,
} from '../shared/applicationAuthorityFields.js'
import {
  APPLICATION_AUTHORED_PROJECTION_VERSION,
  APPLICATION_AUTHORITY_PROJECTION_VERSION,
  APPLICATION_MUTATION_AUTHORITY_PATHS,
  APPLICATION_MUTATION_MAX_PATCH_OPERATIONS,
  canonicalApplicationAuthorityReceiptChunks,
  canonicalApplicationUserEditableChunks,
} from '../shared/applicationPersistenceProtocol.js'

export const APPLICATION_MUTATION_ACK_PROTOCOL = 'phd-atlas-application-mutation-ack-v2'
export const MAX_APPLICATION_MUTATION_ACK_BYTES = 512 * 1024
export const MAX_APPLICATION_MUTATION_PATCH_OPERATIONS = APPLICATION_MUTATION_MAX_PATCH_OPERATIONS
const MAX_INLINE_PATCH_VALUE_BYTES = 128 * 1024
const MAX_PATCH_DEPTH = 64
const MAX_PATCH_PATH_LENGTH = 2_048
const HASH_YIELD_BYTES = 512 * 1024
const forbiddenSegments = new Set(['__proto__', 'prototype', 'constructor'])

export class ApplicationMutationAckError extends Error {
  constructor(message, code = 'APPLICATION_MUTATION_ACK_INVALID', field = undefined) {
    super(message)
    this.name = 'ApplicationMutationAckError'
    this.code = code
    this.status = code === 'APPLICATION_MUTATION_ACK_TOO_LARGE' ? 413 : 409
    this.field = field
  }
}

function digestChunks(chunks) {
  const hash = createHash('sha256')
  for (const chunk of chunks) hash.update(chunk, 'utf8')
  return hash.digest('base64url')
}

async function digestChunksCooperatively(chunks) {
  const hash = createHash('sha256')
  let bytesSinceYield = 0
  for (const chunk of chunks) {
    hash.update(chunk, 'utf8')
    bytesSinceYield += Buffer.byteLength(chunk, 'utf8')
    if (bytesSinceYield >= HASH_YIELD_BYTES) {
      bytesSinceYield = 0
      await yieldToEventLoop()
    }
  }
  return hash.digest('base64url')
}

function canonicalByteLength(chunks, maximum = Number.POSITIVE_INFINITY) {
  let bytes = 0
  for (const chunk of chunks) {
    bytes += Buffer.byteLength(chunk, 'utf8')
    if (bytes > maximum) return bytes
  }
  return bytes
}

export function canonicalValueDigest(value) {
  return digestChunks(canonicalJsonChunks(value))
}

export function canonicalValueDigestCooperatively(value) {
  return digestChunksCooperatively(canonicalJsonChunks(value))
}

export function canonicalApplicationProjectionDigest(application) {
  return digestChunks(canonicalApplicationUserEditableChunks(application))
}

export function canonicalApplicationProjectionDigestCooperatively(application) {
  return digestChunksCooperatively(canonicalApplicationUserEditableChunks(application))
}

export function canonicalApplicationAuthorityDigest(application, authorityPurpose = 'none') {
  return digestChunks(canonicalApplicationAuthorityReceiptChunks(application, authorityPurpose))
}

export function canonicalApplicationAuthorityDigestCooperatively(application, authorityPurpose = 'none') {
  return digestChunksCooperatively(
    canonicalApplicationAuthorityReceiptChunks(application, authorityPurpose),
  )
}

const pointerSegment = (value) => value.replaceAll('~', '~0').replaceAll('/', '~1')

function appendPath(path, segment) {
  const text = String(segment)
  if (!text || forbiddenSegments.has(text)) {
    throw new ApplicationMutationAckError('The application acknowledgement contains an unsafe path.')
  }
  const next = `${path}/${pointerSegment(text)}`
  if (next.length > MAX_PATCH_PATH_LENGTH) {
    throw new ApplicationMutationAckError(
      'The application acknowledgement path is too long.',
      'APPLICATION_MUTATION_ACK_TOO_LARGE',
      next,
    )
  }
  return next
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stableArrayIds(value) {
  if (!Array.isArray(value) || value.length === 0) return null
  const ids = []
  const unique = new Set()
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id || unique.has(item.id)) return null
    unique.add(item.id)
    ids.push(item.id)
  }
  return ids
}

async function createCanonicalPatch(baseline, application, options = {}) {
  const patch = []
  const authorityPaths = new Set(options.authorityPaths ?? [])
  const pathMayBeIncluded = (path) => (
    authorityPaths.has(path)
    || [...authorityPaths].some((allowed) => path.startsWith(`${allowed}/`))
    || [...authorityPaths].some((allowed) => allowed.startsWith(`${path}/`))
  )
  const pathIsAllowedAuthority = (path) => (
    authorityPaths.has(path)
    || [...authorityPaths].some((allowed) => path.startsWith(`${allowed}/`))
  )
  const push = (operation) => {
    if (patch.length >= MAX_APPLICATION_MUTATION_PATCH_OPERATIONS) {
      throw new ApplicationMutationAckError(
        `Application acknowledgements support at most ${MAX_APPLICATION_MUTATION_PATCH_OPERATIONS} operations.`,
        'APPLICATION_MUTATION_ACK_TOO_LARGE',
      )
    }
    patch.push(operation)
  }
  const pushValue = async (op, path, value) => {
    const valueBytes = canonicalByteLength(canonicalJsonChunks(value), MAX_INLINE_PATCH_VALUE_BYTES)
    if (valueBytes > MAX_INLINE_PATCH_VALUE_BYTES) {
      throw new ApplicationMutationAckError(
        `The canonical acknowledgement value at "${path}" is too large.`,
        'APPLICATION_MUTATION_ACK_TOO_LARGE',
        path,
      )
    }
    push({
      op,
      path,
      value,
      valueHash: await canonicalValueDigestCooperatively(value),
    })
  }

  const excludedProjectionPatchField = (segments, key) => {
    if (segments.length === 0) return APPLICATION_SERVER_AUTHORITY_FIELDS.has(key)
    if (segments.length === 1 && segments[0] === 'school') {
      return SCHOOL_SERVER_AUTHORITY_FIELDS.has(key)
    }
    if (
      segments.length === 2
      && (segments[0] === 'materials' || segments[0] === 'tasks')
    ) return VAULT_REFERENCE_FIELDS.has(key)
    if (segments.length === 2 && segments[0] === 'communications') {
      return COMMUNICATION_SERVER_AUTHORITY_FIELDS.has(key)
    }
    return false
  }

  const writeValue = async (op, path, value, depth, segments, residentPath = path) => {
    if (depth > MAX_PATCH_DEPTH) {
      throw new ApplicationMutationAckError('The application acknowledgement value is too deeply nested.')
    }
    if (pathIsAllowedAuthority(residentPath) || (!Array.isArray(value) && !isRecord(value))) {
      await pushValue(op, path, value)
      return
    }
    if (Array.isArray(value)) {
      await pushValue(op, path, [])
      for (let index = 0; index < value.length; index += 1) {
        await writeValue(
          'add',
          appendPath(residentPath, '-'),
          value[index],
          depth + 1,
          [...segments, index],
          appendPath(residentPath, index),
        )
      }
      return
    }
    await pushValue(op, path, {})
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) continue
      const childSegments = [...segments, key]
      const childPath = appendPath(residentPath, key)
      if (excludedProjectionPatchField(segments, key) && !pathMayBeIncluded(childPath)) continue
      await writeValue('add', childPath, value[key], depth + 1, childSegments)
    }
  }

  const visit = async (before, after, path, depth, segments) => {
    if (Object.is(before, after)) return
    if (depth > MAX_PATCH_DEPTH) {
      throw new ApplicationMutationAckError('The application acknowledgement value is too deeply nested.')
    }
    if (Array.isArray(before) && Array.isArray(after)) {
      const beforeIds = stableArrayIds(before)
      const afterIds = stableArrayIds(after)
      if (beforeIds && afterIds) {
        const beforeById = new Map(beforeIds.map((id, index) => [id, before[index]]))
        const afterIdSet = new Set(afterIds)
        for (let index = beforeIds.length - 1; index >= 0; index -= 1) {
          if (!afterIdSet.has(beforeIds[index])) push({ op: 'remove', path: appendPath(path, index) })
        }
        const workingIds = beforeIds.filter((id) => afterIdSet.has(id))
        for (let afterIndex = 0; afterIndex < afterIds.length; afterIndex += 1) {
          const id = afterIds[afterIndex]
          if (beforeById.has(id)) continue
          const item = after[afterIndex]
          const residentIndex = workingIds.length
          await writeValue(
            'add',
            appendPath(path, '-'),
            item,
            depth + 1,
            [...segments, residentIndex],
            appendPath(path, residentIndex),
          )
          workingIds.push(id)
        }
        if (workingIds.some((id, index) => id !== afterIds[index])) {
          push({ op: 'reorder', path, ids: afterIds })
        }
        for (let index = 0; index < afterIds.length; index += 1) {
          const id = afterIds[index]
          if (beforeById.has(id)) {
            await visit(beforeById.get(id), after[index], appendPath(path, index), depth + 1, [...segments, index])
          }
        }
        return
      }
      const common = Math.min(before.length, after.length)
      for (let index = before.length - 1; index >= after.length; index -= 1) {
        push({ op: 'remove', path: appendPath(path, index) })
      }
      for (let index = 0; index < common; index += 1) {
        await visit(before[index], after[index], appendPath(path, index), depth + 1, [...segments, index])
      }
      for (let index = common; index < after.length; index += 1) {
        await writeValue(
          'add',
          appendPath(path, '-'),
          after[index],
          depth + 1,
          [...segments, index],
          appendPath(path, index),
        )
      }
      return
    }
    if (isRecord(before) && isRecord(after)) {
      const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
      for (const key of keys) {
        const beforeOwns = Object.hasOwn(before, key) && before[key] !== undefined
        const afterOwns = Object.hasOwn(after, key) && after[key] !== undefined
        const childPath = appendPath(path, key)
        // The client advances this single server version from ack.updatedAt;
        // it is never a mutable JSON-pointer target.
        if (segments.length === 0 && key === 'updatedAt') continue
        if (
          excludedProjectionPatchField(segments, key)
          && !pathMayBeIncluded(childPath)
        ) continue
        if (!afterOwns) {
          if (beforeOwns) push({ op: 'remove', path: childPath })
        } else if (!beforeOwns) {
          await writeValue('add', childPath, after[key], depth + 1, [...segments, key])
        } else {
          await visit(before[key], after[key], childPath, depth + 1, [...segments, key])
        }
      }
      return
    }
    await writeValue('set', path, after, depth + 1, segments)
  }

  await visit(
    isRecord(baseline) ? baseline : {},
    isRecord(application) ? application : {},
    '',
    0,
    [],
  )
  return patch
}

export function applicationMutationAckCommitment(ack) {
  return {
    protocol: APPLICATION_MUTATION_ACK_PROTOCOL,
    projectionVersion: ack.projectionVersion,
    id: ack.id,
    baseUpdatedAt: ack.baseUpdatedAt ?? null,
    updatedAt: ack.updatedAt,
    operationCount: ack.operationCount,
    mutationHash: ack.mutationHash,
    baselineHash: ack.baselineHash,
    applicationHash: ack.applicationHash,
    authorityPurpose: ack.authorityPurpose,
    authorityProjectionVersion: ack.authorityProjectionVersion,
    authorityHash: ack.authorityHash,
    patch: ack.patch,
  }
}

/**
 * Build this acknowledgement before the durable write. Post-commit work may
 * compare the stored small-row authored hash, but must never grow the response.
 */
export async function createApplicationMutationAck({
  baseline,
  application,
  baseUpdatedAt = null,
  operationCount = 0,
  mutation = null,
  mutationHash = null,
  patchMode = 'authored',
  authorityPurpose = 'none',
}) {
  if (!application?.id || !application?.updatedAt) {
    throw new ApplicationMutationAckError('A canonical application id and version are required.')
  }
  if (!Number.isSafeInteger(operationCount) || operationCount < 0) {
    throw new ApplicationMutationAckError('The application mutation operation count is invalid.')
  }
  if (mutationHash !== null && !/^[A-Za-z0-9_-]{43}$/u.test(mutationHash)) {
    throw new ApplicationMutationAckError('The application mutation hash is invalid.')
  }
  if (!Object.hasOwn(APPLICATION_MUTATION_AUTHORITY_PATHS, authorityPurpose)) {
    throw new ApplicationMutationAckError('The application acknowledgement authority purpose is invalid.')
  }
  const expectedPatchMode = authorityPurpose === 'create' ? 'full' : 'authored'
  if (patchMode !== expectedPatchMode) {
    throw new ApplicationMutationAckError('The application acknowledgement purpose does not match its patch mode.')
  }
  const safeBaseline = isRecord(baseline) ? baseline : {}
  const acknowledgement = {
    protocol: APPLICATION_MUTATION_ACK_PROTOCOL,
    projectionVersion: APPLICATION_AUTHORED_PROJECTION_VERSION,
    id: application.id,
    baseUpdatedAt: baseUpdatedAt || null,
    updatedAt: application.updatedAt,
    operationCount,
    mutationHash: mutationHash ?? await canonicalValueDigestCooperatively(mutation),
    baselineHash: await canonicalApplicationProjectionDigestCooperatively(safeBaseline),
    applicationHash: await canonicalApplicationProjectionDigestCooperatively(application),
    authorityPurpose,
    authorityProjectionVersion: APPLICATION_AUTHORITY_PROJECTION_VERSION,
    authorityHash: await canonicalApplicationAuthorityDigestCooperatively(
      application,
      authorityPurpose,
    ),
    patch: await createCanonicalPatch(safeBaseline, application, {
      authorityPaths: APPLICATION_MUTATION_AUTHORITY_PATHS[authorityPurpose],
    }),
  }
  const canonicalHash = await canonicalValueDigestCooperatively(applicationMutationAckCommitment(acknowledgement))
  const result = {
    ...acknowledgement,
    canonicalHash,
    durable: true,
  }
  const responseBytes = canonicalByteLength(canonicalJsonChunks(result), MAX_APPLICATION_MUTATION_ACK_BYTES)
  if (responseBytes > MAX_APPLICATION_MUTATION_ACK_BYTES) {
    throw new ApplicationMutationAckError(
      'The canonical application acknowledgement exceeds the bounded response budget.',
      'APPLICATION_MUTATION_ACK_TOO_LARGE',
    )
  }
  return result
}

export function canonicalDigestsEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}
