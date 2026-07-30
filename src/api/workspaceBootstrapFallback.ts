type ErrorShape = {
  code?: unknown
  status?: unknown
}

const COMPATIBILITY_CODES = new Set([
  'API_HTML_RESPONSE',
  'METHOD_NOT_ALLOWED',
  'NOT_FOUND',
  'WORKSPACE_BOOTSTRAP_UNAVAILABLE',
])

/**
 * The granular workspace bootstrap exists only for rolling compatibility with
 * an older Atlas API. Transport failures and server faults must remain one
 * failed request; expanding either into eight parallel reads creates an outage
 * request storm and cannot recover a server that is actually unreachable.
 */
export function shouldUseGranularWorkspaceFallback(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const candidate = error as ErrorShape
  if (typeof candidate.code === 'string' && COMPATIBILITY_CODES.has(candidate.code)) {
    return true
  }
  return candidate.status === 404
    || candidate.status === 405
    || candidate.status === 501
}
