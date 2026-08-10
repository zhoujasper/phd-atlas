import type { ApplicationRecord } from './data/applications'
import { canonicalJsonChunks } from '../shared/applicationCanonical.js'
import { isApplicationServerAuthorityPath } from '../shared/applicationAuthorityFields.js'
import {
  APPLICATION_AUTHORED_PROJECTION_VERSION as SHARED_APPLICATION_AUTHORED_PROJECTION_VERSION,
  APPLICATION_AUTHORITY_PROJECTION_VERSION as SHARED_APPLICATION_AUTHORITY_PROJECTION_VERSION,
  APPLICATION_MUTATION_AUTHORITY_PATHS,
  APPLICATION_MUTATION_MAX_PATCH_OPERATIONS,
  canonicalApplicationAuthorityReceiptChunks,
  canonicalApplicationUserEditableChunks,
} from '../shared/applicationPersistenceProtocol.js'
import { sha256Base64UrlChunksCooperatively } from './api/incrementalSha256'

export const APPLICATION_MUTATION_ACK_PROTOCOL = 'phd-atlas-application-mutation-ack-v2' as const
export const APPLICATION_AUTHORED_PROJECTION_VERSION = SHARED_APPLICATION_AUTHORED_PROJECTION_VERSION
export const APPLICATION_AUTHORITY_PROJECTION_VERSION = SHARED_APPLICATION_AUTHORITY_PROJECTION_VERSION

export type ApplicationMutationPatchOperation =
  | { op: 'set' | 'add'; path: string; value: unknown; valueHash: string }
  | { op: 'remove'; path: string }
  | { op: 'reorder'; path: string; ids: string[] }

export type ApplicationMutationAcknowledgement = {
  protocol: typeof APPLICATION_MUTATION_ACK_PROTOCOL
  projectionVersion: typeof APPLICATION_AUTHORED_PROJECTION_VERSION
  id: string
  updatedAt: string
  baseUpdatedAt: string | null
  operationCount: number
  mutationHash: string
  baselineHash: string
  applicationHash: string
  authorityPurpose: 'none' | ApplicationMutationAuthorityPolicy
  authorityProjectionVersion: typeof APPLICATION_AUTHORITY_PROJECTION_VERSION
  authorityHash: string
  patch: ApplicationMutationPatchOperation[]
  canonicalHash: string
  durable: boolean
}

export type AcknowledgedApplicationMutation =
  | {
      unchanged: false
      application: ApplicationRecord
      acknowledgement: ApplicationMutationAcknowledgement
    }
  | {
      unchanged: true
      application: ApplicationRecord
      acknowledgement: null
    }

export type ApplicationMutationAuthorityPurpose = keyof typeof APPLICATION_MUTATION_AUTHORITY_PATHS
export type ApplicationMutationAuthorityPolicy = Exclude<ApplicationMutationAuthorityPurpose, 'none'>

const MAX_PATCH_OPERATIONS = APPLICATION_MUTATION_MAX_PATCH_OPERATIONS
const MAX_POINTER_DEPTH = 64
const MAX_POINTER_LENGTH = 2_048
const MAX_REORDER_ITEMS = 10_000
const forbiddenSegments = new Set(['__proto__', 'prototype', 'constructor'])

export class ApplicationMutationAcknowledgementError extends Error {
  readonly code = 'REQUEST_FAILED'

  constructor(message = 'The server did not provide a verifiable durable application acknowledgement.') {
    super(message)
    this.name = 'ApplicationMutationAcknowledgementError'
  }
}

function invalid(message?: string): never {
  throw new ApplicationMutationAcknowledgementError(message)
}

function digestLooksValid(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(value)
}

