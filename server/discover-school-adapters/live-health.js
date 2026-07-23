import { lookup as nodeDnsLookup } from 'node:dns/promises'
import {
  allowsDiscoverCrawl,
  isDiscoverPublicHostname,
  isDiscoverPublicNetworkTarget,
  readDiscoverResponseText,
} from '../discover-source-crawler.js'

const USER_AGENT = 'PhDAtlasAdapterHealth/1.0 (+https://phd-atlas.local/research)'
const MAX_REDIRECTS = 5
const MAX_HEALTH_CONCURRENCY = 16
const MAX_HEALTH_TIMEOUT_MS = 30_000
const MAX_PER_HOST_DELAY_MS = 60_000
const MAX_RETRIES = 3
const MAX_RETRY_DELAY_MS = 30_000

const KIND_TERMS = Object.freeze({
  faculty: [
    'faculty', 'people', 'staff', 'academic', 'professor', 'researcher', 'supervisor',
    'enseignant', 'personnel', 'mitarbeiter', 'professoren', 'docenti', 'profesores',
    'medewerkers', 'faculty members', '教师', '师资', '導師', '教員', '교수',
  ],
  departments: [
    'department', 'departments', 'school', 'faculty', 'institute', 'college',
    'département', 'faculté', 'fakultät', 'institut', 'dipartimento', 'departamento',
    '学院', '院系', '学部', '研究科', '학과',
  ],
  research: [
    'research', 'laboratory', 'laboratories', 'lab', 'group', 'centre', 'center',
    'recherche', 'laboratoire', 'forschung', 'arbeitsgruppe', 'ricerca', 'investigación',
    'onderzoek', '研究', '实验室', '實驗室', '研究室', '연구',
  ],
  doctoral: [
    'phd', 'dphil', 'doctoral', 'doctorate', 'graduate', 'postgraduate', 'studentship',
    'doctorat', 'doktorat', 'promotion', 'dottorato', 'doctorado', 'doctoraat',
    '博士', '博士課程', '博士生', '박사',
  ],
})

function cleanHost(value) {
  return String(value || '').trim().toLowerCase().replace(/^www\./, '')
}

function hostAllowed(hostname, allowedHosts) {
  const host = cleanHost(hostname)
  return (allowedHosts || []).some((value) => {
    const root = cleanHost(value)
    return root && (host === root || host.endsWith(`.${root}`))
  })
}

function safeSeedUrl(value, adapter) {
  try {
    const url = new URL(String(value || ''))
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || (url.port && url.port !== '443')
      || !isDiscoverPublicHostname(url.hostname)
    ) return null
    return hostAllowed(url.hostname, adapter.allowedHosts) ? url : null
  } catch {
    return null
  }
}

function htmlText(value) {
  return String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:nbsp|amp|quot|#39);/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function hintTerms(adapter, kind) {
  const key = { faculty: 'faculty', departments: 'department', research: 'lab', doctoral: 'program' }[kind]
  return [...new Set([...(KIND_TERMS[kind] || []), ...(adapter.pathHints?.[key] || [])])]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => value.length >= 2)
}

function semanticKindMatch(adapter, seed, finalUrl, body) {
  const signal = `${decodeURIComponent(finalUrl.pathname)} ${finalUrl.search} ${htmlText(body).slice(0, 120_000)}`.toLowerCase()
  return hintTerms(adapter, seed.kind).some((term) => signal.includes(term))
}

function abortError() {
  const error = new Error('The health-check deadline elapsed')
  error.name = 'AbortError'
  return error
}

function withDeadline(promise, { signal, deadlineAt } = {}) {
  if (signal?.aborted || (deadlineAt && Date.now() >= deadlineAt)) return Promise.reject(abortError())
  if (!signal && !deadlineAt) return Promise.resolve(promise)
  return new Promise((resolve, reject) => {
    let settled = false
    let timer = null
    const cleanup = () => {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
    }
    const finish = (handler, value) => {
      if (settled) return
      settled = true
      cleanup()
      handler(value)
    }
    const onAbort = () => finish(reject, abortError())
    signal?.addEventListener?.('abort', onAbort, { once: true })
    if (deadlineAt) timer = setTimeout(onAbort, Math.max(0, deadlineAt - Date.now()))
    Promise.resolve(promise).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    )
  })
}

