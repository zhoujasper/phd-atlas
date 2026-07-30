import { LayoutGrid, Table2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import type {
  ApplicationPipelineScope,
  ApplicationPipelineViewMode,
} from './applicationPipelineModel'

let pipelineViewTransitionSequence = 0
const PIPELINE_VIEW_FADE_OUT_MS = 80
const PIPELINE_VIEW_FADE_IN_CLEANUP_MS = 160

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function clearTransitionState(token: string, stage: HTMLElement | null) {
  if (stage?.dataset.applicationPipelineTransitionToken !== token) return
  delete stage.dataset.applicationPipelineTransitionToken
  delete stage.dataset.applicationPipelineTransitionMode
  if (stage.dataset.applicationPipelineBusyToken === token) {
    delete stage.dataset.applicationPipelineBusyToken
    stage.removeAttribute('aria-busy')
  }
}

function getPipelineScrollOwner(stage: HTMLElement) {
  const compactViewport = typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 820px)').matches
  if (!compactViewport) {
    const workspace = stage.closest<HTMLElement>('.kanban-workspace')
    if (workspace) return workspace
  }
  return document.scrollingElement instanceof HTMLElement
    ? document.scrollingElement
    : document.documentElement
}

export function ApplicationPipelineViewSwitch({
  value,
  onChange,
  label,
  boardLabel,
  tableLabel,
  scope,
  controlsId,
}: {
  value: ApplicationPipelineViewMode
  onChange: (value: ApplicationPipelineViewMode) => void
  label: string
  boardLabel: string
  tableLabel: string
  scope: ApplicationPipelineScope
  controlsId: string
}) {
  const commitTimerRef = useRef<number | null>(null)
  const cleanupTimerRef = useRef<number | null>(null)
  const activeTokenRef = useRef<string | null>(null)
  const activeStageRef = useRef<HTMLElement | null>(null)
  const pendingValueRef = useRef<ApplicationPipelineViewMode | null>(null)

  const clearTransitionTimers = () => {
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current)
      commitTimerRef.current = null
    }
    if (cleanupTimerRef.current !== null) {
      window.clearTimeout(cleanupTimerRef.current)
      cleanupTimerRef.current = null
    }
  }

  const clearActiveTransition = () => {
    clearTransitionTimers()
    const token = activeTokenRef.current
    if (token) {
      clearTransitionState(token, activeStageRef.current)
      activeTokenRef.current = null
    }
    activeStageRef.current = null
    pendingValueRef.current = null
  }

  const supersedeActiveTransition = (nextStage: HTMLElement) => {
    clearTransitionTimers()
    const previousToken = activeTokenRef.current
    const previousStage = activeStageRef.current
    if (previousToken && previousStage && previousStage !== nextStage) {
      clearTransitionState(previousToken, previousStage)
    }
    activeTokenRef.current = null
    activeStageRef.current = null
    pendingValueRef.current = null
  }

  const scheduleVeilOut = (token: string, stage: HTMLElement) => {
    stage.dataset.applicationPipelineTransitionMode = 'veil-out'
    cleanupTimerRef.current = window.setTimeout(() => {
      cleanupTimerRef.current = null
      clearTransitionState(token, stage)
      if (activeTokenRef.current === token) activeTokenRef.current = null
      if (activeStageRef.current === stage) activeStageRef.current = null
      pendingValueRef.current = null
    }, PIPELINE_VIEW_FADE_IN_CLEANUP_MS)
  }

  const cancelPendingChange = () => {
    const stage = activeStageRef.current
    if (!stage) return
    clearTransitionTimers()
    const token = String(++pipelineViewTransitionSequence)
    activeTokenRef.current = token
    pendingValueRef.current = null
    stage.dataset.applicationPipelineTransitionToken = token
    stage.dataset.applicationPipelineBusyToken = token
    stage.setAttribute('aria-busy', 'true')
    scheduleVeilOut(token, stage)
  }

  useEffect(() => () => clearActiveTransition(), [controlsId])

  const changeView = (nextValue: ApplicationPipelineViewMode) => {
    if (value === nextValue) {
      if (pendingValueRef.current && pendingValueRef.current !== nextValue) {
        cancelPendingChange()
      }
      return
    }
    if (typeof document === 'undefined' || prefersReducedMotion()) {
      onChange(nextValue)
      return
    }

    const stage = document.getElementById(controlsId)
    const veil = stage?.querySelector('[data-application-pipeline-transition-veil]')
    if (!stage || !veil) {
      onChange(nextValue)
      return
    }
    const token = String(++pipelineViewTransitionSequence)

    supersedeActiveTransition(stage)
    activeTokenRef.current = token
    activeStageRef.current = stage
    pendingValueRef.current = nextValue
    stage.dataset.applicationPipelineTransitionToken = token
    stage.dataset.applicationPipelineTransitionMode = 'veil-in'
    stage.dataset.applicationPipelineBusyToken = token
    stage.setAttribute('aria-busy', 'true')

    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = null
      if (stage.dataset.applicationPipelineTransitionToken !== token) return

      const scrollOwner = getPipelineScrollOwner(stage)
      const scrollTop = scrollOwner.scrollTop
      // The inactive Activity has already rendered at hidden priority. Commit
      // only after the tiny veil has settled, so React never competes with a
      // running full-content animation or a browser snapshot.
      flushSync(() => onChange(nextValue))
      if (scrollOwner.scrollTop !== scrollTop) scrollOwner.scrollTop = scrollTop
      pendingValueRef.current = null
      scheduleVeilOut(token, stage)
    }, PIPELINE_VIEW_FADE_OUT_MS)
  }

  return (
    <div
      className="application-pipeline-view-switch"
      data-view={value}
      data-pipeline-scope={scope}
      role="group"
      aria-label={label}
    >
      <span className="application-pipeline-view-indicator" aria-hidden="true" />
      <button
        type="button"
        className={value === 'board' ? 'active' : ''}
        title={boardLabel}
        aria-label={boardLabel}
        aria-pressed={value === 'board'}
        aria-controls={controlsId}
        onClick={() => changeView('board')}
      >
        <LayoutGrid size={14} aria-hidden="true" />
        <span>{boardLabel}</span>
      </button>
      <button
        type="button"
        className={value === 'table' ? 'active' : ''}
        title={tableLabel}
        aria-label={tableLabel}
        aria-pressed={value === 'table'}
        aria-controls={controlsId}
        onClick={() => changeView('table')}
      >
        <Table2 size={14} aria-hidden="true" />
        <span>{tableLabel}</span>
      </button>
    </div>
  )
}
