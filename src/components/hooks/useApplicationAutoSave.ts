import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApplicationRecord } from '../../data/applications'

export type ApplicationAutoSaveIntent = 'settled' | 'immediate'

export type ApplicationAutoSaveResult =
  | { status: 'saved' | 'queued' }
  | { status: 'ignored' | 'error'; message?: string }

export type ApplicationAutoSaveStatus =
  | { phase: 'idle' | 'pending' | 'saving' | 'saved' | 'queued' }
  | { phase: 'error'; message?: string; retryable: boolean }

const DEFAULT_SETTLE_MS = 1_200
const DEFAULT_MAX_WAIT_MS = 8_000
const SAVED_VISIBLE_MS = 1_800
const QUEUED_VISIBLE_MS = 4_000

type SaveToken = number

function clearTimer(timerRef: { current: number | null }) {
  if (timerRef.current === null) return
  window.clearTimeout(timerRef.current)
  timerRef.current = null
}

/**
 * Owns the one application-draft autosave lifecycle for the mounted workspace.
 * Text bursts settle into one write, deterministic controls can flush
 * immediately, and edits made during an in-flight write become one trailing
 * save instead of one request per render.
 */
export function useApplicationAutoSave({
  enabled,
  persist,
  settleMs = DEFAULT_SETTLE_MS,
  maxWaitMs = DEFAULT_MAX_WAIT_MS,
}: {
  enabled: boolean
  persist: (application: ApplicationRecord) => Promise<ApplicationAutoSaveResult>
  settleMs?: number
  maxWaitMs?: number
}) {
  const [status, setStatus] = useState<ApplicationAutoSaveStatus>({ phase: 'idle' })
  const enabledRef = useRef(enabled)
  const persistRef = useRef(persist)
  const pendingRef = useRef<ApplicationRecord | null>(null)
  const inFlightRef = useRef<Promise<boolean> | null>(null)
  const lastResultRef = useRef(true)
  const debounceTimerRef = useRef<number | null>(null)
  const maxWaitTimerRef = useRef<number | null>(null)
  const immediateTimerRef = useRef<number | null>(null)
  const hideTimerRef = useRef<number | null>(null)
  const saveTokenRef = useRef(0)
  const generationRef = useRef(0)
  const flushRef = useRef<(drain: boolean) => Promise<boolean>>(async () => true)

  enabledRef.current = enabled
  persistRef.current = persist

  const clearSchedule = useCallback(() => {
    clearTimer(debounceTimerRef)
    clearTimer(maxWaitTimerRef)
    clearTimer(immediateTimerRef)
  }, [])

  const clearHide = useCallback(() => {
    clearTimer(hideTimerRef)
  }, [])

  const beginSave = useCallback((): SaveToken => {
    clearHide()
    saveTokenRef.current += 1
    setStatus({ phase: 'saving' })
    return saveTokenRef.current
  }, [clearHide])

  const finishSave = useCallback((
    token: SaveToken,
    result: ApplicationAutoSaveResult,
    retryable = false,
  ) => {
    if (saveTokenRef.current !== token) return
    clearHide()

    if (result.status === 'ignored') {
      setStatus({ phase: 'idle' })
      return
    }

    if (result.status === 'error') {
      setStatus({ phase: 'error', message: result.message, retryable })
      return
    }

    if (pendingRef.current) {
      setStatus({ phase: 'pending' })
      return
    }

    setStatus({ phase: result.status })
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null
      if (saveTokenRef.current === token) setStatus({ phase: 'idle' })
    }, result.status === 'queued' ? QUEUED_VISIBLE_MS : SAVED_VISIBLE_MS)
  }, [clearHide])

  const failSave = useCallback((token: SaveToken, message?: string) => {
    finishSave(token, { status: 'error', message }, false)
  }, [finishSave])

  const flush = useCallback((drain = true) => flushRef.current(drain), [])

  flushRef.current = async (drain: boolean) => {
    if (!enabledRef.current) return false
    clearSchedule()

    const inFlight = inFlightRef.current
    if (inFlight) {
      const saved = await inFlight
      if (!saved) return false
      return pendingRef.current ? flushRef.current(drain) : saved
    }

    const application = pendingRef.current
    if (!application) return lastResultRef.current
    pendingRef.current = null

    const token = beginSave()
    const generation = generationRef.current
    const task = (async () => {
      let result: ApplicationAutoSaveResult
      try {
        result = await persistRef.current(application)
      } catch {
        result = {
          status: 'error',
        }
      }

      if (generationRef.current !== generation) return true

      const saved = result.status === 'saved' || result.status === 'queued'
      lastResultRef.current = saved
      if (!saved && !pendingRef.current) pendingRef.current = application
      finishSave(token, result, !saved)
      return saved
    })()

    inFlightRef.current = task
    const saved = await task
    if (inFlightRef.current === task) inFlightRef.current = null
    if (!saved) return false
    return drain && pendingRef.current ? flushRef.current(true) : true
  }

  const schedule = useCallback((
    application: ApplicationRecord,
    intent: ApplicationAutoSaveIntent = 'settled',
  ) => {
    if (!enabledRef.current) return
    pendingRef.current = application
    lastResultRef.current = true
    clearHide()
    if (!inFlightRef.current) setStatus({ phase: 'pending' })

    clearTimer(debounceTimerRef)
    if (intent === 'immediate') {
      clearTimer(maxWaitTimerRef)
      clearTimer(immediateTimerRef)
      immediateTimerRef.current = window.setTimeout(() => {
        immediateTimerRef.current = null
        void flushRef.current(false)
      }, 0)
      return
    }

    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null
      void flushRef.current(false)
    }, settleMs)
    if (maxWaitTimerRef.current === null) {
      maxWaitTimerRef.current = window.setTimeout(() => {
        maxWaitTimerRef.current = null
        void flushRef.current(false)
      }, maxWaitMs)
    }
  }, [clearHide, maxWaitMs, settleMs])

  const reset = useCallback(() => {
    clearSchedule()
    clearHide()
    pendingRef.current = null
    lastResultRef.current = true
    generationRef.current += 1
    saveTokenRef.current += 1
    setStatus((current) => current.phase === 'idle' ? current : { phase: 'idle' })
  }, [clearHide, clearSchedule])

  const retainFailedDraft = useCallback((
    application: ApplicationRecord,
    message?: string,
  ) => {
    clearSchedule()
    clearHide()
    pendingRef.current = application
    lastResultRef.current = false
    saveTokenRef.current += 1
    setStatus({ phase: 'error', message, retryable: true })
  }, [clearHide, clearSchedule])

  const retry = useCallback(() => flush(true), [flush])

  useEffect(() => {
    enabledRef.current = enabled
    if (!enabled) reset()
  }, [enabled, reset])

  useEffect(() => {
    const flushBeforeBackground = () => {
      if (document.visibilityState === 'hidden' && pendingRef.current) {
        void flushRef.current(false)
      }
    }
    const flushBeforePageHide = () => {
      if (pendingRef.current) void flushRef.current(false)
    }
    document.addEventListener('visibilitychange', flushBeforeBackground)
    window.addEventListener('pagehide', flushBeforePageHide)
    return () => {
      document.removeEventListener('visibilitychange', flushBeforeBackground)
      window.removeEventListener('pagehide', flushBeforePageHide)
    }
  }, [])

  useEffect(() => () => {
    clearSchedule()
    clearHide()
    pendingRef.current = null
    generationRef.current += 1
    saveTokenRef.current += 1
  }, [clearHide, clearSchedule])

  return {
    status,
    schedule,
    flush,
    retry,
    reset,
    retainFailedDraft,
    beginExternalSave: beginSave,
    finishExternalSave: finishSave,
    failExternalSave: failSave,
  }
}
