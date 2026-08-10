type SharedReadEntry = {
  controller: AbortController
  invalidationListeners: Set<(reason: Error) => void>
  orphanAbortScheduled: boolean
  promise: Promise<unknown>
  settled: boolean
  subscribers: number
}

export class SharedReadInvalidatedError extends Error {
  constructor() {
    super('The shared read was invalidated by newer data.')
    this.name = 'SharedReadInvalidatedError'
  }
}

function abortReason(signal: AbortSignal) {
  if (signal.reason !== undefined) return signal.reason
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

/**
 * Coalesces identical reads while preserving cancellation ownership.
 *
 * Every caller is an independent subscriber. Cancelling one subscriber does
 * not interrupt another; once the final subscriber leaves, the shared
 * transport is aborted after one microtask. That bounded handoff lets React's
 * development-only effect cleanup/remount rejoin the same transport without
 * issuing a duplicate request. Starters must honor the supplied signal.
 */
export class SharedReadCoordinator {
  private readonly entries = new Map<string, SharedReadEntry>()

  run<T>(
    key: string,
    start: (signal: AbortSignal) => Promise<T>,
    subscriberSignal?: AbortSignal,
  ): Promise<T> {
    if (subscriberSignal?.aborted) {
      return Promise.reject(abortReason(subscriberSignal))
    }

    let entry = this.entries.get(key)
    if (!entry) {
      const controller = new AbortController()
      let resolveStart!: (value: unknown) => void
      let rejectStart!: (error: unknown) => void
      const promise = new Promise<unknown>((resolve, reject) => {
        resolveStart = resolve
        rejectStart = reject
      })
      entry = {
        controller,
        invalidationListeners: new Set(),
        orphanAbortScheduled: false,
        promise,
        settled: false,
        subscribers: 0,
      }
      this.entries.set(key, entry)
      const createdEntry = entry
      try {
        void Promise.resolve(start(controller.signal)).then(resolveStart, rejectStart)
      } catch (error) {
        rejectStart(error)
      }
      void createdEntry.promise.then(
        () => this.finish(key, createdEntry),
        () => this.finish(key, createdEntry),
      )
    }

    entry.orphanAbortScheduled = false
    entry.subscribers += 1
    const subscribedEntry = entry

    return new Promise<T>((resolve, reject) => {
      let released = false

      const release = () => {
        if (released) return
        released = true
        subscriberSignal?.removeEventListener('abort', handleAbort)
        subscribedEntry.invalidationListeners.delete(handleInvalidation)
        subscribedEntry.subscribers = Math.max(0, subscribedEntry.subscribers - 1)
        if (subscribedEntry.subscribers > 0 || subscribedEntry.settled) return
        if (subscribedEntry.orphanAbortScheduled) return
        subscribedEntry.orphanAbortScheduled = true
        queueMicrotask(() => {
          subscribedEntry.orphanAbortScheduled = false
          if (subscribedEntry.subscribers > 0 || subscribedEntry.settled) return
          if (this.entries.get(key) !== subscribedEntry) return
          this.entries.delete(key)
          subscribedEntry.controller.abort()
        })
      }

      const handleAbort = () => {
        const reason = subscriberSignal
          ? abortReason(subscriberSignal)
          : new Error('The operation was aborted.')
        release()
        reject(reason)
      }

      const handleInvalidation = (reason: Error) => {
        release()
        reject(reason)
      }

      subscriberSignal?.addEventListener('abort', handleAbort, { once: true })
      subscribedEntry.invalidationListeners.add(handleInvalidation)
      if (subscriberSignal?.aborted) {
        handleAbort()
        return
      }
      void subscribedEntry.promise.then(
        (value) => {
          if (released) return
          release()
          resolve(value as T)
        },
        (error) => {
          if (released) return
          release()
          reject(error)
        },
      )
    })
  }

  invalidatePrefix(prefix: string) {
    for (const [key, entry] of this.entries) {
      if (!key.startsWith(prefix)) continue
      this.entries.delete(key)
      this.invalidateEntry(entry)
    }
  }

  invalidateMatching(matches: (key: string) => boolean) {
    for (const [key, entry] of this.entries) {
      if (!matches(key)) continue
      this.entries.delete(key)
      this.invalidateEntry(entry)
    }
  }

  clear(reason: Error = new SharedReadInvalidatedError()) {
    for (const entry of this.entries.values()) this.invalidateEntry(entry, reason)
    this.entries.clear()
  }

  private invalidateEntry(entry: SharedReadEntry, reason = new SharedReadInvalidatedError()) {
    if (entry.settled) return
    entry.controller.abort(reason)
    for (const invalidate of [...entry.invalidationListeners]) invalidate(reason)
    entry.invalidationListeners.clear()
  }

  private finish(key: string, entry: SharedReadEntry) {
    entry.settled = true
    if (this.entries.get(key) === entry) this.entries.delete(key)
  }
}