function authorityOperationAllowed(
  policy: ApplicationMutationAuthorityPolicy | undefined,
  segments: string[],
  operation: ApplicationMutationPatchOperation,
) {
  if (!policy || !Object.hasOwn(APPLICATION_MUTATION_AUTHORITY_PATHS, policy)) return false
  const allowedPath = APPLICATION_MUTATION_AUTHORITY_PATHS[policy].find((path) => {
    const allowedSegments = path.slice(1).split('/')
    return allowedSegments.every((segment, index) => segments[index] === segment)
  })
  if (!allowedPath) return false
  const allowedDepth = allowedPath.slice(1).split('/').length
  if (policy === 'create') return operation.op === 'add'
  if (policy === 'trash-restore') return segments.length === allowedDepth && operation.op === 'remove'
  return true
}

function decodePointer(
  path: unknown,
  operation: ApplicationMutationPatchOperation,
  authorityPolicy?: ApplicationMutationAuthorityPolicy,
) {
  if (
    typeof path !== 'string'
    || path.length === 0
    || path.length > MAX_POINTER_LENGTH
    || !path.startsWith('/')
  ) invalid('The application acknowledgement contains an invalid path.')
  const segments = path.slice(1).split('/').map((segment) => {
    if (/~(?:[^01]|$)/u.test(segment)) invalid('The application acknowledgement path has invalid escaping.')
    const decoded = segment.replaceAll('~1', '/').replaceAll('~0', '~')
    if (!decoded || forbiddenSegments.has(decoded)) {
      invalid('The application acknowledgement contains an unsafe path.')
    }
    return decoded
  })
  const isAllowedAuthorityOperation = authorityOperationAllowed(authorityPolicy, segments, operation)
  if (
    segments.length > MAX_POINTER_DEPTH
    || (isApplicationServerAuthorityPath(segments) && !isAllowedAuthorityOperation)
  ) {
    invalid('The application acknowledgement tried to replace server-owned state.')
  }
  return segments
}

function arrayIndex(segment: string, length: number, allowEnd = false) {
  if (allowEnd && segment === '-') return length
  if (!/^(0|[1-9]\d*)$/u.test(segment)) invalid('The application acknowledgement has an invalid array index.')
  const index = Number(segment)
  const maximum = allowEnd ? length : length - 1
  if (!Number.isSafeInteger(index) || index < 0 || index > maximum) {
    invalid('The application acknowledgement has an out-of-range array index.')
  }
  return index
}

function patchAtPath(
  node: unknown,
  segments: string[],
  operation: Exclude<ApplicationMutationPatchOperation, { op: 'reorder' }>,
  depth = 0,
): unknown {
  if (!node || typeof node !== 'object') invalid('The application acknowledgement path does not exist.')
  const segment = segments[depth]
  const final = depth === segments.length - 1
  if (Array.isArray(node)) {
    const copy = node.slice()
    if (final) {
      const index = arrayIndex(segment, copy.length, operation.op === 'add')
      if (operation.op === 'add') copy.splice(index, 0, operation.value)
      else if (operation.op === 'remove') copy.splice(index, 1)
      else copy[index] = operation.value
      return copy
    }
    const index = arrayIndex(segment, copy.length)
    copy[index] = patchAtPath(copy[index], segments, operation, depth + 1)
    return copy
  }

  const record = node as Record<string, unknown>
  const copy = { ...record }
  if (final) {
    const exists = Object.hasOwn(record, segment)
    if (operation.op !== 'add' && !exists) invalid('The application acknowledgement path does not exist.')
    if (operation.op === 'remove') delete copy[segment]
    else copy[segment] = operation.value
    return copy
  }
  if (!Object.hasOwn(record, segment)) invalid('The application acknowledgement path does not exist.')
  copy[segment] = patchAtPath(record[segment], segments, operation, depth + 1)
  return copy
}

