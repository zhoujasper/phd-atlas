import type { ApplicationTrashItem, ApplicationTrashScope } from './api/phdApi'

/**
 * The server stores recycle-bin entries under the account that performed the
 * deletion. This second boundary keeps personal and Team surfaces separate in
 * the client: a Team deletion never leaks into the personal recycle-bin dock,
 * and switching organizations never shows another organization's entries.
 */
export function applicationTrashForScope(
  items: ApplicationTrashItem[],
  scope: ApplicationTrashScope,
): ApplicationTrashItem[] {
  if (scope.kind === 'personal') {
    return items.filter((item) => !item.application.teamId)
  }
  if (!scope.teamId) return []
  return items.filter((item) => item.application.teamId === scope.teamId)
}
