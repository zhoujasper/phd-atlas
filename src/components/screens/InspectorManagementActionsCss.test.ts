import { describe, expect, it } from 'vitest'
import inspectorStyles from '../../index.css?raw'
import asyncActionStyles from '../../styles/mail-actions.css?raw'

function requireRule(css: string, pattern: RegExp) {
  const rule = css.match(pattern)?.[0]
  expect(rule).toBeTruthy()
  return rule ?? ''
}

describe('inspector management action CSS', () => {
  it('keeps export and backup async states stacked instead of squeezing their labels', () => {
    const style = document.createElement('style')
    const surface = document.createElement('section')

    try {
      // Match the production import order so this test covers the real cascade,
      // including the higher-specificity generic export/full-line rules.
      style.textContent = [
        requireRule(inspectorStyles, /\.full-line\s*\{[^}]*\}/s),
        requireRule(inspectorStyles, /\.export-grid button\s*\{[^}]*display:\s*inline-flex[^}]*\}/s),
        requireRule(inspectorStyles, /\.inspector-export-grid\s*\{[^}]*\}/s),
        requireRule(inspectorStyles, /\.inspector-export-grid \.async-action-button\s*\{[^}]*\}/s),
        requireRule(
          inspectorStyles,
          /\.inspector-export-grid \.async-action-layer,\s*\.inspector-backup-action \.async-action-layer\s*\{[^}]*\}/s,
        ),
        requireRule(inspectorStyles, /\.inspector-backup-action\.async-action-button\s*\{[^}]*\}/s),
        requireRule(asyncActionStyles, /\.async-action-button\s*\{[^}]*\}/s),
        requireRule(asyncActionStyles, /\.async-action-layer\s*\{[^}]*\}/s),
      ].join('\n')
      document.head.append(style)
      surface.innerHTML = `
        <div class="export-grid inspector-export-grid">
          <button class="async-action-button is-idle">
            <span class="async-action-layer async-action-idle"><svg></svg><span>JSON</span></span>
            <span class="async-action-layer async-action-pending"><svg></svg><span>Exporting JSON</span></span>
            <span class="async-action-layer async-action-success"><svg></svg><span>JSON ready</span></span>
            <span class="async-action-layer async-action-error"><svg></svg><span>Export failed</span></span>
          </button>
        </div>
        <button class="full-line inspector-backup-action async-action-button is-idle">
          <span class="async-action-layer async-action-idle"><svg></svg><span>Create backup now</span></span>
          <span class="async-action-layer async-action-pending"><svg></svg><span>Creating backup</span></span>
          <span class="async-action-layer async-action-success"><svg></svg><span>Backup created</span></span>
          <span class="async-action-layer async-action-error"><svg></svg><span>Backup failed</span></span>
        </button>
      `
      document.body.append(surface)

      const exportGrid = surface.querySelector<HTMLElement>('.inspector-export-grid')
      const exportButton = surface.querySelector<HTMLElement>('.inspector-export-grid .async-action-button')
      const backupButton = surface.querySelector<HTMLElement>('.inspector-backup-action')
      const backupLayer = surface.querySelector<HTMLElement>('.inspector-backup-action .async-action-layer')

      expect(exportGrid).not.toBeNull()
      expect(exportButton).not.toBeNull()
      expect(backupButton).not.toBeNull()
      expect(backupLayer).not.toBeNull()

      expect(window.getComputedStyle(exportGrid as HTMLElement).gridTemplateColumns)
        .toBe('repeat(2, minmax(0, 1fr))')
      expect(window.getComputedStyle(exportButton as HTMLElement).display).toBe('inline-grid')
      expect(window.getComputedStyle(exportButton as HTMLElement).gridTemplateColumns).toBe('minmax(0, 1fr)')
      expect(window.getComputedStyle(backupButton as HTMLElement).display).toBe('grid')
      expect(window.getComputedStyle(backupButton as HTMLElement).gridTemplateColumns).toBe('minmax(0, 1fr)')
      expect(window.getComputedStyle(backupLayer as HTMLElement).width).toBe('100%')
    } finally {
      surface.remove()
      style.remove()
    }
  })
})
