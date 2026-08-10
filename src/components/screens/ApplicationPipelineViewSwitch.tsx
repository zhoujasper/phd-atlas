import { LayoutGrid, Table2 } from 'lucide-react'
import {
  startTransition,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type {
  ApplicationPipelineScope,
  ApplicationPipelineViewMode,
} from './applicationPipelineModel'

let pipelineViewTransitionSequence = 0
const PIPELINE_VIEW_SLIDE_CLEANUP_MS = 240

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function clearTransitionState(token: string, stage: HTMLElement | null) {
  if (stage?.dataset.applicationPipelineTransitionToken !== token) return
  delete stage.dataset.applicationPipelineTransitionToken
  delete stage.dataset.applicationPipelineTransitionDirection
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
  onPrepare,
}: {
  value: ApplicationPipelineViewMode
  onChange: (value: ApplicationPipelineViewMode) => void
  label: string
  boardLabel: string
  tableLabel: string
  scope: ApplicationPipelineScope
  controlsId: string
  onPrepare?: (value: ApplicationPipelineViewMode) => void
}) {
  const [optimisticValue, setOptimisticValue] = useState(value)
  const settleFrameRef = useRef<number | null>(null)
  const cleanupTimerRef = useRef<number | null>(null)
  const activeTokenRef = useRef<string | null>(null)
  const activeStageRef = useRef<HTMLElement | null>(null)
  const pendingValueRef = useRef<ApplicationPipelineViewMode | null>(null)
  const scrollSnapshotRef = useRef<{
    owner: HTMLElement
    top: number
    token: string
  } | null>(null)

  const clearTransitionTimers = () => {
    if (settleFrameRef.current !== null) {
      window.cancelAnimationFrame(settleFrameRef.current)
      settleFrameRef.current = null
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
    scrollSnapshotRef.current = null
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
    scrollSnapshotRef.current = null
  }

  const scheduleSlideCleanup = (token: string, stage: HTMLElement) => {
    cleanupTimerRef.current = window.setTimeout(() => {
      cleanupTimerRef.current = null
      clearTransitionState(token, stage)
      if (activeTokenRef.current === token) activeTokenRef.current = null
      if (activeStageRef.current === stage) activeStageRef.current = null
      if (scrollSnapshotRef.current?.token === token) scrollSnapshotRef.current = null
    }, PIPELINE_VIEW_SLIDE_CLEANUP_MS)
  }

  const cancelPendingChange = () => {
    const stage = activeStageRef.current
    if (!stage) return
    clearTransitionTimers()
    const token = String(++pipelineViewTransitionSequence)
    activeTokenRef.current = token
    pendingValueRef.current = null
    scrollSnapshotRef.current = null
    stage.dataset.applicationPipelineTransitionToken = token
    stage.dataset.applicationPipelineTransitionMode = 'settling'
    stage.removeAttribute('aria-busy')
    delete stage.dataset.applicationPipelineBusyToken
    scheduleSlideCleanup(token, stage)
  }

  useEffect(() => () => clearActiveTransition(), [controlsId])

  useEffect(() => {
    if (pendingValueRef.current === null && activeTokenRef.current === null) {
      setOptimisticValue(value)
    }
  }, [value])

  useLayoutEffect(() => {
    const pendingValue = pendingValueRef.current
    const token = activeTokenRef.current
    const stage = activeStageRef.current
    if (!pendingValue || pendingValue !== value || !token || !stage) return
    if (stage.dataset.applicationPipelineTransitionToken !== token) return

    const scrollSnapshot = scrollSnapshotRef.current
    if (scrollSnapshot?.token === token && scrollSnapshot.owner.scrollTop !== scrollSnapshot.top) {
      scrollSnapshot.owner.scrollTop = scrollSnapshot.top
    }
    pendingValueRef.current = null
    settleFrameRef.current = window.requestAnimationFrame(() => {
      // Leave one painted frame at the directional start position. A second
      // frame avoids collapsing prepare + settle into one style calculation
      // when the resident destination commits very quickly.
      settleFrameRef.current = window.requestAnimationFrame(() => {
        settleFrameRef.current = null
        if (stage.dataset.applicationPipelineTransitionToken !== token) return
        stage.dataset.applicationPipelineTransitionMode = 'settling'
        scheduleSlideCleanup(token, stage)
      })
    })
  }, [value])

  const changeView = (nextValue: ApplicationPipelineViewMode) => {
    if (optimisticValue === nextValue) return
    setOptimisticValue(nextValue)

    if (value === nextValue) {
      if (pendingValueRef.current && pendingValueRef.current !== nextValue) {
        cancelPendingChange()
        // The prior transition update has already been enqueued. Add the
        // latest intent to the same lane so an uncommitted destination cannot
        // arrive after the user has reversed back to the current view.
        startTransition(() => onChange(nextValue))
      }
      return
    }
    if (typeof document === 'undefined' || prefersReducedMotion()) {
      clearActiveTransition()
      onChange(nextValue)
      return
    }

    const stage = document.getElementById(controlsId)
    if (!stage) {
      onChange(nextValue)
      return
    }
    const token = String(++pipelineViewTransitionSequence)

    supersedeActiveTransition(stage)
    activeTokenRef.current = token
    activeStageRef.current = stage
    pendingValueRef.current = nextValue
    stage.dataset.applicationPipelineTransitionToken = token
    stage.dataset.applicationPipelineTransitionDirection = nextValue === 'table' ? 'to-table' : 'to-board'
    stage.dataset.applicationPipelineTransitionMode = 'preparing'
    stage.dataset.applicationPipelineBusyToken = token
    stage.setAttribute('aria-busy', 'true')
    const scrollOwner = getPipelineScrollOwner(stage)
    scrollSnapshotRef.current = { owner: scrollOwner, top: scrollOwner.scrollTop, token }

    // The button and indicator respond immediately, while the expensive
    // Activity handoff stays interruptible and keeps the outgoing view painted
    // until React has the destination ready to commit.
    startTransition(() => onChange(nextValue))
  }

  return (
    <div
      className="application-pipeline-view-switch"
      data-view={optimisticValue}
      data-pipeline-scope={scope}
      role="group"
      aria-label={label}
    >
      <span className="application-pipeline-view-indicator" aria-hidden="true" />
      <button
        type="button"
        className={optimisticValue === 'board' ? 'active' : ''}
        title={boardLabel}
        aria-label={boardLabel}
        aria-pressed={optimisticValue === 'board'}
        aria-controls={controlsId}
        onPointerEnter={() => onPrepare?.('board')}
        onFocus={() => onPrepare?.('board')}
        onClick={() => changeView('board')}
      >
        <LayoutGrid size={14} aria-hidden="true" />
        <span>{boardLabel}</span>
      </button>
      <button
        type="button"
        className={optimisticValue === 'table' ? 'active' : ''}
        title={tableLabel}
        aria-label={tableLabel}
        aria-pressed={optimisticValue === 'table'}
        aria-controls={controlsId}
        onPointerEnter={() => onPrepare?.('table')}
        onFocus={() => onPrepare?.('table')}
        onClick={() => changeView('table')}
      >
        <Table2 size={14} aria-hidden="true" />
        <span>{tableLabel}</span>
      </button>
    </div>
  )
}
