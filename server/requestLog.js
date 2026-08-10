const SECRET_PATH_BOUNDARIES = [
  /^\/api\/share\/[^/]+/i,
  /^\/api\/asset-upload\/[^/]+/i,
  /^\/api\/teams\/invites\/[^/]+/i,
  /^\/api\/teams\/join-codes\/[^/]+/i,
  /^\/api\/codex\/device-authorizations\/(?!token(?:\/|$))[^/]+/i,
]

export function sanitizedRequestTarget(value) {
  const raw = String(value ?? '')
  const queryIndex = raw.search(/[?#]/)
  let pathname = queryIndex >= 0 ? raw.slice(0, queryIndex) : raw
  for (const pattern of SECRET_PATH_BOUNDARIES) {
    pathname = pathname.replace(pattern, (match) => {
      const boundary = match.lastIndexOf('/')
      return `${match.slice(0, boundary + 1)}[redacted]`
    })
  }
  return queryIndex >= 0 ? `${pathname}?[redacted]` : pathname
}

/**
 * Liveness/readiness probes are deliberately absent from the ordinary access
 * log. Orchestrators can issue hundreds of these at once during a rollout;
 * formatting and flushing one line per probe adds backpressure precisely when
 * the probe is meant to measure whether the event loop can still respond.
 * Non-read methods and lookalike paths remain logged for security diagnostics.
 */
export function shouldSkipRoutineHealthRequestLog(request) {
  const method = String(request?.method ?? '').toUpperCase()
  if (!['GET', 'HEAD'].includes(method)) return false
  const target = String(request?.originalUrl ?? request?.url ?? '').split(/[?#]/u)[0]
  return /^\/api\/health(?:\/(?:live|ready))?\/?$/iu.test(target)
}

export const SAFE_MORGAN_FORMAT = ':remote-addr - [:date[clf]] ":method :safe-url HTTP/:http-version" :status :res[content-length] :response-time ms ":user-agent"'
