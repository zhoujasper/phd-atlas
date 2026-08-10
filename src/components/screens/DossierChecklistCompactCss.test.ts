import { describe, expect, it } from 'vitest'
import applicationSchemaSource from '../../contracts/applicationSchemas.ts?raw'
import dossierSource from './DossierView.tsx?raw'
import dossierStyles from '../../index.css?raw'
import mobileStyles from '../../styles/mobile.css?raw'

const normalizedStyles = dossierStyles.replace(/\r\n/g, '\n')
const normalizedMobileStyles = mobileStyles.replace(/\r\n/g, '\n')

describe('dossier checklist compact controls', () => {
  it('keeps the checklist hero dense without shrinking phone touch targets', () => {
    expect(dossierSource).toContain('data-dossier-tab={renderedTab}')
    expect(normalizedStyles).toMatch(
      /\.dossier-content\[data-dossier-tab='materials'\]\s*\{[^}]*padding-top:\s*10px;/s,
    )
    expect(normalizedStyles).toMatch(
      /\.checklist-page\s*\{[^}]*gap:\s*14px;/s,
    )
    expect(normalizedStyles).toMatch(
      /\.checklist-hero\s*\{[^}]*gap:\s*14px;[^}]*padding:\s*0 0 10px;/s,
    )
    expect(normalizedStyles).toMatch(
      /\.checklist-hero-actions\s*\{[^}]*gap:\s*6px;/s,
    )
    expect(normalizedStyles).toMatch(
      /\.checklist-progress-ring\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;/s,
    )
    expect(normalizedStyles).toMatch(
      /button\.checklist-reminder-filter-btn\s*\{[^}]*min-height:\s*26px;[^}]*padding:\s*2px 7px;/s,
    )
    expect(normalizedStyles).toMatch(
      /@container dossier-pane \(min-width:\s*621px\)[\s\S]*?\.checklist-hero-add-btn\s*\{[^}]*min-height:\s*26px;[^}]*padding-inline:\s*8px;/s,
    )
    expect(normalizedMobileStyles).toMatch(
      /body \.checklist-hero button\.checklist-reminder-filter-btn,[\s\S]*?min-height:\s*32px !important;/s,
    )
  })

  it('keeps editable titles borderless without a line below them', () => {
    expect(normalizedStyles).toMatch(
      /\.checklist-item-title\s*\{[^}]*border: none;/,
    )
    expect(normalizedStyles).not.toContain('.checklist-item-title-wrap::after {')
    expect(normalizedStyles).toMatch(
      /\.scholarship-row-title-editor\s*\{[^}]*border: 0;[^}]*background: transparent;/,
    )
    expect(normalizedStyles).not.toContain('.scholarship-row-title-editor::after {')
    expect(normalizedStyles).not.toMatch(
      /\.scholarship-row-title-editor\s*\{[^}]*border-bottom:/,
    )
  })

  it('collapses trailing actions until hover or focus instead of reserving a blank column', () => {
    expect(normalizedStyles).toMatch(
      /\.checklist-mini-btn\s*\{[\s\S]*?width: 0;[\s\S]*?flex: 0 0 0;[\s\S]*?visibility: hidden;[\s\S]*?pointer-events: none;/,
    )
    expect(normalizedStyles).toContain('.checklist-item:hover .checklist-mini-btn,')
    expect(normalizedStyles).toContain('.scholarship-mini-row:is(.material-row, .task-row) > .scholarship-row-remove {')
  })

  it('keeps status and date controls on a shared compact grid and permits empty dates', () => {
    expect(normalizedStyles).toMatch(
      /\.checklist-detail-grid\s*\{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
    )
    expect(normalizedStyles).toMatch(
      /\.checklist-detail-grid :is\(\.custom-select-trigger, \.date-picker-root, \.date-picker-input-wrap, \.date-picker-display\)\s*\{[\s\S]*?min-height: 32px;[\s\S]*?height: 32px;/,
    )
    expect(dossierSource).toContain('value={material.due || \'\'}')
    expect(dossierSource).toContain('value={task.due || \'\'}')
    expect(dossierSource).toContain('allowClear')
    expect(applicationSchemaSource).toContain('const ScholarshipTaskSchema')
    expect(applicationSchemaSource).toContain('const TaskSchema')
  })
})
