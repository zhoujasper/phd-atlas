import { describe, expect, it } from 'vitest'
import { ApiError } from './phdApi'
import { shouldUseGranularWorkspaceFallback } from './workspaceBootstrapFallback'

describe('workspace bootstrap compatibility fallback', () => {
  it('falls back only when the aggregate endpoint is absent or unsupported', () => {
    expect(shouldUseGranularWorkspaceFallback(
      new ApiError('Not found.', 'NOT_FOUND', 404),
    )).toBe(true)
    expect(shouldUseGranularWorkspaceFallback(
      new ApiError('Use the legacy API.', 'WORKSPACE_BOOTSTRAP_UNAVAILABLE', 409),
    )).toBe(true)
    expect(shouldUseGranularWorkspaceFallback(
      new ApiError('HTML shell.', 'API_HTML_RESPONSE', 200),
    )).toBe(true)
  })

  it('does not fan one outage or server fault out into granular requests', () => {
    expect(shouldUseGranularWorkspaceFallback(
      new ApiError('Server unavailable.', 'SERVER_UNAVAILABLE', 502),
    )).toBe(false)
    expect(shouldUseGranularWorkspaceFallback(
      new ApiError('Timed out.', 'REQUEST_TIMEOUT', 408),
    )).toBe(false)
    expect(shouldUseGranularWorkspaceFallback(
      new ApiError('Bootstrap failed.', 'REQUEST_FAILED', 500),
    )).toBe(false)
    expect(shouldUseGranularWorkspaceFallback(new TypeError('Failed to fetch'))).toBe(false)
  })
})
