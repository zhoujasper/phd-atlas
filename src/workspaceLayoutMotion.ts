export type WorkspacePane = 'applications' | 'inspector'

const workspacePaneHiddenClass: Record<WorkspacePane, string> = {
  applications: 'hide-application-pane',
  inspector: 'hide-inspector-pane',
}

/**
 * Starts the visible pane transition synchronously, before the durable React
 * layout preference finishes reconciling through the large application tree.
 */
export function toggleWorkspacePaneClass(
  shell: HTMLElement | null,
  pane: WorkspacePane,
): boolean | null {
  if (!shell) return null
  return shell.classList.toggle(workspacePaneHiddenClass[pane])
}
