import type { ApplicationRecord } from './data/applications'
import { isApplicationServerAuthorityPath } from '../shared/applicationAuthorityFields.js'

export type ApplicationDeltaOperation =
  | { op: 'add' | 'replace'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'reorder'; path: string; ids: string[] }

export type ApplicationDelta = {
  baseUpdatedAt: string
  operations: ApplicationDeltaOperation[]
}

const MAX_APPLICATION_DELTA_OPERATIONS = 2_048
export class ApplicationDeltaTooLargeError extends Error {
  readonly code = 'APPLICATION_DELTA_TOO_LARGE'

  constructor() {
    super('This application has too many simultaneous changes to save safely. Save smaller groups of changes and retry.')
    this.name = 'ApplicationDeltaTooLargeError'
  }
}

const pointerSegment = (value: string) => value.replaceAll('~', '~0').replaceAll('/', '~1')

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function stableIds(value: unknown[]): string[] | null {
  const ids: string[] = []
  const unique = new Set<string>()
  for (const item of value) {
    if (!isPlainObject(item) || typeof item.id !== 'string' || !item.id) return null
    if (unique.has(item.id)) return null
    unique.add(item.id)
    ids.push(item.id)
  }
  return ids
}

export function buildApplicationDelta(
  base: ApplicationRecord,
  next: ApplicationRecord,
): ApplicationDelta {
  if (!base.updatedAt || base.id !== next.id) {
    throw new Error('An application delta requires the matching saved application version.')
  }

  const operations: ApplicationDeltaOperation[] = []
  const push = (operation: ApplicationDeltaOperation) => {
    if (operations.length >= MAX_APPLICATION_DELTA_OPERATIONS) {
      throw new ApplicationDeltaTooLargeError()
    }
    operations.push(operation)
  }

  const visit = (
    before: unknown,
    after: unknown,
    path: string,
    depth: number,
    segments: Array<string | number>,
  ) => {
    if (Object.is(before, after)) return
    if (depth > 64) {
      push({ op: 'replace', path, value: after })
      return
    }

    if (Array.isArray(before) && Array.isArray(after)) {
      if (
        before.length === after.length
        && before.every((value, index) => (
          (value === null || typeof value !== 'object')
          && Object.is(value, after[index])
        ))
      ) return
      const beforeIds = stableIds(before)
      const afterIds = stableIds(after)
      if (beforeIds && afterIds && (before.length > 0 || after.length > 0)) {
        const beforeById = new Map(beforeIds.map((id, index) => [id, { index, value: before[index] }]))
        const afterById = new Map(afterIds.map((id, index) => [id, { index, value: after[index] }]))

        for (const id of beforeIds) {
          const original = beforeById.get(id)
          const current = afterById.get(id)
          if (original && current) {
            visit(
              original.value,
              current.value,
              `${path}/${original.index}`,
              depth + 1,
              [...segments, original.index],
            )
          }
        }

        const removedIndexes = beforeIds
          .map((id, index) => ({ id, index }))
          .filter(({ id }) => !afterById.has(id))
          .map(({ index }) => index)
          .sort((left, right) => right - left)
        for (const index of removedIndexes) push({ op: 'remove', path: `${path}/${index}` })

        const appendedIds: string[] = []
        for (const id of afterIds) {
          if (beforeById.has(id)) continue
          push({ op: 'add', path: `${path}/-`, value: afterById.get(id)!.value })
          appendedIds.push(id)
        }

        const survivingIds = beforeIds.filter((id) => afterById.has(id))
        const workingIds = [...survivingIds, ...appendedIds]
        if (workingIds.some((id, index) => id !== afterIds[index])) {
          push({ op: 'reorder', path, ids: afterIds })
        }
        return
      }
      push({ op: 'replace', path, value: after })
      return
    }

    if (isPlainObject(before) && isPlainObject(after)) {
      const keys = new Set([...Object.keys(before), ...Object.keys(after)])
      for (const key of [...keys].sort()) {
        if (isApplicationServerAuthorityPath([...segments, key])) continue
        const childPath = `${path}/${pointerSegment(key)}`
        const beforeOwns = Object.hasOwn(before, key)
        const afterOwns = Object.hasOwn(after, key) && after[key] !== undefined
        if (!afterOwns) {
          if (beforeOwns) push({ op: 'remove', path: childPath })
          continue
        }
        if (!beforeOwns) {
          push({ op: 'add', path: childPath, value: after[key] })
          continue
        }
        visit(before[key], after[key], childPath, depth + 1, [...segments, key])
      }
      return
    }

    push({ op: 'replace', path, value: after })
  }

  visit(base, next, '', 0, [])
  return {
    baseUpdatedAt: base.updatedAt,
    operations,
  }
}
