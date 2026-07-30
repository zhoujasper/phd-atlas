import { describe, expect, it } from 'vitest'
import appSource from '../../App.tsx?raw'
import appStyles from '../../index.css?raw'

const styles = appStyles.replace(/\r\n/g, '\n')

function cssRule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = styles.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))
  expect(match, `Missing CSS rule: ${selector}`).not.toBeNull()
  return match?.[1] ?? ''
}

describe('dashboard and dossier switch motion CSS', () => {
  it('animates the expired checklist as one clipped surface', () => {
    const shell = cssRule('.stat-task-expired-shell')
    const clip = cssRule('.stat-task-expired-clip')
    const emptyShell = cssRule('.dashboard-task-empty-shell')

    expect(shell).toContain('grid-template-rows 260ms')
    expect(shell).toContain('opacity 180ms')
    expect(clip).toContain('opacity 160ms')
    expect(emptyShell).toContain('grid-template-rows 240ms')
    expect(emptyShell).toContain('opacity 150ms')
    expect(styles).not.toContain('stat-task-expired-row-in')
    expect(styles).not.toContain('--expired-stagger')
  })

  it('keeps dashboard checklist rows and their actions at full scale while pressed', () => {
    expect(cssRule('.stat-task-toggle:active:not(:disabled)')).toContain('transform: none')
    expect(cssRule('.stat-task-jump:active:not(:disabled)')).toContain('transform: none')
    expect(cssRule('.stat-task-toggle:active .stat-task-check:not(.on)')).toContain('transform: none')
  })

  it('uses a short opacity-only handoff for detailed deadline content', () => {
    const exit = cssRule('.deadline-view-panel.is-exiting')
    const enter = cssRule('.deadline-view-panel.is-entering')

    expect(exit).toContain('opacity 72ms')
    expect(enter).toContain('deadline-view-enter 190ms')
    expect(exit).not.toContain('transform')
    expect(enter).not.toContain('transform')
  })

  it('cross-fades dossier records without lateral movement', () => {
    for (const name of [
      '@keyframes dossier-record-view-old-forward',
      '@keyframes dossier-record-view-new-forward',
      '@keyframes dossier-record-view-old-backward',
      '@keyframes dossier-record-view-new-backward',
      '@keyframes atlas-fallback-dossier-record-exit-forward',
      '@keyframes atlas-fallback-dossier-record-exit-backward',
      '@keyframes atlas-fallback-dossier-record-enter-forward',
      '@keyframes atlas-fallback-dossier-record-enter-backward',
    ]) {
      const rule = cssRule(name)
      expect(rule).toContain('opacity: 0')
      expect(rule).not.toContain('transform')
    }
    expect(cssRule('::view-transition-old(atlas-dossier-record)')).toContain('mix-blend-mode: plus-lighter')
    expect(cssRule('::view-transition-new(atlas-dossier-record)')).toContain('mix-blend-mode: plus-lighter')
    expect(cssRule('html[data-atlas-transition-scope="dossier-record"] .dossier-handoff-content')).toContain(
      'view-transition-name: atlas-dossier-record',
    )
    expect(cssRule('::view-transition-group(atlas-dossier-record)')).toContain('animation: none')
    expect(cssRule('.dossier-handoff-content')).toContain('overflow-anchor: none')
  })

  it('starts board-to-dossier replacement as one local opacity cross-fade', () => {
    for (const name of [
      '@keyframes atlas-workspace-view-old',
      '@keyframes atlas-workspace-view-new',
      '@keyframes atlas-fallback-workspace-view-enter',
    ]) {
      const rule = cssRule(name)
      expect(rule).toContain('opacity: 0')
      expect(rule).not.toContain('transform')
    }

    const oldSnapshot = cssRule('::view-transition-old(atlas-workspace-view)')
    const newSnapshot = cssRule('::view-transition-new(atlas-workspace-view)')
    const fallback = cssRule('html[data-atlas-fallback-scope="workspace-view"][data-atlas-fallback-phase="enter"] .screen-stage')

    expect(oldSnapshot).toContain('atlas-workspace-view-old 210ms')
    expect(newSnapshot).toContain('atlas-workspace-view-new 210ms')
    expect(oldSnapshot).toContain('mix-blend-mode: plus-lighter')
    expect(newSnapshot).toContain('mix-blend-mode: plus-lighter')
    expect(fallback).toContain('atlas-fallback-workspace-view-enter 210ms')
    expect(fallback).toContain('will-change: opacity')
    expect(appSource).toMatch(
      /transitionOptions\.scope !== 'dossier-record'\s*&& transitionOptions\.scope !== 'workspace-view'/u,
    )
  })
})
