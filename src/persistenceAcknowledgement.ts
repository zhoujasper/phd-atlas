import type { ApplicationRecord } from './data/applications'
import { applicationUserEditablePersistenceProjection as sharedApplicationUserEditablePersistenceProjection } from '../shared/applicationPersistenceProtocol.js'

/**
 * Returns true when every user-authored value in `expected` is present in the
 * canonical response. Server-owned fields may be added, while an omitted
 * client field (for example when an older backend silently strips a new
 * schema property) is treated as a failed persistence acknowledgement.
 */
export function persistedSubsetMatches(expected: unknown, actual: unknown): boolean {
  if (expected === undefined) return true
  if (expected === null || typeof expected !== 'object') return Object.is(expected, actual)

  if (Array.isArray(expected)) {
    return Array.isArray(actual)
      && expected.length === actual.length
      && expected.every((item, index) => persistedSubsetMatches(item, actual[index]))
  }

  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false
  const actualRecord = actual as Record<string, unknown>
  return Object.entries(expected as Record<string, unknown>).every(([key, value]) => (
    value === undefined || persistedSubsetMatches(value, actualRecord[key])
  ))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function persistedValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => persistedValuesEqual(item, right[index]))
  }
  if (!isRecord(left) || !isRecord(right)) return false
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  return [...keys].every((key) => persistedValuesEqual(left[key], right[key]))
}

/**
 * Selects application fields whose values are authored by the application
 * editor. Capability handles, storage-vault references, delivery state and
 * timestamps are deliberately excluded because the server owns them and may
 * advance them while an application save is in flight.
 */
export function applicationUserEditablePersistenceProjection(application: ApplicationRecord) {
  return sharedApplicationUserEditablePersistenceProjection(application)
}

/**
 * Builds a top-level field mask from the editor baseline. Unchanged fields do
 * not make an otherwise valid save fail when a concurrent server workflow
 * legitimately updates them, while every changed user field remains required.
 */
export function applicationPersistenceExpectation(
  submitted: ApplicationRecord,
  baseline?: ApplicationRecord | null,
) {
  const submittedProjection = applicationUserEditablePersistenceProjection(submitted)
  const baselineProjection = baseline
    ? applicationUserEditablePersistenceProjection(baseline)
    : null
  const expectation: Record<string, unknown> = { id: submitted.id }
  for (const [key, value] of Object.entries(submittedProjection)) {
    if (key === 'id') continue
    if (!baselineProjection || !persistedValuesEqual(value, baselineProjection[key])) {
      expectation[key] = value
    }
  }
  return expectation
}

export function applicationPersistenceAcknowledged(
  submitted: ApplicationRecord,
  canonical: ApplicationRecord,
  baseline?: ApplicationRecord | null,
) {
  const expectation = applicationPersistenceExpectation(submitted, baseline)
  const actual = applicationUserEditablePersistenceProjection(canonical)
  return Object.entries(expectation).every(([key, expected]) => (
    Object.prototype.hasOwnProperty.call(actual, key)
    && persistedSubsetMatches(expected, actual[key])
  ))
}
