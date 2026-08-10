import { describe, expect, it } from 'vitest'
import coreStyles from '../../index.css?raw'
import zhWorkspaceSource from '../../i18n/zh/workspace.json?raw'
import applicationPipelineStyles from '../../styles/application-pipeline.css?raw'
import kanbanBoardSource from './KanbanBoard.tsx?raw'
import applicationPipelineViewSwitchSource from './ApplicationPipelineViewSwitch.tsx?raw'
import applicationSmartTableSource from './ApplicationSmartTable.tsx?raw'
import stickyHeaderSource from './applicationTableStickyHeader.ts?raw'

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

  it('keeps table checkmarks complete and quiet after pointer selection', () => {
    expect(applicationPipelineStyles).toMatch(
      /\.application-table-checkbox \.animated-checkmark-tick\s*\{[^}]*stroke-width:\s*2\.2;[^}]*stroke-dasharray:\s*none;[^}]*stroke-dashoffset:\s*0;/s,
    )
    expect(applicationPipelineStyles).toMatch(
      /\.application-table-checkbox:focus-within\s*\{[^}]*box-shadow:\s*none;/s,
    )
    expect(applicationPipelineStyles).toMatch(
      /\.application-table-checkbox:has\(input:focus-visible\)\s*\{[^}]*outline:\s*2px solid color-mix\(in srgb, var\(--accent\) 45%, transparent\);/s,
    )
  })

  it('keeps move-selected inside the compact selection action row', () => {
    expect(applicationSmartTableSource).toContain('leadingContent={(')
    expect(applicationSmartTableSource).toContain('placeholder={tx(\'kanban.moveSelected\')}')
    expect(applicationSmartTableSource).not.toContain('InlinePresence')
    expect(applicationSmartTableSource).toContain('placement="viewport-bottom"')
    expect(applicationSmartTableSource).toContain('viewportAnchorRef={tableShellRef}')
    expect(applicationSmartTableSource).toContain('className="application-table-selection-dock"')
    expect(applicationSmartTableSource).not.toContain('useStickyTableSurfaceMotion')
    expect(applicationSmartTableSource).not.toContain('stickyToolsRef')
    expect(applicationPipelineStyles).toMatch(
      /\.application-table-selection-dock \.explorer-selection-leading \.custom-select-trigger\s*\{[^}]*height:\s*26px !important;[^}]*min-height:\s*26px !important;/s,
    )
    expect(applicationPipelineStyles).not.toContain('.application-table-bulk-status')
  })

  it('keeps one horizontally scrollable table while returning vertical scrolling to the page', () => {
    expect(applicationSmartTableSource).toContain('const DESKTOP_INITIAL_ROW_COUNT = 12')
    expect(applicationSmartTableSource).toContain('const MOBILE_INITIAL_ROW_COUNT = 8')
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

  it('keeps the load-more affordance transparent and shows a stable loading handoff', () => {
    const loadMoreRule = applicationPipelineStyles.match(
      /\.application-table-load-more\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    expect(loadMoreRule).toContain('background: transparent')
    expect(applicationPipelineStyles).toMatch(
      /\.application-table-load-more\.is-loading button\s*\{[^}]*background:\s*color-mix\([^}]*transparent\);[^}]*color:\s*var\(--accent\);/s,
    )
    expect(applicationPipelineStyles).toMatch(
      /\.application-table-load-more\.is-loading \.application-table-load-more-icon-busy\s*\{[^}]*animation:\s*application-table-load-spin 760ms linear infinite;/s,
    )
    expect(applicationPipelineStyles).toContain('@keyframes application-table-load-spin')
    expect(applicationPipelineStyles).not.toContain('@keyframes application-table-load-pulse')
    expect(applicationSmartTableSource).toContain('const [isLoadingMoreRows, setIsLoadingMoreRows] = useState(false)')
    expect(applicationSmartTableSource).toContain('const loadMoreBusyRef = useRef(false)')
    expect(applicationSmartTableSource).toContain('disabled={isLoadMoreBusy}')
    expect(applicationSmartTableSource).toContain('<LoaderCircle size={13} className="application-table-load-more-icon-busy" />')
  })

  it('keeps the table heading pinned after it reaches the resident tools', () => {
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
      /\.application-smart-table thead\s*\{[^}]*position:\s*relative;[^}]*transform:\s*translate3d\(0, var\(--application-table-header-offset, 0px\), 0\);/s,
    )
    expect(applicationPipelineStyles).toMatch(
      /\.application-smart-table thead\[data-stuck\]\s*\{[^}]*will-change:\s*transform;[^}]*filter:\s*drop-shadow/s,
    )
    expect(applicationSmartTableSource).toContain('useApplicationTableStickyHeader({')
    expect(stickyHeaderSource).toContain("shell.closest<HTMLElement>('.kanban-workspace')")
    expect(stickyHeaderSource).toContain("scrollTarget.addEventListener('scroll', scheduleSync, { passive: true })")
    expect(stickyHeaderSource).toContain("header.style.setProperty('--application-table-header-offset'")
    expect(applicationSmartTableSource).toMatch(/<thead\r?\n\s+ref=\{tableHeadRef\}/u)
    expect(applicationPipelineStyles).toMatch(
      /\.application-table-deadline\s*\{[^}]*display:\s*grid;[^}]*gap:\s*2px;/s,
    )
    expect(applicationPipelineStyles).toMatch(
      /\.application-table-deadline \.deadline-badge\s*\{[^}]*font-size:\s*9px;/s,
    )
    expect(applicationSmartTableSource).toContain('priorityDisplayLabel(application.priority, tx)')
    expect(applicationSmartTableSource).not.toContain('<b>{application.priority}</b>')
  })

  it('gives board and table the same compact title row and keeps peer actions equal', () => {
    expect(applicationPipelineStyles).toMatch(
      /\.application-pipeline-workspace\s*\{[^}]*--application-pipeline-switch-height:\s*32px;/s,
    )
    expect(applicationPipelineStyles).toMatch(
      /\.application-pipeline-heading-copy\s*\{[^}]*align-self:\s*end;/s,
    )
    expect(applicationPipelineStyles).toMatch(
      /\.application-pipeline-heading-copy \.application-pipeline-title-row\s*\{[^}]*height:\s*var\(--application-pipeline-switch-height\);[^}]*align-items:\s*center;[^}]*margin-top:\s*0;/s,
    )
    expect(kanbanBoardSource).toContain("content={tx(tableHeading ? 'kanban.tableSubtitle' : 'kanban.subtitle')}")
    expect(kanbanBoardSource).not.toContain("<p>{tx('kanban.subtitle')}</p>")
    expect(applicationPipelineStyles).toMatch(
      /\.application-table-tools\s*\{[^}]*--application-table-action-height:\s*var\(--action-height-compact\);/s,
    )
    expect(applicationPipelineStyles).toMatch(
      /\.application-table-tool-button,\s*\.application-table-new-button\s*\{[^}]*height:\s*var\(--application-table-action-height\);[^}]*min-height:\s*var\(--application-table-action-height\);/s,
    )
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
    expect(applicationPipelineStyles).toContain('data-application-pipeline-transition-direction')
    expect(applicationPipelineStyles).toMatch(
      /\.application-smart-table tbody tr\.is-entering\s*\{[^}]*content-visibility:\s*visible;[^}]*will-change:\s*opacity,\s*transform;[^}]*animation:\s*application-table-row-in 320ms var\(--ease-fluid\) backwards;/s,
    )
    expect(applicationSmartTableSource).toContain("row.classList.contains('is-entering')")
    expect(applicationSmartTableSource).toContain('captureVisibleRowPositions')
    expect(applicationSmartTableSource).toContain('scheduleObservedLoadMoreRows')
    expect(applicationSmartTableSource).toContain('const progressiveLoadArmedRef = useRef(false)')
    expect(applicationSmartTableSource).toContain('const preloadDistance = compactViewport ? 180 : 260')
    expect(applicationSmartTableSource).toContain('rootMargin: `0px 0px ${preloadDistance}px`')
    expect(applicationSmartTableSource).toContain('ids: [] as string[]')
    expect(applicationSmartTableSource).toContain('const TABLE_ROW_STAGGER_LIMIT = DESKTOP_ROW_BATCH_SIZE - 1')
    expect(applicationSmartTableSource).toContain('TABLE_ROW_STAGGER_LIMIT,')
    expect(applicationPipelineStyles).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.application-pipeline-heading-copy,[\s\S]*?\.application-pipeline-view-indicator,[\s\S]*?animation:\s*none !important;/s,
    )
  })

  it('prewarms resident views and switches on an interruptible compositor slide', () => {
    expect(kanbanBoardSource).toContain("Activity mode={tableMode ? 'visible' : 'hidden'}")
    expect(kanbanBoardSource).toContain("Activity mode={tableMode ? 'hidden' : 'visible'}")
    expect(kanbanBoardSource).toContain('data-pipeline-view-slot="table"')
    expect(kanbanBoardSource).toContain('data-pipeline-view-slot="board"')
    expect(kanbanBoardSource).not.toContain('data-application-pipeline-transition-veil')
    expect(kanbanBoardSource).toContain('onPrepare={preparePipelineView}')
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
    expect(applicationPipelineViewSwitchSource).toContain('startTransition(() => onChange(nextValue))')
    expect(applicationPipelineViewSwitchSource).not.toContain('flushSync')
    expect(applicationPipelineViewSwitchSource).not.toContain('PIPELINE_VIEW_FADE_OUT_MS')
    expect(applicationPipelineStyles).not.toContain('view-transition-name')
    expect(applicationPipelineStyles).not.toContain('::view-transition-')
    expect(applicationPipelineStyles).not.toContain('application-pipeline-native-')
    expect(applicationPipelineStyles).not.toContain('application-pipeline-fallback-')
    expect(applicationPipelineStyles).not.toContain('.application-pipeline-transition-veil')
    expect(applicationPipelineStyles).toMatch(
      /data-application-pipeline-transition-token[^}]*\{[^}]*overflow:\s*clip;/s,
    )
    expect(applicationPipelineStyles).toMatch(
      /data-application-pipeline-transition-mode="preparing"[\s\S]*?data-pipeline-view-slot="table"[^}]*\{[^}]*transform:\s*translate3d\(18px, 0, 0\);/s,
    )
    expect(applicationPipelineStyles).toMatch(
      /data-application-pipeline-transition-mode="settling"[\s\S]*?application-pipeline-view-slot\s*\{[^}]*opacity:\s*1;[^}]*transform:\s*translate3d\(0, 0, 0\);/s,
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