function waitWithDeadline(milliseconds, { signal, deadlineAt } = {}) {
  if (signal?.aborted || (deadlineAt && Date.now() >= deadlineAt)) return Promise.reject(abortError())
  const remaining = deadlineAt ? Math.max(0, deadlineAt - Date.now()) : Number.POSITIVE_INFINITY
  const deadlineWins = Number.isFinite(remaining) && remaining <= milliseconds
  const duration = Math.max(0, Math.min(milliseconds, remaining))
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => signal?.removeEventListener?.('abort', onAbort)
    const finish = (handler, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      cleanup()
      handler(value)
    }
    const onAbort = () => finish(reject, abortError())
    const timer = setTimeout(() => (
      deadlineWins ? finish(reject, abortError()) : finish(resolve)
    ), duration)
    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(minimum, Math.min(maximum, Math.floor(parsed)))
}

function retryDelayMs(response, attempt) {
  const raw = String(response?.headers?.get?.('retry-after') || '').trim()
  let delay = null
  if (/^\d+$/.test(raw)) delay = Number(raw) * 1_000
  else if (raw) {
    const timestamp = Date.parse(raw)
    if (Number.isFinite(timestamp)) delay = Math.max(0, timestamp - Date.now())
  }
  if (delay === null) delay = 500 * (2 ** attempt)
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, delay))
}

/** Serialize every request to the same origin and leave a courteous gap. */
function createOriginScheduler(perHostDelayMs) {
  const tails = new Map()
  const nextRequestAt = new Map()
  const schedule = async (value, operation, deadline = {}) => {
    const origin = new URL(value).origin
    const previous = tails.get(origin) || Promise.resolve()
    let release
    let released = false
    const tail = new Promise((resolve) => { release = resolve })
    const releaseTurn = () => {
      if (released) return
      released = true
      release()
      if (tails.get(origin) === tail) tails.delete(origin)
    }
    const finishTurn = () => {
      nextRequestAt.set(origin, Date.now() + perHostDelayMs)
      releaseTurn()
    }
    tails.set(origin, tail)
    try {
      await withDeadline(previous.catch(() => {}), deadline)
    } catch (error) {
      // Preserve the per-origin queue even when this caller's own deadline
      // elapses before its turn. The abandoned turn releases only after the
      // preceding request really finishes.
      previous.catch(() => {}).finally(releaseTurn)
      throw error
    }
    let operationPromise = null
    let releaseAfterOperation = false
    try {
      const remaining = Math.max(0, (nextRequestAt.get(origin) || 0) - Date.now())
      if (remaining > 0) await waitWithDeadline(remaining, deadline)
      await withDeadline(Promise.resolve(), deadline)
      operationPromise = Promise.resolve().then(operation)
      return await withDeadline(operationPromise, deadline)
    } catch (error) {
      if (operationPromise && error?.name === 'AbortError') {
        // Return the timed-out result promptly, but keep the strict origin lock
        // until even a non-compliant custom fetch actually settles.
        releaseAfterOperation = true
        operationPromise.catch(() => {}).finally(finishTurn)
      }
      throw error
    } finally {
      if (!releaseAfterOperation) finishTurn()
    }
  }
  schedule.defer = (value, delayMs) => {
    const origin = new URL(value).origin
    nextRequestAt.set(origin, Math.max(nextRequestAt.get(origin) || 0, Date.now() + delayMs))
  }
  return schedule
}

async function fetchWithRetry(value, init, { fetchImpl, schedule, retries, deadlineAt }) {
  let response
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const deadline = { signal: init?.signal, deadlineAt }
    response = await schedule(value, () => fetchImpl(value, init), deadline)
    if (![429, 503].includes(response.status) || attempt === retries) return response
    try { await response.body?.cancel?.() } catch { /* best-effort connection release */ }
    const delay = retryDelayMs(response, attempt)
    schedule.defer(value, delay)
    await waitWithDeadline(delay, deadline)
  }
  return response
}

