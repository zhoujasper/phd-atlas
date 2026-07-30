import { describe, expect, it } from 'vitest'
import { sanitizedRequestTarget } from './requestLog.js'

describe('request log redaction', () => {
  it('redacts capability tokens embedded in paths', () => {
    expect(sanitizedRequestTarget('/api/share/super-secret-token/materials'))
      .toBe('/api/share/[redacted]/materials')
    expect(sanitizedRequestTarget('/api/teams/invites/invite-secret/accept'))
      .toBe('/api/teams/invites/[redacted]/accept')
    expect(sanitizedRequestTarget('/api/asset-upload/asset-secret/file'))
      .toBe('/api/asset-upload/[redacted]/file')
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
})
