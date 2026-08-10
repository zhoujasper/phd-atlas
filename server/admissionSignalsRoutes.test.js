import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './index.js'
import {
  htmlResponse,
  jsonFixture,
  jsonResponse,
  readFixture,
} from './sources/adapterTestSupport.js'

const fastSources = { retry: { maxAttempts: 1 }, rateLimitPerMin: 1200 }
const redditAuth = {
  auth: {
    clientId: 'route-test-id',
    clientSecret: 'route-test-secret',
    username: 'route-test-user',
    password: 'route-test-password',
  },
}

function routedFetch(routes) {
  return async (url) => {
    const target = String(url)
    for (const [fragment, respond] of Object.entries(routes)) {
      if (target.includes(fragment)) return respond(target)
    }
    throw new Error(`Unrouted request in test: ${target}`)
  }
}

const admissionFixtures = {
  'search.rss': () => htmlResponse(readFixture('reddit-search-ok.atom.xml'), {
    headers: { 'content-type': 'application/atom+xml' },
  }),
  'www.reddit.com': () => jsonResponse(jsonFixture('reddit-token-ok.json')),
  'oauth.reddit.com': () => jsonResponse(jsonFixture('reddit-search-ok.json')),
}

const gradcafeOk = () => htmlResponse(readFixture('gradcafe-results-ok.html'))

const advisorFixtures = {
  'api.nsf.gov': () => jsonResponse(jsonFixture('nsf-awards-ok.json')),
  'api.reporter.nih.gov': () => jsonResponse(jsonFixture('nih-projects-ok.json')),
  'api.openalex.org': () => jsonResponse(jsonFixture('openalex-works-ok.json')),
  'gtr.ukri.org': () => jsonResponse({ person: [] }),
}

const testHooks = {}
let server
let baseUrl
let token

beforeAll(async () => {
  server = createApp({ testHooks }).listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'jasper@example.com',
      password: 'demo123456',
      scope: 'app',
    }),
  })
  expect(loginResponse.status).toBe(200)
  token = (await loginResponse.json()).data.token
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

function sourceOptions(options) {
  testHooks.admissionSignalsOptions = options
}

function postHeaders() {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  }
}

async function postRoute(route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: postHeaders(),
    body: JSON.stringify(body),
  })
  return { response, payload: await response.json() }
}

