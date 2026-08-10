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
  let activeController = null
  let stopped = false

  const runNow = async ({ signal } = {}) => {
    if (stopped || activeRun) return false

    const controller = new AbortController()
    activeController = controller
    const forwardAbort = () => {
      if (!controller.signal.aborted) controller.abort(signal?.reason)
    }
    if (signal?.aborted) {
      forwardAbort()
    } else {
      signal?.addEventListener?.('abort', forwardAbort, { once: true })
    }

    const currentRun = Promise.resolve()
      .then(() => run(controller.signal))
      .catch((error) => {
        try {
          onError(error)
        } catch {
          // Error reporting must never turn a handled task failure into an
          // unhandled rejection or prevent the next scheduled run.
        }
      })
      .finally(() => {
        signal?.removeEventListener?.('abort', forwardAbort)
        if (activeRun === currentRun) {
          activeRun = null
          activeController = null
        }
      })
    activeRun = currentRun
    try {
      await currentRun
    } catch {
      // currentRun contains task and reporter failures. Keep this final guard
      // so a future cleanup change cannot leak a detached rejection.
    }
    return true
  }

  const timer = timers.setInterval(() => {
    void runNow()
  }, delay)
  timer?.unref?.()

  const stop = (reason) => {
    if (stopped) return
    stopped = true
    timers.clearInterval(timer)
    activeController?.abort(reason)
  }

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
    stop,
    async stopAndWait(reason) {
      stop(reason)
      const running = activeRun
      if (!running) return
      try {
        await running
      } catch {
        // runNow already contains task failures and invokes onError.
      }
    },
  }
}
