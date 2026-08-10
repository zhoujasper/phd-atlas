import type { SystemUpdateStatus } from '../api/phdApi'

export const SYSTEM_UPDATE_STEP_ORDER = [
  'resolving',
  'probing',
  'downloading',
  'verifying',
  'preparing',
  'installing',
  'restarting',
] as const satisfies readonly SystemUpdateStatus['phase'][]

type SystemUpdatePhase = SystemUpdateStatus['phase']

export type SystemUpdateTimelineState = {
  operationKey: string | null
  phase: SystemUpdatePhase
  progress: number
  stepIndex: number
}

export const INITIAL_SYSTEM_UPDATE_TIMELINE: SystemUpdateTimelineState = {
  operationKey: null,
  phase: 'idle',
  progress: 0,
  stepIndex: -1,
}

const ACTIVE_PHASES = new Set<SystemUpdatePhase>(SYSTEM_UPDATE_STEP_ORDER)
const SUCCESS_PHASES = new Set<SystemUpdatePhase>(['ready', 'stored'])
const FAILURE_PHASES = new Set<SystemUpdatePhase>(['error', 'timeout'])

// These bands describe job stages, not made-up byte completion. The only
// continuously varying band is download, where the server supplies real bytes.
const FIXED_PHASE_PROGRESS: Partial<Record<SystemUpdatePhase, number>> = {
  resolving: 4,
  probing: 12,
  verifying: 68,
  preparing: 76,
  installing: 86,
  restarting: 94,
  ready: 100,
  stored: 100,
}
const DOWNLOAD_STAGE_START = 18
const DOWNLOAD_STAGE_SPAN = 44

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function getSystemUpdateDownloadProgress(status: SystemUpdateStatus | null) {
  if (
    status?.phase !== 'downloading'
    || !Number.isFinite(status.bytes)
    || !Number.isFinite(status.total)
    || status.total <= 0
  ) {
    return null
  }

  return clamp((status.bytes / status.total) * 100, 0, 100)
}

export function getSystemUpdateTimelineCandidate(status: SystemUpdateStatus | null) {
  if (!status || status.phase === 'idle' || FAILURE_PHASES.has(status.phase)) return null
  if (status.phase === 'downloading') {
    const downloadProgress = getSystemUpdateDownloadProgress(status) ?? 0
    return DOWNLOAD_STAGE_START + ((downloadProgress / 100) * DOWNLOAD_STAGE_SPAN)
  }
  return FIXED_PHASE_PROGRESS[status.phase] ?? null
}

function getOperationKey(status: SystemUpdateStatus) {
  if (status.targetVersion) return `version:${status.targetVersion}`
  if (status.jobId) return `job:${status.jobId}`
  if (status.requestedAt) return `requested:${status.requestedAt}`
  return null
}

function statesEqual(left: SystemUpdateTimelineState, right: SystemUpdateTimelineState) {
  return left.operationKey === right.operationKey
    && left.phase === right.phase
    && left.progress === right.progress
    && left.stepIndex === right.stepIndex
}

/**
 * Advances the visual job timeline without ever rewinding an in-flight job.
 * A retry may truthfully reset the separate byte percentage, while the overall
 * stage rail holds its last committed position. Failure/timeout likewise stay
 * at the last known stage instead of pretending the job failed at 0%.
 */
export function advanceSystemUpdateTimeline(
  previous: SystemUpdateTimelineState,
  status: SystemUpdateStatus | null,
): SystemUpdateTimelineState {
  if (!status || status.phase === 'idle') return INITIAL_SYSTEM_UPDATE_TIMELINE

  const operationKey = getOperationKey(status)
  const active = ACTIVE_PHASES.has(status.phase)
  const succeeded = SUCCESS_PHASES.has(status.phase)
  const failed = FAILURE_PHASES.has(status.phase)
  const previousFinished = previous.phase === 'idle'
    || SUCCESS_PHASES.has(previous.phase)
    || FAILURE_PHASES.has(previous.phase)
  const operationChanged = Boolean(
    operationKey
    && previous.operationKey
    && operationKey !== previous.operationKey,
  )
  const startsNewOperation = active && (previousFinished || operationChanged)
  const candidate = getSystemUpdateTimelineCandidate(status)

  const progress = failed
    ? previous.progress
    : startsNewOperation
      ? candidate ?? 0
      : Math.max(previous.progress, candidate ?? previous.progress)

  const currentStepIndex = SYSTEM_UPDATE_STEP_ORDER.indexOf(
    status.phase as (typeof SYSTEM_UPDATE_STEP_ORDER)[number],
  )
  const stepIndex = failed
    ? previous.stepIndex
    : succeeded
      ? SYSTEM_UPDATE_STEP_ORDER.length
      : currentStepIndex

  const next: SystemUpdateTimelineState = {
    operationKey: startsNewOperation
      ? operationKey
      : operationKey ?? previous.operationKey,
    phase: status.phase,
    progress,
    stepIndex,
  }

  return statesEqual(previous, next) ? previous : next
}