function reorderAtPath(node: unknown, segments: string[], ids: string[], depth = 0): unknown {
  if (!node || typeof node !== 'object') invalid('The application acknowledgement reorder path does not exist.')
  if (depth === segments.length) {
    if (!Array.isArray(node)) invalid('Only application arrays can be reordered.')
    if (ids.length > MAX_REORDER_ITEMS || new Set(ids).size !== ids.length) {
      invalid('The application acknowledgement contains an invalid reorder.')
    }
    const byId = new Map<string, unknown>()
    for (const item of node) {
      const id = String((item as { id?: unknown } | null)?.id ?? '')
      if (!id || byId.has(id)) invalid('Reordered application items require unique ids.')
      byId.set(id, item)
    }
    if (byId.size !== ids.length) invalid('The application acknowledgement reorder is incomplete.')
    return ids.map((id) => {
      if (!byId.has(id)) invalid('The application acknowledgement reorder contains an unknown id.')
      return byId.get(id)
    })
  }
  const segment = segments[depth]
  if (Array.isArray(node)) {
    const copy = node.slice()
    const index = arrayIndex(segment, copy.length)
    copy[index] = reorderAtPath(copy[index], segments, ids, depth + 1)
    return copy
  }
  const record = node as Record<string, unknown>
  if (!Object.hasOwn(record, segment)) invalid('The application acknowledgement reorder path does not exist.')
  return { ...record, [segment]: reorderAtPath(record[segment], segments, ids, depth + 1) }
}

export function applicationMutationAckCommitment(
  acknowledgement: Pick<
    ApplicationMutationAcknowledgement,
    | 'projectionVersion'
    | 'id'
    | 'baseUpdatedAt'
    | 'updatedAt'
    | 'operationCount'
    | 'mutationHash'
    | 'baselineHash'
    | 'applicationHash'
    | 'authorityPurpose'
    | 'authorityProjectionVersion'
    | 'authorityHash'
    | 'patch'
  >,
) {
  return {
    protocol: APPLICATION_MUTATION_ACK_PROTOCOL,
    projectionVersion: acknowledgement.projectionVersion,
    id: acknowledgement.id,
    baseUpdatedAt: acknowledgement.baseUpdatedAt ?? null,
    updatedAt: acknowledgement.updatedAt,
    operationCount: acknowledgement.operationCount,
    mutationHash: acknowledgement.mutationHash,
    baselineHash: acknowledgement.baselineHash,
    applicationHash: acknowledgement.applicationHash,
    authorityPurpose: acknowledgement.authorityPurpose,
    authorityProjectionVersion: acknowledgement.authorityProjectionVersion,
    authorityHash: acknowledgement.authorityHash,
    patch: acknowledgement.patch,
  }
}

export function applicationAuthoredContentHash(application: unknown) {
  return sha256Base64UrlChunksCooperatively(canonicalApplicationUserEditableChunks(application))
}

export function applicationAuthorityContentHash(
  application: unknown,
  purpose: ApplicationMutationAuthorityPurpose = 'none',
) {
  return sha256Base64UrlChunksCooperatively(
    canonicalApplicationAuthorityReceiptChunks(application, purpose),
  )
}

export async function canonicalValueHash(value: unknown) {
  return sha256Base64UrlChunksCooperatively(canonicalJsonChunks(value))
}

/**
 * Verifies the compact receipt and reconstructs only server-proven canonical
 * authored differences. The caller must still compare its submitted authored
 * expectation with the returned application before painting saved state.
 */