async function cancelResponse(response) {
  try {
    const cancellation = response?.body?.cancel?.()
    if (cancellation) await withDeadline(cancellation, { deadlineAt: Date.now() + 250 })
  } catch { /* best-effort connection release */ }
}

async function loadRobots(adapter, target, context) {
  const targetUrl = safeSeedUrl(target, adapter)
  if (!targetUrl) return { accessible: false, reason: 'robots-outside-allowed-hosts' }
  const cacheKey = `${adapter.school}|${targetUrl.origin}`
  if (!context.robotsByOrigin.has(cacheKey)) {
    context.robotsByOrigin.set(cacheKey, (async () => {
      let current = safeSeedUrl(new URL('/robots.txt', targetUrl).toString(), adapter)
      if (!current) return { accessible: false, reason: 'robots-outside-allowed-hosts' }
      for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
        const controller = new AbortController()
        const deadlineAt = Date.now() + context.timeoutMs
        const deadline = { signal: controller.signal, deadlineAt }
        const timer = setTimeout(() => controller.abort(), context.timeoutMs)
        try {
          if (!(await withDeadline(isDiscoverPublicNetworkTarget(current, context.dnsLookup), deadline))) {
            return { accessible: false, reason: 'robots-non-public-network-target' }
          }
          const response = await fetchWithRetry(current.toString(), {
            redirect: 'manual',
            signal: controller.signal,
            headers: { accept: 'text/plain,*/*;q=0.1', 'user-agent': USER_AGENT },
          }, { ...context, deadlineAt })
          if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location')
            const next = location ? safeSeedUrl(new URL(location, current).toString(), adapter) : null
            await cancelResponse(response)
            if (!next) return { accessible: false, status: response.status, reason: 'robots-redirect-left-official-hosts' }
            current = next
            continue
          }
          if ([404, 410].includes(response.status)) {
            await cancelResponse(response)
            return { accessible: true, text: '' }
          }
          if (!response.ok) {
            await cancelResponse(response)
            return { accessible: false, status: response.status, reason: 'robots-http-error' }
          }
          const { text } = await withDeadline(readDiscoverResponseText(response, 512_000), deadline)
          return { accessible: true, text }
        } catch (error) {
          return {
            accessible: false,
            reason: error?.name === 'AbortError'
              ? 'robots-timeout'
              : (error?.message?.includes('body') ? 'robots-read-error' : 'robots-network-error'),
          }
        } finally {
          clearTimeout(timer)
        }
      }
      return { accessible: false, reason: 'robots-too-many-redirects' }
    })())
  }
  return context.robotsByOrigin.get(cacheKey)
}

async function robotsAllows(adapter, target, context) {
  const url = safeSeedUrl(target, adapter)
  if (!url) return { allowed: false, reason: 'invalid-or-outside-allowed-hosts' }
  const policy = await loadRobots(adapter, url, context)
  if (!policy?.accessible) return { allowed: false, status: policy?.status, reason: policy?.reason || 'robots-unavailable' }
  return allowsDiscoverCrawl(policy.text, `${url.pathname}${url.search}`, USER_AGENT)
    ? { allowed: true }
    : { allowed: false, reason: 'robots-denied' }
}

