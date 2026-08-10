import { describe, expect, it } from 'vitest'
import appSource from '../../App.tsx?raw'
import appStyles from '../../index.css?raw'
import applicationPaneSource from './ApplicationPane.tsx?raw'
import kanbanSource from './KanbanBoard.tsx?raw'

describe('workspace view handoff performance contracts', () => {
  it('keeps the outgoing surface visible while the destination view is deferred', () => {
    expect(appSource).toContain('const deferredWorkspaceViewMode = useDeferredValue(viewMode)')
    expect(appSource).toContain("const reducedWorkspaceMotion = typeof window.matchMedia === 'function'")
    expect(appSource).toContain('const renderedWorkspaceViewMode = hasWorkspaceViewContinuity')
    expect(appSource).toContain('workspace-view-${renderedWorkspaceViewMode}')
    expect(appSource).toMatch(
      /if \(renderedWorkspaceViewMode === 'kanban' && canUseWorkspaceBoard\)[\s\S]*?startTransition\(\(\) => \{/,
    )
    expect(appSource).toContain('boardActive={viewMode === \'kanban\'}')
  })

  it('retains the opened board without mounting inactive content during the first handoff', () => {
    expect(appSource).toContain('deferInactiveView')
    expect(appSource).toContain('const [workspaceBoardResident, setWorkspaceBoardResident]')
    expect(appSource).toContain("<Activity mode={renderedWorkspaceViewMode === 'kanban' ? 'visible' : 'hidden'}>")
    expect(appSource).toMatch(
      /<Activity mode=\{renderedWorkspaceViewMode[\s\S]*?<Suspense fallback=\{<DeferredPanel variant="workspace" \/>\}>[\s\S]*?\{workspaceKanbanContent\}[\s\S]*?<\/Suspense>[\s\S]*?<\/Activity>/,
    )
    expect(appSource).toMatch(/setWorkspaceBoardResident\(true\)[\s\S]*setViewMode\('kanban'\)/)
    expect(kanbanSource).toContain('requestIdleCallback')
    expect(kanbanSource).toContain('PIPELINE_INACTIVE_VIEW_SETTLE_MS')
    expect(kanbanSource).toContain('startTransition(() => setInitialCardsReady(true))')
    expect(kanbanSource).toContain('className="kanban-column-preview"')
    expect(kanbanSource).toContain('const tableMounted = !deferInactiveView || tableMode')
    expect(kanbanSource).toContain('const boardMounted = !deferInactiveView || !tableMode')
    expect(kanbanSource).toContain('setResidentViewModes((current) => current.has(nextView)')
  })

  it('keeps the explorer board action and staged board reveal off the layout timeline', () => {
    expect(applicationPaneSource).toMatch(
      /className="application-board-action-presence"[\s\S]*layout="instant"/,
    )
    expect(appStyles).toMatch(
      /\.application-board-action-presence\[data-present='false'\]\s*\{[^}]*inline-size:\s*max-content;[^}]*transition:[^}]*opacity[^}]*transform/s,
    )
    expect(appStyles).toMatch(
      /\.list-count-actions\s*\{[^}]*contain:\s*layout style;/s,
    )
    expect(appStyles).toMatch(
      /\.application-pipeline-board-view\[data-entry-staged='true'\]\[data-entry-state='ready'\] \.kanban-board\s*\{[^}]*animation:\s*kanban-entry-content-ready/s,
    )
  })

  it('routes non-rail dashboard and Discover handoffs through the shared transition owners', () => {
    expect(appSource).toMatch(
      /onOpenDiscover=[\s\S]*?runAnimatedRailScreenUpdate\([\s\S]*?setScreen\('discover'\)/,
    )
    expect(appSource).toMatch(
      /onImported=\{\(created\) => \{[\s\S]*?runAnimatedDossierUpdate\([\s\S]*?setScreen\('workspace'\)/,
    )
    expect(appSource).toMatch(
      /onImported=\{\(created\) => \{[\s\S]*?ready: prefetchDossierAssets\(\)[\s\S]*?deferDossierContent: true/,
    )
    expect(appSource).toMatch(
      /const returnToDashboardFromMissingRoute = \(\) => \{[\s\S]*?runAnimatedRailScreenUpdate/,
    )
  })
})
