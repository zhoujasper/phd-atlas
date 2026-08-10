export function canonicalJsonChunks(value: unknown): Generator<string, void, unknown>
export function canonicalApplicationProjectionChunks(
  application: unknown,
): Generator<string, void, unknown>
export const canonicalApplicationAuthorityFields: Readonly<{
  application: readonly string[]
  vault: readonly string[]
  communication: readonly string[]
  school: readonly string[]
}>
