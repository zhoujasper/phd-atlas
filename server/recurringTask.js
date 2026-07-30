/**
 * Starts one interval-driven asynchronous task with a strict no-overlap
 * boundary. Slow filesystem, IMAP, SMTP, or database work can therefore skip
 * a tick without building a duplicate queue behind the active run.
 */
export function startNonOverlappingRecurringTask({
  intervalMs,
  run,
  onError = () => {},
  timers = globalThis,
}) {
  const delay = Number(intervalMs)
  if (!Number.isFinite(delay) || delay <= 0) {
    throw new TypeError('Recurring task intervalMs must be a positive finite number.')
  }
  if (typeof run !== 'function') {
    throw new TypeError('Recurring task run must be a function.')
  }

  let activeRun = null
  let stopped = false

  const runNow = async () => {
    if (stopped || activeRun) return false

    activeRun = Promise.resolve().then(run)
    try {
      await activeRun
    } catch (error) {
      try {
        onError(error)
      } catch {
        // Error reporting must never turn a handled task failure into an
        // unhandled rejection or prevent the next scheduled run.
      }
    } finally {
      activeRun = null
    }
    return true
  }

  const timer = timers.setInterval(() => {
    void runNow()
  }, delay)
  timer?.unref?.()

  return {
    runNow,
    isRunning: () => activeRun !== null,
    async whenIdle() {
      if (!activeRun) return
      try {
        await activeRun
      } catch {
        // runNow already contains task failures and invokes onError.
      }
    },
    stop() {
      if (stopped) return
      stopped = true
      timers.clearInterval(timer)
    },
    async stopAndWait() {
      if (!stopped) {
        stopped = true
        timers.clearInterval(timer)
      }
      if (!activeRun) return
      try {
        await activeRun
      } catch {
        // runNow already contains task failures and invokes onError.
      }
    },
  }
}
