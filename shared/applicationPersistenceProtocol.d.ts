export const APPLICATION_AUTHORED_PROJECTION_VERSION: 2
export const APPLICATION_AUTHORITY_PROJECTION_VERSION: 1
export const APPLICATION_MUTATION_MAX_PATCH_OPERATIONS: 2048
export const APPLICATION_MUTATION_AUTHORITY_PATHS: Readonly<{
  none: readonly []
  create: readonly ['/createdAt', '/id', '/ownerId', '/teamId', '/teamTransferRequest']
  'school-logo': readonly ['/school/logo']
  'team-transfer': readonly ['/teamId', '/teamTransferRequest']
  'trash-restore': readonly ['/deletedAt']
}>

export function applicationCreateAcknowledgementCandidate(input: unknown): Record<string, unknown>

export function applicationUserEditablePersistenceProjection(
  application: unknown,
): Record<string, unknown>

export function canonicalApplicationUserEditableJson(
  application: unknown,
): string

export function canonicalApplicationUserEditableChunks(
  application: unknown,
): Generator<string>

export function canonicalApplicationAuthorityReceiptChunks(
  application: unknown,
  authorityPurpose?: keyof typeof APPLICATION_MUTATION_AUTHORITY_PATHS,
): Generator<string>
