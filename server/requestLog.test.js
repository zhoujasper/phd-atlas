import { describe, expect, it } from 'vitest'
import { sanitizedRequestTarget, shouldSkipRoutineHealthRequestLog } from './requestLog.js'

describe('request log redaction', () => {
  it('redacts capability tokens embedded in paths', () => {
    expect(sanitizedRequestTarget('/api/share/super-secret-token/materials'))
      .toBe('/api/share/[redacted]/materials')
    expect(sanitizedRequestTarget('/api/teams/invites/invite-secret/accept'))
      .toBe('/api/teams/invites/[redacted]/accept')
    expect(sanitizedRequestTarget('/api/asset-upload/asset-secret/file'))
      .toBe('/api/asset-upload/[redacted]/file')
    expect(sanitizedRequestTarget('/api/codex/device-authorizations/ABCD-EFGH/approve'))
      .toBe('/api/codex/device-authorizations/[redacted]/approve')
    expect(sanitizedRequestTarget('/api/codex/device-authorizations/token'))
      .toBe('/api/codex/device-authorizations/token')
  })

  it('removes every query and fragment value while retaining the route for diagnostics', () => {
    expect(sanitizedRequestTarget('/api/calendar/feed?token=calendar-secret'))
      .toBe('/api/calendar/feed?[redacted]')
    expect(sanitizedRequestTarget('/api/discover/programs?query=private-topic&country=GB'))
      .toBe('/api/discover/programs?[redacted]')
  })

  it('leaves ordinary paths intact', () => {
    expect(sanitizedRequestTarget('/api/applications')).toBe('/api/applications')
  })

  it('suppresses only routine read-only health probes from the access log', () => {
    for (const originalUrl of ['/api/health', '/api/health/', '/api/health/live', '/api/health/ready?deep=1']) {
      expect(shouldSkipRoutineHealthRequestLog({ method: 'GET', originalUrl })).toBe(true)
    }
    expect(shouldSkipRoutineHealthRequestLog({ method: 'HEAD', originalUrl: '/api/health/ready' })).toBe(true)
    expect(shouldSkipRoutineHealthRequestLog({ method: 'POST', originalUrl: '/api/health' })).toBe(false)
    expect(shouldSkipRoutineHealthRequestLog({ method: 'GET', originalUrl: '/api/health/ws' })).toBe(false)
    expect(shouldSkipRoutineHealthRequestLog({ method: 'GET', originalUrl: '/api/health/ready/extra' })).toBe(false)
  })
})
