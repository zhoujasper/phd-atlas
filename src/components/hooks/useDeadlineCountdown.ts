import { useState } from 'react'
import { useVisibilityAwarePolling } from './useVisibilityAwarePolling'

type CountdownSnapshot = {
  deadlineAt: number | null
  remainingSeconds: number
}

function normalizeDeadline(value: number | string | null | undefined) {
  if (value == null) return null
  const parsed = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function deadlineRemainingSeconds(deadlineAt: number | null, now = Date.now()) {
  if (deadlineAt === null) return 0
  return Math.max(0, Math.ceil((deadlineAt - now) / 1_000))
}

/**
 * Maintains a wall-clock countdown with one update per displayed second.
 * Hidden/offline time does not consume timers; resuming derives the current
 * value from the deadline instead of replaying missed ticks.
 */
export function useDeadlineCountdown(deadline: number | string | null | undefined) {
  const deadlineAt = normalizeDeadline(deadline)
  const [snapshot, setSnapshot] = useState<CountdownSnapshot>(() => ({
    deadlineAt,
    remainingSeconds: deadlineRemainingSeconds(deadlineAt),
  }))

  const currentRemaining = snapshot.deadlineAt === deadlineAt
    ? snapshot.remainingSeconds
    : deadlineRemainingSeconds(deadlineAt)

  useVisibilityAwarePolling({
    enabled: deadlineAt !== null,
    intervalMs: 1_000,
    pauseWhenServerUnavailable: false,
    restartKey: deadlineAt,
    poll: () => {
      const now = Date.now()
      const remainingSeconds = deadlineRemainingSeconds(deadlineAt, now)
      setSnapshot((current) => (
        current.deadlineAt === deadlineAt && current.remainingSeconds === remainingSeconds
          ? current
          : { deadlineAt, remainingSeconds }
      ))
      if (remainingSeconds <= 0 || deadlineAt === null) return false

      // Wake just after the next visible whole-second boundary. This avoids
      // four-times-per-second render loops while keeping the label exact.
      const remainingMs = deadlineAt - now
      const nextBoundaryMs = remainingMs - (remainingSeconds - 1) * 1_000
      return Math.max(16, Math.min(1_000, nextBoundaryMs + 1))
    },
  })

  return currentRemaining
}
