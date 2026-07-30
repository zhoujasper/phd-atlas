export class AbortDeadlineError extends Error {
  constructor(timeoutMs, cause) {
    super(`Operation exceeded its ${timeoutMs}ms deadline.`, { cause })
    this.name = 'AbortDeadlineError'
    this.code = 'ABORT_DEADLINE_EXCEEDED'
    this.timeoutMs = timeoutMs
  }
}

function normalizedTimeout(timeoutMs) {
  const value = Number(timeoutMs)
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : null
}

function parentAbortReason(signal, fallback) {
  return signal?.reason ?? fallback
}

/**
 * Runs an async operation with one composed lifecycle signal.
 *
 * A parent cancellation keeps its original reason. An elapsed deadline becomes
 * an explicit AbortDeadlineError, allowing callers to distinguish user/server
 * cancellation from a slow upstream. The timer is always cleared and unref'd
 * so abandoned network deadlines cannot keep the server process alive.
 */
export async function withAbortDeadline(
  operation,
  { signal: parentSignal, timeoutMs } = {},
) {
  if (parentSignal?.aborted) {
    throw parentAbortReason(parentSignal, new Error('The operation was aborted.'))
  }

  const controller = new AbortController()
  const deadlineMs = normalizedTimeout(timeoutMs)
  let abortCause = null
  let timer = null
  let rejectCancellation
  const cancellation = new Promise((_, reject) => {
    rejectCancellation = reject
  })

  const abortFromParent = () => {
    if (abortCause !== null) return
    abortCause = 'parent'
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    const reason = parentAbortReason(parentSignal, new Error('The operation was aborted.'))
    rejectCancellation(reason)
    controller.abort(reason)
  }
  parentSignal?.addEventListener('abort', abortFromParent, { once: true })

  if (deadlineMs !== null) {
    timer = setTimeout(() => {
      if (abortCause !== null) return
      abortCause = 'timeout'
      const error = new AbortDeadlineError(deadlineMs)
      rejectCancellation(error)
      controller.abort(error)
    }, deadlineMs)
    timer.unref?.()
  }

  try {
    const operationPromise = Promise.resolve().then(() => operation(controller.signal))
    return await Promise.race([operationPromise, cancellation])
  } catch (error) {
    if (error instanceof AbortDeadlineError) throw error
    if (abortCause === 'timeout') throw new AbortDeadlineError(deadlineMs, error)
    if (abortCause === 'parent' || parentSignal?.aborted) {
      throw parentAbortReason(parentSignal, error)
    }
    throw error
  } finally {
    if (timer !== null) clearTimeout(timer)
    parentSignal?.removeEventListener('abort', abortFromParent)
  }
}
