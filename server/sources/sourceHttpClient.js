import { withAbortDeadline } from '../abortDeadline.js'
import { cancelResponseBody, readBoundedResponseText } from '../boundedResponse.js'
import { pinnedHttpsFetch } from '../pinnedHttpsFetch.js'
import { SourceHttpError, SourceParseError } from './sourceErrors.js'

const DEFAULT_MAX_RESPONSE_BYTES = 16 * 1024 * 1024
const DEFAULT_MAX_CACHE_ENTRIES = 256

function normalizedNow(value) {
  if (typeof value === 'function') return value
  if (typeof value === 'number') {
    const fixed = value
    return () => fixed
  }
  return Date.now
}

function retryDelayMs(response, attempt, retry) {
  const raw = String(response?.headers?.get?.('retry-after') ?? '').trim()
  let delay = null
  if (/^\d+$/.test(raw)) delay = Number(raw) * 1_000
  else if (raw) {
    const timestamp = Date.parse(raw)
    if (Number.isFinite(timestamp)) delay = Math.max(0, timestamp - Date.now())
  }
  if (delay === null) delay = Number(retry?.baseDelayMs ?? 250) * (2 ** attempt)
  return Math.min(Number(retry?.maxDelayMs ?? 10_000), Math.max(0, delay))
}

function cacheValue(response, fetchedAt, requestUrl) {
  return {
    status: response.status,
    text: response.text,
    sourceUrl: response.url || requestUrl,
    fetchedAt: new Date(fetchedAt).toISOString(),
    fetchedAtMs: fetchedAt,
  }
}

export function createSemaphore(maxConcurrency) {
  const maximum = Math.max(1, Math.floor(Number(maxConcurrency) || 1))
  let active = 0
  const waiters = []
  const acquire = () => new Promise((resolve) => {
    if (active < maximum) {
      active += 1
      resolve()
      return
    }
    waiters.push(resolve)
  })
  const release = () => {
    const next = waiters.shift()
    if (next) {
      next()
      return
    }
    active -= 1
  }
  return async function withLimit(operation) {
    await acquire()
    try {
      return await operation()
    } finally {
      release()
    }
  }
}

export function createOriginScheduler({
  minIntervalMs = 0,
  now = Date.now,
  delayFn = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  const tails = new Map()
  const nextRequestAt = new Map()
  const interval = Math.max(0, Number(minIntervalMs) || 0)
  async function schedule(value, operation) {
    const origin = new URL(String(value)).origin
    const previous = tails.get(origin) || Promise.resolve()
    let release
    const tail = new Promise((resolve) => {
      release = resolve
    })
    tails.set(origin, tail)
    try {
      await previous.catch(() => {})
      const remaining = Math.max(0, (nextRequestAt.get(origin) || 0) - now())
      if (remaining > 0) await delayFn(remaining)
      return await operation()
    } finally {
      nextRequestAt.set(origin, now() + interval)
      release()
      if (tails.get(origin) === tail) tails.delete(origin)
    }
  }
  schedule.defer = (value, delayMs) => {
    const origin = new URL(String(value)).origin
    nextRequestAt.set(origin, Math.max(nextRequestAt.get(origin) || 0, now() + Math.max(0, delayMs)))
  }
  return schedule
}

function createRequestScheduler(source, options) {
  if (options.scheduler) return options.scheduler
  const rateLimitPerMin = Math.max(1, Number(source?.rateLimitPerMin) || 30)
  return createOriginScheduler({
    minIntervalMs: 60_000 / rateLimitPerMin,
    now: options.now,
    delayFn: options.delayFn,
  })
}

function pruneCache(cache, maximum) {
  while (cache.size > maximum) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) return
    cache.delete(oldest)
  }
}

/**
 * Shared HTTP layer for Phase 12 sources. Caching, per-source rate limiting,
 * global concurrency, timeout, and retry are all owned here so adapters only
 * describe a request and parse a response.
 */