export async function applyApplicationMutationAcknowledgement(
  acknowledgement: ApplicationMutationAcknowledgement,
  submitted: ApplicationRecord | Record<string, unknown>,
  expected: {
    baseUpdatedAt: string | null
    operationCount: number
    mutationHash: string
    authorityPurpose?: ApplicationMutationAuthorityPolicy
  },
): Promise<ApplicationRecord> {
  const isCreate = expected.baseUpdatedAt === null
    && expected.authorityPurpose === 'create'
    && !Object.hasOwn(submitted, 'id')
  if ((expected.authorityPurpose === 'create') !== isCreate) invalid()
  const expectedAuthorityPurpose = expected.authorityPurpose ?? 'none'
  if (
    !acknowledgement
    || acknowledgement.protocol !== APPLICATION_MUTATION_ACK_PROTOCOL
    || acknowledgement.projectionVersion !== APPLICATION_AUTHORED_PROJECTION_VERSION
    || acknowledgement.durable !== true
    || (!isCreate && acknowledgement.id !== submitted.id)
    || acknowledgement.baseUpdatedAt !== expected.baseUpdatedAt
    || acknowledgement.operationCount !== expected.operationCount
    || acknowledgement.mutationHash !== expected.mutationHash
    || !Object.hasOwn(APPLICATION_MUTATION_AUTHORITY_PATHS, acknowledgement.authorityPurpose)
    || acknowledgement.authorityPurpose !== expectedAuthorityPurpose
    || acknowledgement.authorityProjectionVersion !== APPLICATION_AUTHORITY_PROJECTION_VERSION
    || !Number.isSafeInteger(acknowledgement.operationCount)
    || acknowledgement.operationCount < 0
    || typeof acknowledgement.updatedAt !== 'string'
    || !acknowledgement.updatedAt
    || !digestLooksValid(acknowledgement.baselineHash)
    || !digestLooksValid(acknowledgement.mutationHash)
    || !digestLooksValid(acknowledgement.applicationHash)
    || !digestLooksValid(acknowledgement.authorityHash)
    || !digestLooksValid(acknowledgement.canonicalHash)
    || !Array.isArray(acknowledgement.patch)
    || acknowledgement.patch.length > MAX_PATCH_OPERATIONS
  ) invalid()

  if (
    acknowledgement.updatedAt === expected.baseUpdatedAt
    && (
      acknowledgement.patch.length !== 0
      || acknowledgement.applicationHash !== acknowledgement.baselineHash
    )
  ) invalid('An unchanged application acknowledgement cannot contain durable differences.')

  if (await applicationAuthoredContentHash(submitted) !== acknowledgement.baselineHash) {
    invalid('The saved application acknowledgement belongs to a different submitted draft.')
  }
  if (
    await canonicalValueHash(applicationMutationAckCommitment(acknowledgement))
    !== acknowledgement.canonicalHash
  ) invalid('The saved application acknowledgement commitment is invalid.')

  let result: unknown = submitted
  const seenPaths = new Set<string>()
  for (const operation of acknowledgement.patch) {
    if (!operation || typeof operation !== 'object' || typeof operation.op !== 'string') invalid()
    const segments = decodePointer(operation.path, operation, expected.authorityPurpose)
    if (seenPaths.has(operation.path) && !(operation.op === 'add' && operation.path.endsWith('/-'))) {
      invalid('The application acknowledgement repeats a path.')
    }
    seenPaths.add(operation.path)
    if (operation.op === 'reorder') {
      if (!Array.isArray(operation.ids) || operation.ids.some((id) => typeof id !== 'string' || !id)) invalid()
      result = reorderAtPath(result, segments, operation.ids)
      continue
    }
    if (!['set', 'add', 'remove'].includes(operation.op)) invalid()
    if (operation.op !== 'remove') {
      if (!Object.hasOwn(operation, 'value') || !digestLooksValid(operation.valueHash)) invalid()
      if (await canonicalValueHash(operation.value) !== operation.valueHash) invalid()
    }
    result = patchAtPath(
      result,
      segments,
      operation as Exclude<ApplicationMutationPatchOperation, { op: 'reorder' }>,
    )
  }

  if (!result || typeof result !== 'object' || Array.isArray(result)) invalid()
  const canonical = {
    ...(result as ApplicationRecord),
    updatedAt: acknowledgement.updatedAt,
  }
  if (canonical.id !== acknowledgement.id) invalid()
  if (await applicationAuthoredContentHash(canonical) !== acknowledgement.applicationHash) {
    invalid('The saved application acknowledgement does not match the durable authored content.')
  }
  if (
    await applicationAuthorityContentHash(canonical, expectedAuthorityPurpose)
    !== acknowledgement.authorityHash
  ) {
    invalid('The saved application acknowledgement does not match durable server-owned state.')
  }
  return canonical
}
