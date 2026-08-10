export const MAX_APPLICATION_AUDIT_CHANGED_FIELDS = 64
const MAX_APPLICATION_AUDIT_FIELD_LENGTH = 240

/**
 * Keep mutation audit events useful without turning every save into a second
 * application-history store. Durable application/version data owns the full
 * record; the system event owns identity and a bounded change summary only.
 */
export function compactApplicationAuditMetadata(metadata = {}) {
  const {
    beforeApplication: _beforeApplication,
    afterApplication: _afterApplication,
    changedFields,
    ...identity
  } = metadata && typeof metadata === 'object' ? metadata : {}

  if (!Array.isArray(changedFields)) return identity

  const compactFields = []
  const seen = new Set()
  for (const field of changedFields) {
    const normalized = String(field ?? '').trim().slice(0, MAX_APPLICATION_AUDIT_FIELD_LENGTH)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    if (compactFields.length < MAX_APPLICATION_AUDIT_CHANGED_FIELDS) compactFields.push(normalized)
  }
  return {
    ...identity,
    changedFields: compactFields,
    changedFieldCount: seen.size,
  }
}