export function createSourceHttpClient({
  fetchImpl,
  cache = new Map(),
  maxConcurrency = 4,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  now = Date.now,
  delayFn,
  scheduler,
} = {}) {
  const clock = normalizedNow(now)
  const requestDelay = delayFn || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  const selectedFetch = typeof fetchImpl === 'function'
    ? fetchImpl
    : (process.env.NODE_ENV === 'production' ? pinnedHttpsFetch : globalThis.fetch)
  const limiter = createSemaphore(maxConcurrency)
  const schedulers = new Map()
  const inFlightCacheMisses = new Map()

  function schedulerFor(sourceConfig) {
    if (scheduler) return scheduler
    const rateLimitPerMin = Math.max(1, Number(sourceConfig?.rateLimitPerMin) || 30)
    const key = `${sourceConfig?.id || 'anonymous'}:${rateLimitPerMin}`
    let selected = schedulers.get(key)
    if (!selected) {
      selected = createRequestScheduler(sourceConfig, { now: clock, delayFn: requestDelay })
      schedulers.set(key, selected)
    }
    return selected
  }

  async function request(url, {
    source,
    method = 'GET',
    headers = {},
    body,
    cacheKey,
    timeoutMs,
    cacheTtlMs,
    retry,
  } = {}) {
    const requestUrl = String(url)
    const parsedUrl = new URL(requestUrl)
    if (parsedUrl.protocol !== 'https:') {
      const error = new TypeError(`Phase 12 sources require HTTPS URLs: ${requestUrl}`)
      error.code = 'SOURCE_NON_HTTPS_URL'
      throw error
    }
    const sourceConfig = source || {}
    const effectiveRetry = retry || sourceConfig.retry || {
      maxAttempts: 3,
      baseDelayMs: 250,
      maxDelayMs: 10_000,
      retryableStatuses: [429, 502, 503, 504],
      retryNetworkErrors: true,
    }
    const ttl = Number(cacheTtlMs ?? sourceConfig.cacheTtlMs ?? 0)
    const key = cacheKey || `${method}:${requestUrl}:${body === undefined ? '' : body}`
    const cached = ttl > 0 ? cache.get(key) : null
    if (cached && clock() - cached.fetchedAtMs < ttl) {
      return { ...cached, cacheKey: key, cached: true }
    }

    const execute = async () => {
      const sourceScheduler = schedulerFor(sourceConfig)
      const retryableStatuses = new Set(effectiveRetry.retryableStatuses || [429, 502, 503, 504])
      let lastError = null
      let response = null

      for (let attempt = 0; attempt < Number(effectiveRetry.maxAttempts || 1); attempt += 1) {
        try {
          const executed = await sourceScheduler(requestUrl, () => limiter(() => withAbortDeadline(async (signal) => {
            const fetched = await selectedFetch(requestUrl, {
              method,
              headers: {
                'user-agent': sourceConfig.userAgent || 'PhDAtlasPhase12/0.1',
                accept: 'application/json,text/plain;q=0.9,*/*;q=0.1',
                ...headers,
              },
              body,
              signal,
            })
            if (!fetched.ok) {
              await cancelResponseBody(fetched)
              return { response: fetched, text: '' }
            }
            const text = await readBoundedResponseText(fetched, {
              maxBytes: maxResponseBytes,
              signal,
              bodyKind: `${sourceConfig.id || 'source'} response`,
            })
            return { response: fetched, text }
          }, { timeoutMs: Number(timeoutMs ?? sourceConfig.timeoutMs ?? 20_000) })))
          response = executed.response
          if (response.ok) {
            const entry = cacheValue({ ...executed, url: response.url || requestUrl }, clock(), requestUrl)
            if (ttl > 0) {
              cache.set(key, entry)
              pruneCache(cache, DEFAULT_MAX_CACHE_ENTRIES)
            }
            return { ...entry, cacheKey: key, cached: false }
          }
          if (retryableStatuses.has(response.status) && attempt + 1 < Number(effectiveRetry.maxAttempts || 1)) {
            const delay = retryDelayMs(response, attempt, effectiveRetry)
            sourceScheduler.defer(requestUrl, delay)
            await requestDelay(delay)
            continue
          }
          throw new SourceHttpError(response.status, requestUrl)
        } catch (error) {
          const isDeadline = error?.name === 'AbortDeadlineError' || error?.name === 'AbortError'
          const retryNetwork = effectiveRetry.retryNetworkErrors !== false
          lastError = error
          if (error instanceof SourceHttpError || isDeadline || !retryNetwork || attempt + 1 >= Number(effectiveRetry.maxAttempts || 1)) {
            throw error
          }
          const delay = retryDelayMs(null, attempt, effectiveRetry)
          sourceScheduler.defer(requestUrl, delay)
          await requestDelay(delay)
        }
      }
      if (lastError) throw lastError
      throw new Error('Phase 12 source request ended without a response.')
    }

    const coalescingKey = method.toUpperCase() === 'GET' && ttl > 0 ? key : null
    if (!coalescingKey) return execute()
    const existing = inFlightCacheMisses.get(coalescingKey)
    if (existing) return existing

    const pending = execute()
    inFlightCacheMisses.set(coalescingKey, pending)
    try {
      return await pending
    } finally {
      if (inFlightCacheMisses.get(coalescingKey) === pending) {
        inFlightCacheMisses.delete(coalescingKey)
      }
    }
  }

  return {
    async fetchText(url, options = {}) {
      return request(url, options)
    },
    async fetchJson(url, options = {}) {
      const fetched = await request(url, options)
      let json
      try {
        json = JSON.parse(fetched.text)
      } catch (error) {
        throw new SourceParseError(
          `Failed to parse JSON from ${url} for ${options.source?.id || 'source'}.`,
          options.source?.id || '',
          error,
        )
      }
      return { ...fetched, json }
    },
  }
}
