export const STACKED_CARD_WHEEL_THRESHOLD = 48
export const STACKED_CARD_WHEEL_IDLE_MS = 140
export const STACKED_CARD_WHEEL_MAX_EVENT_DELTA = 120

export type StackedCardWheelDirection = 1 | -1

export type StackedCardWheelState = {
  delta: number
  lastEventAt?: number
  lastAbsDelta?: number
  lastDirection?: StackedCardWheelDirection
  turnTriggered?: boolean
}

export function createStackedCardWheelState(): StackedCardWheelState {
  return { delta: 0 }
}

export function normalizeStackedCardWheelDelta(
  deltaY: number,
  deltaMode: number,
  pageSize: number,
) {
  const unit = deltaMode === 1
    ? 16
    : deltaMode === 2
      ? Math.max(1, pageSize)
      : 1
  return deltaY * unit
}

/**
 * Classifies one normalized wheel sample and mutates the supplied ref-backed
 * burst state. Keeping this allocation-free matters because trackpads can send
 * dozens of samples per frame.
 */
export function consumeStackedCardWheelDelta(
  state: StackedCardWheelState,
  normalizedDelta: number,
  eventAt: number,
): StackedCardWheelDirection | 0 {
  if (!Number.isFinite(normalizedDelta) || normalizedDelta === 0) return 0

  const elapsed = state.lastEventAt === undefined
    ? Number.POSITIVE_INFINITY
    : eventAt - state.lastEventAt
  const beginsNewBurst = elapsed < 0 || elapsed >= STACKED_CARD_WHEEL_IDLE_MS
  const boundedDelta = Math.max(
    -STACKED_CARD_WHEEL_MAX_EVENT_DELTA,
    Math.min(STACKED_CARD_WHEEL_MAX_EVENT_DELTA, normalizedDelta),
  )
  const inputDirection: StackedCardWheelDirection = boundedDelta > 0 ? 1 : -1
  const changesDirection = Boolean(
    state.lastDirection && state.lastDirection !== inputDirection,
  )

  if (beginsNewBurst || changesDirection) {
    state.delta = 0
    state.turnTriggered = false
    state.lastAbsDelta = undefined
  }

  const absoluteDelta = Math.abs(boundedDelta)
  const isDecayingMomentum = Boolean(
    state.turnTriggered
    && !beginsNewBurst
    && !changesDirection
    && state.lastAbsDelta !== undefined
    && absoluteDelta < state.lastAbsDelta,
  )

  state.lastEventAt = eventAt
  state.lastDirection = inputDirection
  state.lastAbsDelta = absoluteDelta
  if (isDecayingMomentum) return 0

  state.delta += boundedDelta
  if (Math.abs(state.delta) < STACKED_CARD_WHEEL_THRESHOLD) return 0

  const direction: StackedCardWheelDirection = state.delta > 0 ? 1 : -1
  // Keep only the sub-step remainder. The deck controller independently bounds
  // playback to one active turn plus one pending turn.
  state.delta -= direction * STACKED_CARD_WHEEL_THRESHOLD
  state.turnTriggered = true
  return direction
}