describe('Phase 15A source aggregation routes', () => {
  it('returns admission outcomes through the authenticated HTTP boundary', async () => {
    sourceOptions({
      ...fastSources,
      fetchImpl: routedFetch({
        ...admissionFixtures,
        'thegradcafe.com': gradcafeOk,
      }),
    })
    const { response, payload } = await postRoute(
      '/api/sources/admission-outcomes',
      { school: '  Stanford University  ', program: ' PhD Computer Science ', year: 2024 },
    )
    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.data.query).toEqual({
      school: 'Stanford University',
      program: 'PhD Computer Science',
      year: 2024,
    })
    // The fixture holds a Stanford row and an Example University row. Only the
    // first is this programme, so only the first reaches the summary.
    expect(payload.data.summary.total).toBe(1)
    expect(payload.data.outcomes).toHaveLength(1)
    expect(payload.data.outcomes[0].value.school).toBe('Stanford University')
    expect(payload.data.unmatchedOutcomes).toHaveLength(1)
    expect(payload.data.sources.map((source) => source.id)).toEqual([
      'official-program-history',
      'gradcafe-results',
      'reddit-submissions',
    ])
  })

  it('returns advisor signals through the authenticated HTTP boundary', async () => {
    sourceOptions({
      ...fastSources,
      fetchImpl: routedFetch(advisorFixtures),
    })
    const { response, payload } = await postRoute(
      '/api/sources/advisor-signals',
      { name: 'Ada Turing', institution: 'Stanford University' },
    )
    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.data.query).toEqual({
      name: 'Ada Turing',
      institution: 'Stanford University',
    })
    // Only the NSF fixture credits Ada Turing. The NIH and OpenAlex fixtures
    // credit other people, and attributing those to her over the HTTP boundary
    // is exactly what this route used to do.
    expect(payload.data.funding.hasPublicAward).toBe(true)
    expect(payload.data.awards).toHaveLength(1)
    expect(payload.data.awards[0].value.piName).toBe('Ada Turing')
    expect(payload.data.awards[0].match.verified).toBe(true)
    expect(payload.data.projects).toHaveLength(0)
    expect(payload.data.works).toHaveLength(0)
    expect(payload.data.sources).toHaveLength(4)
  })

  it('rejects missing and overlong query fields with 400', async () => {
    sourceOptions(undefined)
    const missing = await postRoute(
      '/api/sources/admission-outcomes',
      { program: 'PhD Computer Science' },
    )
    expect(missing.response.status).toBe(400)
    expect(missing.payload.ok).toBe(false)

    const overlong = await postRoute(
      '/api/sources/admission-outcomes',
      { school: 's'.repeat(201), program: 'PhD Computer Science' },
    )
    expect(overlong.response.status).toBe(400)
    expect(overlong.payload.ok).toBe(false)
  })

  it('keeps the other source data when one admission source fails', async () => {
    sourceOptions({
      ...fastSources,
      ...redditAuth,
      fetchImpl: routedFetch({
        ...admissionFixtures,
        'thegradcafe.com': () => htmlResponse('gone', { status: 503 }),
      }),
    })
    const { response, payload } = await postRoute(
      '/api/sources/admission-outcomes',
      { school: 'Stanford University', program: 'PhD Computer Science' },
    )
    expect(response.status).toBe(200)
    const gradcafe = payload.data.sources.find((source) => source.id === 'gradcafe-results')
    const reddit = payload.data.sources.find((source) => source.id === 'reddit-submissions')
    expect(gradcafe.status).toBe('error')
    expect(reddit.status).toBe('ok')
    expect(payload.data.discussions.length).toBeGreaterThan(0)
  })

  it('returns Reddit Atom discussions without OAuth configuration', async () => {
    sourceOptions({
      ...fastSources,
      fetchImpl: routedFetch({
        ...admissionFixtures,
        'thegradcafe.com': gradcafeOk,
      }),
    })
    const { response, payload } = await postRoute(
      '/api/sources/admission-outcomes',
      { school: 'Stanford University', program: 'PhD Computer Science' },
    )
    expect(response.status).toBe(200)
    const reddit = payload.data.sources.find((source) => source.id === 'reddit-submissions')
    expect(reddit.status).toBe('ok')
    expect(payload.data.discussions).toHaveLength(1)
    expect(payload.data.discussions[0].value.transport).toBe('official-atom-feed')
    expect(payload.data.outcomes).toHaveLength(1)
  })

  it('returns already-completed source results after the aggregate deadline', async () => {
    sourceOptions({
      ...fastSources,
      ...redditAuth,
      timeoutMs: 120,
      fetchImpl: routedFetch({
        ...admissionFixtures,
        'thegradcafe.com': () => new Promise(() => {}),
      }),
    })
    const startedAt = Date.now()
    const { response, payload } = await postRoute(
      '/api/sources/admission-outcomes',
      { school: 'Stanford University', program: 'PhD Computer Science' },
    )
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(100)
    expect(response.status).toBe(200)
    const gradcafe = payload.data.sources.find((source) => source.id === 'gradcafe-results')
    const reddit = payload.data.sources.find((source) => source.id === 'reddit-submissions')
    expect(gradcafe.status).toBe('error')
    expect(reddit.status).toBe('ok')
    expect(payload.data.discussions.length).toBeGreaterThan(0)
  })

  it('refuses an unauthenticated caller before reaching any external source', async () => {
    // These two routes make outbound requests on the caller's behalf. Their
    // only protection is sitting after the /api authRequired middleware, which
    // is ordering inside a file of this size -- easy to break by inserting a
    // route a hundred lines too early and impossible to notice by reading. The
    // fetch counter is the part that matters: a 401 that still reached
    // GradCafe would mean anyone could spend the server's rate limit.
    let outboundCalls = 0
    sourceOptions({
      ...fastSources,
      fetchImpl: async (url) => {
        outboundCalls += 1
        return routedFetch({ ...admissionFixtures, 'thegradcafe.com': gradcafeOk })(url)
      },
    })

    for (const route of ['/api/sources/admission-outcomes', '/api/sources/advisor-signals']) {
      const response = await fetch(`${baseUrl}${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ school: 'Stanford University', program: 'PhD Computer Science', name: 'Ada Turing' }),
      })
      expect(response.status).toBe(401)
    }
    expect(outboundCalls).toBe(0)
  })

  it('persists and reads an admission bookmark through the owned storage boundary', async () => {
    const applicationId = `admission-bookmark-route-${Date.now()}`
    const created = await postRoute('/api/admission-bookmarks', {
      applicationId,
      type: 'funding',
      title: 'Verified public award',
      data: {
        sourceId: 'nsf-awards',
        sourceUrl: 'https://www.nsf.gov/awardsearch/showAward?AWD_ID=123',
      },
    })
    expect(created.response.status, JSON.stringify(created.payload)).toBe(200)
    const bookmarkId = created.payload.data.bookmarkId
    expect(bookmarkId).toEqual(expect.any(String))

    const listedResponse = await fetch(
      `${baseUrl}/api/admission-bookmarks?applicationId=${encodeURIComponent(applicationId)}`,
      { headers: { authorization: `Bearer ${token}` } },
    )
    const listed = await listedResponse.json()
    expect(listedResponse.status).toBe(200)
    expect(listed.data.bookmarks).toEqual([
      expect.objectContaining({
        id: bookmarkId,
        applicationId,
        type: 'funding',
        title: 'Verified public award',
      }),
    ])

    const deletedResponse = await fetch(`${baseUrl}/api/admission-bookmarks/${bookmarkId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(deletedResponse.status).toBe(200)
  })
})
