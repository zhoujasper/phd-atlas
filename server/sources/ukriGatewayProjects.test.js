import { describe, expect, it } from 'vitest'
import { jsonResponse } from './adapterTestSupport.js'
import { SourceStructureChangedError } from './sourceErrors.js'
import {
  buildUkriPeopleUrl,
  parseUkriPeopleResponse,
  parseUkriProjectResponse,
  ukriGatewayProjectsSource,
} from './ukriGatewayProjects.js'

const person = {
  id: 'person-1',
  firstName: 'Andrew',
  otherNames: '',
  surname: 'Zisserman',
  links: { link: [
    { rel: 'EMPLOYED', href: 'http://gtr.ukri.org/gtr/api/organisations/org-1' },
    { rel: 'PI_PER', href: 'http://gtr.ukri.org/gtr/api/projects/project-1' },
  ] },
}

const project = {
  id: 'project-1',
  title: 'Verified computer vision research',
  status: 'Active',
  leadFunder: 'EPSRC',
  identifiers: { identifier: [{ type: 'GRANT_REFERENCE', value: 'EP/TEST/1' }] },
  start: 1_735_689_600_000,
  end: 1_830_297_600_000,
}

describe('UKRI Gateway to Research adapter', () => {
  it('builds a bounded person query and rejects changed envelopes', () => {
    const url = buildUkriPeopleUrl({ name: 'Andrew Zisserman', candidateLimit: 99 })
    expect(url.searchParams.get('q')).toBe('Andrew Zisserman')
    expect(url.searchParams.get('s')).toBe('30')
    expect(() => parseUkriPeopleResponse({ results: [] })).toThrow(SourceStructureChangedError)
  })

  it('normalizes a project with readable and machine provenance', () => {
    const record = parseUkriProjectResponse(project, {
      sourceId: 'ukri-gateway-projects',
      apiUrl: 'https://gtr.ukri.org/gtr/api/projects/project-1',
      personName: 'Andrew Zisserman',
      organizationName: 'University of Oxford',
      role: 'PI_PER',
      fetchedAt: '2026-08-09T00:00:00.000Z',
    })
    expect(record.value).toMatchObject({
      title: 'Verified computer vision research',
      piName: 'Andrew Zisserman',
      organizationName: 'University of Oxford',
      grantReference: 'EP/TEST/1',
      leadFunder: 'EPSRC',
    })
    expect(record.sourceUrl).toBe('https://gtr.ukri.org/projects?ref=EP%2FTEST%2F1')
    expect(record.apiUrl).toBe('https://gtr.ukri.org/gtr/api/projects/project-1')
  })

  it('follows only matched-person project links and retains source evidence', async () => {
    const fetchImpl = async (input) => {
      const url = String(input)
      if (url.includes('/persons?')) return jsonResponse({ person: [person], totalSize: 1 })
      if (url.includes('/organisations/org-1')) return jsonResponse({ id: 'org-1', name: 'University of Oxford' })
      if (url.includes('/projects/project-1')) return jsonResponse(project)
      throw new Error(`Unexpected UKRI URL: ${url}`)
    }
    const result = await ukriGatewayProjectsSource.run(
      { name: 'Andrew Zisserman', institution: 'University of Oxford', limit: 3 },
      { fetchImpl, retry: { maxAttempts: 1 }, rateLimitPerMin: 1_200 },
    )
    expect(result.status).toBe('ok')
    expect(result.records).toHaveLength(1)
    expect(result.records[0].value.organizationName).toBe('University of Oxford')
    expect(result.meta.attemptedProjects).toBe(1)
    expect(result.meta.unavailableOrganizationLookups).toBe(0)
    expect(result.meta.quarterlyData).toBe(true)
  })

  it('keeps verified project facts when organisation context is unavailable', async () => {
    const fetchImpl = async (input) => {
      const url = String(input)
      if (url.includes('/persons?')) return jsonResponse({ person: [person], totalSize: 1 })
      if (url.includes('/organisations/org-1')) throw new Error('organisation endpoint unavailable')
      if (url.includes('/projects/project-1')) return jsonResponse(project)
      throw new Error(`Unexpected UKRI URL: ${url}`)
    }
    const result = await ukriGatewayProjectsSource.run(
      { name: 'Andrew Zisserman', institution: 'University of Oxford', limit: 3 },
      { fetchImpl, retry: { maxAttempts: 1 }, rateLimitPerMin: 1_200 },
    )
    expect(result.records).toHaveLength(1)
    expect(result.records[0].value.organizationName).toBeNull()
    expect(result.warnings).toContain('ukri-organization-context-unavailable')
    expect(result.meta.unavailableOrganizationLookups).toBe(1)
  })

  it('fails closed instead of making an unbounded person request', async () => {
    const result = await ukriGatewayProjectsSource.run(
      { name: '   ' },
      { fetchImpl: async () => { throw new Error('must not fetch') } },
    )
    expect(result.status).toBe('empty')
    expect(result.meta.unbounded).toBe(true)
  })
})
