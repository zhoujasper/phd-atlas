import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import express from 'express'
import {
  DECLARED_AUTHENTICATED_API_ROUTE_TEMPLATES,
  declaredAuthenticatedHydrationRoute,
  registeredAuthenticatedMutationRoute,
  resolveAuthenticatedHydrationPolicy,
} from './hydrationPolicy.js'

function declaredRoutes(source, marker = '') {
  const start = marker ? source.indexOf(marker) : 0
  if (start < 0) throw new Error(`Hydration route marker not found: ${marker}`)
  const selected = source.slice(start)
  return [...selected.matchAll(/app\.(get|post|put|patch|delete)\('([^']+)'/g)]
    .map((match) => `${match[1].toUpperCase()} ${match[2]}`)
    .filter((route) => route.includes(' /api/'))
}

describe('authenticated route hydration contract', () => {
  it('requires every registered authenticated API route to declare its hydration review', () => {
    const indexSource = readFileSync(path.resolve('server/index.js'), 'utf8')
    const interviewSource = readFileSync(path.resolve('server/interviewPrepApi.js'), 'utf8')
    const registered = [
      ...declaredRoutes(indexSource, "app.use('/api', asyncHandler(hydrateUser))"),
      ...declaredRoutes(interviewSource),
    ]
    const missing = registered.filter((route) => !DECLARED_AUTHENTICATED_API_ROUTE_TEMPLATES.has(route))
    expect(missing).toEqual([])
  })

  it('never defaults a registered mutation route to a writable auth-only projection', () => {
    const indexSource = readFileSync(path.resolve('server/index.js'), 'utf8')
    const interviewSource = readFileSync(path.resolve('server/interviewPrepApi.js'), 'utf8')
    const registeredMutations = [
      ...declaredRoutes(indexSource, "app.use('/api', asyncHandler(hydrateUser))"),
      ...declaredRoutes(interviewSource),
    ].filter((route) => !route.startsWith('GET ') && !route.startsWith('HEAD '))

    for (const route of registeredMutations) {
      const separator = route.indexOf(' ')
      const policy = resolveAuthenticatedHydrationPolicy({
        method: route.slice(0, separator),
        pathname: route.slice(separator + 1),
        focusedSelector: null,
        authOnlySelector: { compactWorkspaceUsers: true },
      })
      expect(policy.kind, route).toBe('legacy-broad')
      expect(policy.selector, route).toBeNull()
    }
  })

  it('matches path parameters exactly without treating extra path segments as declared', () => {
    expect(declaredAuthenticatedHydrationRoute('PATCH', '/api/applications/app_1/fees/fee_1'))
      .toBe('PATCH /api/applications/:id/fees/:feeId')
    expect(declaredAuthenticatedHydrationRoute('PATCH', '/api/applications/app_1/fees/fee_1/extra'))
      .toBeNull()
  })

  it('defaults an undeclared route to auth-only instead of silently hydrating the workspace', () => {
    expect(resolveAuthenticatedHydrationPolicy({
      method: 'GET',
      pathname: '/api/future-light-route',
      focusedSelector: null,
      authOnlySelector: { includeApplications: false, includeTeams: false },
    })).toEqual({
      kind: 'auth-only-default',
      declared: false,
      selector: { includeApplications: false, includeTeams: false },
      routeTemplate: null,
    })
  })

  it('leaves an unmatched mutation on an auth-only projection so Express can return 404', () => {
    expect(resolveAuthenticatedHydrationPolicy({
      method: 'POST',
      pathname: '/api/future-mutation-route',
      focusedSelector: null,
      authOnlySelector: { includeApplications: false, compactWorkspaceUsers: true },
    })).toEqual({
      kind: 'unmatched-mutation-auth-only',
      declared: false,
      selector: { includeApplications: false, compactWorkspaceUsers: true },
      routeTemplate: null,
    })
  })

  it('fails closed only when Express can dispatch a mutation missing its hydration policy', () => {
    const app = express()
    app.post('/api/future-mutation-route/:id', (_request, response) => response.sendStatus(204))
    const registeredRoute = registeredAuthenticatedMutationRoute(
      app,
      'POST',
      '/api/future-mutation-route/example',
    )

    expect(registeredRoute).toBe('POST /api/future-mutation-route/:id')
    expect(resolveAuthenticatedHydrationPolicy({
      method: 'POST',
      pathname: '/api/future-mutation-route/example',
      focusedSelector: null,
      authOnlySelector: { includeApplications: false, compactWorkspaceUsers: true },
      registeredMutationRoute: registeredRoute,
    })).toEqual({
      kind: 'undeclared-mutation-denied',
      declared: false,
      selector: null,
      routeTemplate: 'POST /api/future-mutation-route/:id',
    })

    expect(registeredAuthenticatedMutationRoute(
      app,
      'POST',
      '/api/future-mutation-route/example/extra',
    )).toBeNull()
  })
})
