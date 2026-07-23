import { describe, expect, it } from 'vitest'
import { toggleWorkspacePaneClass } from './workspaceLayoutMotion'

describe('workspace layout motion', () => {
  it('updates the visible pane class synchronously on each toggle', () => {
    const shell = document.createElement('div')

    expect(toggleWorkspacePaneClass(shell, 'inspector')).toBe(true)
    expect(shell.classList.contains('hide-inspector-pane')).toBe(true)

    expect(toggleWorkspacePaneClass(shell, 'inspector')).toBe(false)
    expect(shell.classList.contains('hide-inspector-pane')).toBe(false)
  })

  it('leaves the durable state updater in control when the shell is unavailable', () => {
    expect(toggleWorkspacePaneClass(null, 'applications')).toBeNull()
  })
})