async function fetchSeed(adapter, seed, context) {
  const { timeoutMs, dnsLookup } = context
  const controller = new AbortController()
  const deadlineAt = Date.now() + timeoutMs
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = Date.now()
  try {
    let current = safeSeedUrl(seed.url, adapter)
    if (!current) return { ok: false, reason: 'invalid-or-outside-allowed-hosts' }
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const deadline = { signal: controller.signal, deadlineAt }
      if (!(await withDeadline(isDiscoverPublicNetworkTarget(current, dnsLookup), deadline))) {
        return { ok: false, reason: 'non-public-network-target' }
      }
      const robots = await withDeadline(robotsAllows(adapter, current, context), deadline)
      if (!robots.allowed) return { ok: false, status: robots.status, reason: robots.reason }
      const response = await fetchWithRetry(current.toString(), {
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept: 'text/html,application/xhtml+xml;q=0.9', 'user-agent': USER_AGENT },
      }, { ...context, deadlineAt })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        const next = location ? safeSeedUrl(new URL(location, current).toString(), adapter) : null
        await cancelResponse(response)
        if (!next) return { ok: false, status: response.status, reason: 'redirect-left-official-hosts' }
        current = next
        continue
      }
      if (!response.ok) {
        await cancelResponse(response)
        return { ok: false, status: response.status, reason: 'http-error' }
      }
      const finalUrl = safeSeedUrl(response.url || current.toString(), adapter)
      if (!finalUrl) {
        await cancelResponse(response)
        return { ok: false, status: response.status, reason: 'final-url-left-official-hosts' }
      }
      const contentType = String(response.headers.get('content-type') || '').toLowerCase()
      if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
        await cancelResponse(response)
        return { ok: false, status: response.status, reason: 'not-html', contentType }
      }
      const { text: body } = await withDeadline(readDiscoverResponseText(response), deadline)
      if (!/<(?:!doctype\s+html|html|head|body)\b/i.test(body)) {
        return { ok: false, status: response.status, reason: 'missing-html-document' }
      }
      if (!semanticKindMatch(adapter, seed, finalUrl, body)) {
        return { ok: false, status: response.status, reason: `kind-mismatch:${seed.kind}`, finalUrl: finalUrl.toString() }
      }
      return {
        ok: true,
        status: response.status,
        finalUrl: finalUrl.toString(),
        latencyMs: Date.now() - startedAt,
      }
    }
    return { ok: false, reason: 'too-many-redirects' }
  } catch (error) {
    return { ok: false, reason: error?.name === 'AbortError' ? 'timeout' : 'network-error' }
  } finally {
    clearTimeout(timer)
  }
}

/** Live, bounded health check used by maintainers and CI jobs with networking. */
export async function checkSchoolAdaptersLive(adapters, {
  fetchImpl = globalThis.fetch,
  concurrency = 4,
  timeoutMs = 15_000,
  perHostDelayMs = 1_000,
  retries = 1,
  dnsLookup,
  onProgress,
} = {}) {
  const tasks = (adapters || []).flatMap((adapter) => (adapter.seeds || []).map((seed) => ({ adapter, seed })))
  const results = new Array(tasks.length)
  let cursor = 0
  let completed = 0
  const workerCount = Math.min(
    Math.max(1, Math.min(MAX_HEALTH_CONCURRENCY, Math.floor(Number(concurrency)) || 1)),
    tasks.length || 1,
  )
  const requestTimeoutMs = Math.max(250, Math.min(MAX_HEALTH_TIMEOUT_MS, Math.floor(Number(timeoutMs)) || 15_000))
  const requestDelayMs = boundedInteger(perHostDelayMs, 1_000, 0, MAX_PER_HOST_DELAY_MS)
  const retryCount = boundedInteger(retries, 1, 0, MAX_RETRIES)
  const networkLookup = dnsLookup === undefined
    ? (fetchImpl === globalThis.fetch ? nodeDnsLookup : null)
    : dnsLookup
  const context = {
    fetchImpl,
    timeoutMs: requestTimeoutMs,
    dnsLookup: networkLookup,
    retries: retryCount,
    schedule: createOriginScheduler(requestDelayMs),
    robotsByOrigin: new Map(),
  }
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < tasks.length) {
      const index = cursor++
      const task = tasks[index]
      const health = await fetchSeed(task.adapter, task.seed, context)
      results[index] = {
        school: task.adapter.school,
        kind: task.seed.kind,
        url: task.seed.url,
        ...health,
      }
      completed += 1
      await onProgress?.({ completed, total: tasks.length, result: results[index] })
    }
  }))
  const failures = results.filter((result) => !result.ok)
  return {
    checkedAt: new Date().toISOString(),
    schoolCount: new Set(results.map((result) => result.school)).size,
    seedCount: results.length,
    passedSeedCount: results.length - failures.length,
    failedSeedCount: failures.length,
    passed: results.length > 0 && failures.length === 0,
    failures,
    results,
  }
}
