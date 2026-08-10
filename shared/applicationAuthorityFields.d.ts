export type ApplicationAuthoredProjectionVersion = 2

export const APPLICATION_AUTHORED_PROJECTION_VERSION: 2

export const APPLICATION_SERVER_AUTHORITY_FIELDS: ReadonlySet<string>
export const VAULT_REFERENCE_FIELDS: ReadonlySet<string>
export const COMMUNICATION_SERVER_AUTHORITY_FIELDS: ReadonlySet<string>
export const SCHOOL_SERVER_AUTHORITY_FIELDS: ReadonlySet<string>

export function isApplicationServerAuthorityPath(
  segments: readonly (string | number)[],
): boolean
