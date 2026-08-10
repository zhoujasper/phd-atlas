export const APPLICATION_MUTATION_ACK_PROTOCOL: 'phd-atlas-application-mutation-ack-v2'
export const MAX_APPLICATION_MUTATION_ACK_BYTES: 524288
export const MAX_APPLICATION_MUTATION_PATCH_OPERATIONS: 2048

export type ApplicationMutationAuthorityPurpose =
  keyof typeof import('../shared/applicationPersistenceProtocol.js').APPLICATION_MUTATION_AUTHORITY_PATHS

export type ApplicationMutationAckErrorCode =
  | 'APPLICATION_MUTATION_ACK_INVALID'
  | 'APPLICATION_MUTATION_ACK_TOO_LARGE'

export type ApplicationMutationPatchOperation =
  | {
      op: 'set' | 'add'
      path: string
      value: unknown
      valueHash: string
    }
  | {
      op: 'remove'
      path: string
    }
  | {
      op: 'reorder'
      path: string
      ids: string[]
    }

export interface ApplicationMutationAcknowledgementCommitment {
  protocol: typeof APPLICATION_MUTATION_ACK_PROTOCOL
  projectionVersion: 2
  id: string
  baseUpdatedAt: string | null
  updatedAt: string
  operationCount: number
  mutationHash: string
  baselineHash: string
  applicationHash: string
  authorityPurpose: ApplicationMutationAuthorityPurpose
  authorityProjectionVersion: 1
  authorityHash: string
  patch: ApplicationMutationPatchOperation[]
}

export interface ApplicationMutationAcknowledgement
  extends ApplicationMutationAcknowledgementCommitment {
  canonicalHash: string
  durable: true
}

export class ApplicationMutationAckError extends Error {
  constructor(message: string, code?: ApplicationMutationAckErrorCode, field?: string)

  name: 'ApplicationMutationAckError'
  code: ApplicationMutationAckErrorCode
  status: 409 | 413
  field: string | undefined
}

export function canonicalValueDigest(value: unknown): string

export function canonicalValueDigestCooperatively(value: unknown): Promise<string>

export function canonicalApplicationProjectionDigest(
  application: unknown,
): string

export function canonicalApplicationProjectionDigestCooperatively(
  application: unknown,
): Promise<string>

export function canonicalApplicationAuthorityDigest(
  application: unknown,
  authorityPurpose?: ApplicationMutationAuthorityPurpose,
): string

export function canonicalApplicationAuthorityDigestCooperatively(
  application: unknown,
  authorityPurpose?: ApplicationMutationAuthorityPurpose,
): Promise<string>

export function applicationMutationAckCommitment(
  acknowledgement: Omit<
    ApplicationMutationAcknowledgementCommitment,
    'protocol'
  > & { protocol?: typeof APPLICATION_MUTATION_ACK_PROTOCOL },
): ApplicationMutationAcknowledgementCommitment

interface CreateApplicationMutationAckCommonOptions {
  baseline?: unknown
  application: {
    id: string
    updatedAt: string
  }
  baseUpdatedAt?: string | null
  operationCount?: number
  mutation?: unknown
  mutationHash?: string | null
}

export type CreateApplicationMutationAckOptions =
  | (CreateApplicationMutationAckCommonOptions & {
      authorityPurpose: 'create'
      patchMode: 'full'
    })
  | (CreateApplicationMutationAckCommonOptions & {
      authorityPurpose?: Exclude<ApplicationMutationAuthorityPurpose, 'create'>
      patchMode?: 'authored'
    })

export function createApplicationMutationAck(
  options: CreateApplicationMutationAckOptions,
): Promise<ApplicationMutationAcknowledgement>

export function canonicalDigestsEqual(left: unknown, right: unknown): boolean
