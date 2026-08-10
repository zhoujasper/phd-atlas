import type { ApplicationRecord } from './data/applications'

/**
 * Every application write — including the editor's own autosave — fans back out
 * as a realtime `applications` invalidation, and the handler answers it by
 * re-reading the whole list. Handing React a brand new array of brand new
 * objects on that echo re-rendered the open record for no reason, which closed
 * anchored popovers and dropped in-flight typing.
 *
 * `updatedAt` is the server's revision marker for a record, so a matching pair
 * means the fetched copy carries nothing new. Those keep their previous object
 * identity, and a list where nothing changed keeps its previous array identity,
 * so the refresh becomes a genuine no-op instead of a full re-render.
 *
 * Comparison is deliberately O(1) per record: applications routinely carry
 * megabytes of checklist and correspondence data, so deep-equality on every
 * stream tick would cost more than the render it avoids.
 */
export function mergeApplicationListPreservingIdentity(
  previous: ApplicationRecord[],
  next: readonly ApplicationRecord[],
): ApplicationRecord[] {
  const previousById = new Map(previous.map((item) => [item.id, item]))
  let changed = previous.length !== next.length

  const merged = next.map((item, index) => {
    const existing = previousById.get(item.id)
    const unchanged = Boolean(
      existing
      && existing.updatedAt
      && item.updatedAt
      && existing.updatedAt === item.updatedAt,
    )
    if (!unchanged) {
      changed = true
      return item
    }
    // Same content, different position still reorders the list.
    if (previous[index] !== existing) changed = true
    return existing as ApplicationRecord
  })

  return changed ? merged : previous
}
