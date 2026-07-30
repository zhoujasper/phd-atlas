import { describe, expect, it } from 'vitest'
import coreStyles from '../../index.css?raw'
import zhWorkspaceSource from '../../i18n/zh/workspace.json?raw'
import applicationPipelineStyles from '../../styles/application-pipeline.css?raw'
import kanbanBoardSource from './KanbanBoard.tsx?raw'
import applicationSmartTableSource from './ApplicationSmartTable.tsx?raw'

describe('application smart-table responsive sticky columns', () => {
  it('keeps the application identity column sticky only on wide screens', () => {
    expect(applicationPipelineStyles).toMatch(
      /\.application-table-identity-cell\.is-sticky\s*\{[^}]*left:\s*var\(--application-table-select-width,\s*44px\);[^}]*box-shadow:/s,
    )
    expect(applicationPipelineStyles).toMatch(
      /@media \(max-width:\s*1380px\)\s*\{[\s\S]*?\.application-smart-table \.application-table-identity-cell\.is-sticky\s*\{[^}]*position:\s*static;[^}]*left:\s*auto;[^}]*z-index:\s*auto;[^}]*box-shadow:\s*none;/s,
    )
  })

  it('leaves the selection column frozen at the leading edge', () => {
    expect(applicationPipelineStyles).toMatch(
      /\.application-table-select-cell\.is-sticky\s*\{[^}]*left:\s*0;/s,
    )
    expect(applicationPipelineStyles).not.toMatch(
      /@media \(max-width:\s*1380px\)\s*\{[\s\S]*?\.application-table-select-cell\.is-sticky\s*\{[^}]*position:\s*static;/s,
    )
  })

  it('keeps one horizontally scrollable table while returning vertical scrolling to the page', () => {
    expect(applicationSmartTableSource).toContain('const MOBILE_INITIAL_ROW_COUNT = 10')
    expect(applicationSmartTableSource).toContain('sortedRows.slice(0, visibleRowCount)')
    expect(applicationSmartTableSource).toContain('new IntersectionObserver(')
    expect(applicationSmartTableSource).toContain("closest('.kanban-workspace')")
    expect(applicationSmartTableSource).not.toContain('application-table-mobile-row')

    const shellRule = applicationPipelineStyles.match(
      /\.application-smart-table-shell\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    expect(shellRule).toContain('overflow-x: auto')
    expect(shellRule).toContain('overflow-y: hidden')
    expect(shellRule).toContain('border: 0')
    expect(shellRule).not.toContain('max-height')

    const phoneStart = applicationPipelineStyles.indexOf('@media (max-width: 820px)')
    const narrowPhoneStart = applicationPipelineStyles.indexOf('@media (max-width: 560px)')
    const phoneStyles = applicationPipelineStyles.slice(phoneStart, narrowPhoneStart)
    expect(applicationPipelineStyles).toMatch(
      /@media \(max-width:\s*820px\)\s*\{[\s\S]*?\.application-smart-table-shell\s*\{[^}]*margin-inline:/s,
    )
    expect(phoneStyles).not.toMatch(/\.application-smart-table-shell\s*\{[^}]*max-height:/s)
    expect(applicationPipelineStyles).not.toContain('view-transition-name')
    expect(applicationPipelineStyles).not.toContain('::view-transition-')
  })

  it('keeps tools resident while the table heading follows the natural page flow', () => {
    expect(applicationPipelineStyles).toMatch(
      /\.application-table-sticky-tools\s*\{[^}]*position:\s*sticky;[^}]*top:\s*calc\(-1 \* var\(--application-table-sticky-overhang\)\);/s,
    )
    expect(applicationPipelineStyles).toMatch(
      /\.application-table-sticky-tools\s*\{[^}]*isolation:\s*isolate;[^}]*background:\s*var\(--canvas\);/s,
    )
    expect(applicationPipelineStyles).not.toMatch(
      /\.application-table-sticky-tools\s*\{[^}]*background:\s*color-mix\([^}]*transparent/s,
    )
    expect(applicationPipelineStyles).toMatch(
      /\.application-smart-table thead\s*\{[^}]*position:\s*static;/s,
    )
    expect(applicationPipelineStyles).toMatch(
      /\.application-table-deadline\s*\{[^}]*display:\s*grid;[^}]*gap:\s*2px;/s,
    )
    expect(applicationPipelineStyles).toMatch(
      /\.application-table-deadline \.deadline-badge\s*\{[^}]*font-size:\s*9px;/s,
    )
    expect(applicationSmartTableSource).toContain('priorityDisplayLabel(application.priority, tx)')
    expect(applicationSmartTableSource).not.toContain('<b>{application.priority}</b>')
  })

  it('lets board columns grow in the same page flow and keeps one visible row action', () => {
    expect(coreStyles).toMatch(
      /\.kanban-column-body\s*\{[^}]*max-height:\s*none;[^}]*overflow:\s*visible;/s,
    )
    expect(applicationSmartTableSource).toContain('className="application-table-open-action"')
    expect(applicationSmartTableSource).not.toContain('application-table-detail-toggle')
    expect(applicationSmartTableSource).not.toContain('tableOpenActions')
  })

  it('keeps the scoped handoff free of a blue progress underline', () => {
    expect(applicationPipelineStyles).not.toContain('.application-pipeline-view-switch::after')
    expect(applicationPipelineStyles).not.toContain('data-application-pipeline-transition-scope')
    expect(applicationPipelineStyles).not.toMatch(
      /html\[data-application-pipeline-transition-(?:mode|token)/,
    )
    expect(applicationPipelineStyles).toContain(
      '.application-pipeline-view-stage[data-application-pipeline-transition-token]',
    )
    expect(applicationPipelineStyles).not.toContain('@keyframes application-pipeline-progress-forward')
    expect(applicationPipelineStyles).not.toContain('@keyframes application-pipeline-progress-backward')
    expect(applicationPipelineStyles).not.toContain('data-application-pipeline-transition-direction')
    expect(applicationPipelineStyles).toMatch(
      /\.application-smart-table tbody tr\.is-entering\s*\{[^}]*content-visibility:\s*visible;[^}]*will-change:\s*opacity,\s*transform;[^}]*animation:\s*application-table-row-in 320ms var\(--ease-fluid\) backwards;/s,
    )
    expect(applicationSmartTableSource).toContain("row.classList.contains('is-entering')")
    expect(applicationSmartTableSource).toContain('captureVisibleRowPositions')
    expect(applicationSmartTableSource).toContain('scheduleObservedLoadMoreRows')
    expect(applicationSmartTableSource).toContain(
      "rootMargin: compactViewport ? '0px 0px 360px' : '0px 0px 520px'",
    )
    expect(applicationSmartTableSource).toContain('ids: [] as string[]')
    expect(applicationPipelineStyles).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.application-pipeline-heading-copy,[\s\S]*?\.application-pipeline-view-indicator,[\s\S]*?animation:\s*none !important;/s,
    )
  })

  it('prewarms resident views and switches behind one lightweight fade-through veil', () => {
    expect(kanbanBoardSource).toContain("Activity mode={tableMode ? 'visible' : 'hidden'}")
    expect(kanbanBoardSource).toContain("Activity mode={tableMode ? 'hidden' : 'visible'}")
    expect(kanbanBoardSource).toContain('data-pipeline-view-slot="table"')
    expect(kanbanBoardSource).toContain('data-pipeline-view-slot="board"')
    expect(kanbanBoardSource).toContain('data-application-pipeline-transition-veil')
    expect(kanbanBoardSource).not.toContain('key={`${scope}-${viewMode}`}')
    expect(kanbanBoardSource).toContain('const MemoizedApplicationSmartTable = memo(ApplicationSmartTable)')
    expect(kanbanBoardSource).toContain('const MemoizedTeamStudentKanbanBoard = memo(TeamStudentKanbanBoard)')
    expect(kanbanBoardSource).toContain('const MemoizedPersonalKanbanBoard = memo(PersonalKanbanBoard)')
    expect(applicationSmartTableSource).toContain('function ApplicationTableStatusEditor(')
    expect(applicationSmartTableSource).toContain('openOnMount')

    expect(applicationPipelineStyles).toMatch(
      /\.application-pipeline-heading-stack\s*\{[^}]*display:\s*grid;/s,
    )
    const headingRule = applicationPipelineStyles.match(
      /\.application-pipeline-heading-copy\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    expect(headingRule).toContain('grid-area: 1 / 1')
    expect(headingRule).toContain('opacity: 0')
    expect(headingRule).toContain('transition: opacity 160ms var(--ease-out)')
    expect(headingRule).not.toContain('transform')

    expect(applicationPipelineStyles).toMatch(
      /\.application-pipeline-workspace\s*\{[^}]*overflow-anchor:\s*none;/s,
    )
    expect(applicationPipelineStyles).not.toContain('data-application-pipeline-stable-token')
    expect(applicationPipelineStyles).not.toContain('data-application-pipeline-height-release-token')
    expect(applicationPipelineStyles).not.toContain('--application-pipeline-stable-height')
    expect(applicationPipelineStyles).not.toContain('view-transition-name')
    expect(applicationPipelineStyles).not.toContain('::view-transition-')
    expect(applicationPipelineStyles).not.toContain('application-pipeline-native-')
    expect(applicationPipelineStyles).not.toContain('application-pipeline-fallback-')
    expect(applicationPipelineStyles).toMatch(
      /\.application-pipeline-transition-veil\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*background:\s*var\(--canvas\);[^}]*pointer-events:\s*none;/s,
    )
    expect(applicationPipelineStyles).toMatch(
      /data-application-pipeline-transition-mode="veil-in"[\s\S]*?\.application-pipeline-transition-veil\s*\{[^}]*opacity:\s*0\.9;[^}]*will-change:\s*opacity;[^}]*transition:\s*opacity 80ms var\(--ease-out\);/s,
    )
    expect(applicationPipelineStyles).toMatch(
      /data-application-pipeline-transition-mode="veil-out"[\s\S]*?\.application-pipeline-transition-veil\s*\{[^}]*opacity:\s*0;[^}]*will-change:\s*opacity;[^}]*transition:\s*opacity 140ms var\(--ease-out\);/s,
    )
    expect(applicationPipelineStyles).not.toContain('application-table-surface-in')
  })

  it('uses the concise Chinese table label everywhere in the presentation switch', () => {
    const zhWorkspace = JSON.parse(zhWorkspaceSource) as {
      kanban: Record<string, string>
    }
    expect(zhWorkspace.kanban.table).toBe('表格')
    expect(zhWorkspace.kanban.tableView).toBe('表格视图')
    expect(zhWorkspace.kanban.tableEyebrow).toBe('表格')
  })
})
