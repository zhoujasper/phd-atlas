/**
 * Authenticated routes that existed when route-scoped hydration became the
 * default. A route is intentionally present here even when it already has a
 * focused selector: the selector wins, while this inventory makes later route
 * additions fail the source contract until their hydration needs are reviewed.
 *
 * Requests which do not match this inventory default to auth-only hydration.
 * Existing routes without a focused selector remain explicitly legacy-broad.
 */
export const DECLARED_AUTHENTICATED_API_ROUTE_TEMPLATES = new Set(`
GET /api/codex/whoami
GET /api/codex/capabilities
DELETE /api/codex/authorizations/current
GET /api/codex/authorizations
POST /api/codex/authorizations
PATCH /api/codex/authorizations/:id
DELETE /api/codex/authorizations/:id
GET /api/codex/device-authorizations/:userCode
POST /api/codex/device-authorizations/:userCode/approve
POST /api/codex/device-authorizations/:userCode/deny
GET /api/codex/settings
GET /api/codex/profile-recommenders
POST /api/codex/profile-recommenders
PATCH /api/codex/profile-recommenders/:id
DELETE /api/codex/profile-recommenders/:id
GET /api/events
GET /api/push/public-key
PUT /api/push/subscriptions
DELETE /api/push/subscriptions
POST /api/push/test
GET /api/auth/me
GET /api/discover/catalog
GET /api/discover/state
GET /api/discover/source-index
PUT /api/discover/state
POST /api/discover/programs/delete
POST /api/discover/research/start
POST /api/discover/applications/:id/enrichment/preview
POST /api/discover/applications/:id/enrichment/apply
POST /api/discover/import
GET /api/auth/passkeys
POST /api/auth/passkeys/register/options
POST /api/auth/passkeys/register/verify
PATCH /api/auth/passkeys/:id
DELETE /api/auth/passkeys/:id
POST /api/auth/impersonate
GET /api/applications
PUT /api/profile-recommenders
POST /api/applications
GET /api/applications/trash
POST /api/applications/trash/:trashId/restore
DELETE /api/applications/trash/:trashId
DELETE /api/applications/trash
GET /api/applications/:id
GET /api/applications/:id/admission-signals
POST /api/applications/:id/admission-signals
GET /api/applications/:id/admission-signals/history
POST /api/admission-signals/compare
GET /api/admission-bookmarks
POST /api/admission-bookmarks
PATCH /api/admission-bookmarks/:id/note
DELETE /api/admission-bookmarks/:id
GET /api/admission-notifications/settings
PUT /api/admission-notifications/settings
POST /api/applications/:id/recommenders/:recommenderId/resolve
POST /api/applications/:id/school-logo/resolve
PATCH /api/applications/:id/school-logo
POST /api/applications/:id/team-transfer/preflight
PATCH /api/applications/:id/team-visibility
PATCH /api/applications/:id/delta
PUT /api/applications/:id
DELETE /api/applications/:id
POST /api/applications/:id/materials
POST /api/applications/:id/materials/:materialId/file
PATCH /api/applications/:id/materials/:materialId/files/:fileId
DELETE /api/applications/:id/materials/:materialId/files/:fileId
POST /api/applications/:id/communications
PATCH /api/applications/:id/communications/categories
PATCH /api/applications/:id/communications/:communicationId
POST /api/applications/:id/communications/classify
POST /api/applications/:id/communications/send
POST /api/applications/:id/scholarships
POST /api/applications/:id/fees
PATCH /api/applications/:id/fees/:feeId
DELETE /api/applications/:id/fees/:feeId
POST /api/applications/:id/tasks
PATCH /api/applications/:id/tasks/:taskId
POST /api/applications/:id/tasks/:taskId/file
PATCH /api/applications/:id/tasks/:taskId/files/:fileId
DELETE /api/applications/:id/tasks/:taskId/files/:fileId
POST /api/applications/:id/share
PATCH /api/applications/:id/share/:shareId
POST /api/applications/:id/review-comments
GET /api/applications/:id/review-comments/threaded
POST /api/applications/:id/request-feedback
DELETE /api/applications/:id/share/:shareId
GET /api/ai/keys
POST /api/ai/keys
PATCH /api/ai/keys/:id
DELETE /api/ai/keys/:id
POST /api/ai/keys/:id/test
POST /api/ai/keys/:id/usage/reset
POST /api/ai/draft
GET /api/workspace/bootstrap
GET /api/workspace/bootstrap/stream
GET /api/teams/mine/workspaces
GET /api/teams/mine
GET /api/teams/mine/applications
POST /api/teams/:id/transfer-requests/:requestId/approve
POST /api/teams/:id/transfer-requests/:requestId/reject
PATCH /api/teams/:id
POST /api/teams/:id/teacher-groups
PATCH /api/teams/:id/teacher-groups/:groupId
DELETE /api/teams/:id/teacher-groups/:groupId
GET /api/teams/:id/members/:userId/profile-recommenders
PUT /api/teams/:id/members/:userId/profile-recommenders
GET /api/teams/:id/members/:userId/profile-assets
POST /api/teams/:id/members/:userId/profile-assets
PATCH /api/teams/:id/members/:userId/profile-assets/:assetId
DELETE /api/teams/:id/members/:userId/profile-assets/:assetId
POST /api/teams/:id/profile-presets
PATCH /api/teams/:id/profile-presets/:presetId
DELETE /api/teams/:id/profile-presets/:presetId
POST /api/teams/:id/profile-presets/restore
DELETE /api/teams/:id
GET /api/teams/:id/members
GET /api/teams/:id/notification-groups
POST /api/teams/:id/notification-groups
PATCH /api/teams/:id/notification-groups/:groupId
DELETE /api/teams/:id/notification-groups/:groupId
POST /api/teams/:id/notifications/publish
POST /api/teams/join-codes/:code/redeem
POST /api/teams/:id/join-codes
POST /api/teams/:id/members
PATCH /api/teams/:id/members/me/contact-profile
PATCH /api/teams/:id/members/:memberId
DELETE /api/teams/:id/members/:memberId
POST /api/teams/invites/:token/accept
GET /api/files/:fileId/download
GET /api/profile/recommenders
GET /api/profile/recommenders/:id
GET /api/profile-assets
GET /api/profile-assets/:id/export
POST /api/profile-assets
PATCH /api/profile-assets/:id
DELETE /api/profile-assets/:id
POST /api/profile-assets/:id/files
PATCH /api/profile-assets/:id/files/:fileId
DELETE /api/profile-assets/:id/files/:fileId
POST /api/profile-assets/:id/share
PATCH /api/profile-assets/:id/share/:shareId
DELETE /api/profile-assets/:id/share/:shareId
POST /api/settings/test-email
POST /api/settings/receive-email-verification
POST /api/settings/test-incoming-mail
POST /api/settings/fetch-mail-now
POST /api/settings/sync-mail-history
DELETE /api/account
PATCH /api/settings
GET /api/notifications
GET /api/notifications/unread-count
POST /api/notifications/:id/read
POST /api/notifications/:id/unread
POST /api/notifications/:id/archive
POST /api/notifications/read-all
POST /api/notifications/bulk
GET /api/analytics
GET /api/exports
GET /api/backups
POST /api/backups
DELETE /api/backups/:fileName
POST /api/backups/:fileName/restore
GET /api/admin/notification-groups
POST /api/admin/notification-groups
PATCH /api/admin/notification-groups/:groupId
DELETE /api/admin/notification-groups/:groupId
POST /api/admin/notifications/publish
GET /api/admin/users
GET /api/admin/teams
POST /api/admin/teams
PATCH /api/admin/users/:id
DELETE /api/admin/users/:id
GET /api/admin/logs
DELETE /api/admin/logs
GET /api/admin/logs/export
GET /api/admin/database
POST /api/admin/database/test
PUT /api/admin/database
PATCH /api/admin/settings
POST /api/admin/settings/test-email
POST /api/admin/users/:id/reset-password
GET /api/admin/backups
POST /api/admin/backups
GET /api/admin/backups/:fileName/download
DELETE /api/admin/backups/:fileName
POST /api/admin/backups/:fileName/restore
POST /api/admin/change-password
GET /api/admin/bootstrap-secrets
POST /api/admin/bootstrap-secrets/regenerate
GET /api/admin/system-info
GET /api/admin/system-update/status
GET /api/admin/system-update/logs
GET /api/admin/system-update/check
POST /api/admin/system-update/install-release
POST /api/admin/system-update
DELETE /api/admin/system-update/:storedAs
GET /api/interview-prep/workspace
PUT /api/interview-prep/workspace
POST /api/interview-prep/ai/questions
POST /api/interview-prep/ai/mock-turn
POST /api/interview-prep/ai/feedback
`.trim().split('\n'))

function routeSegments(value) {
  return String(value ?? '').replace(/\/+$/u, '').split('/').filter(Boolean)
}

function routeTemplateMatches(templatePath, pathname) {
  const templateSegments = routeSegments(templatePath)
  const requestSegments = routeSegments(pathname)
  return templateSegments.length === requestSegments.length
    && templateSegments.every((segment, index) => (
      segment.startsWith(':')
        ? requestSegments[index].length > 0
        : segment.toLowerCase() === requestSegments[index].toLowerCase()
    ))
}

/**
 * Match a mutation against Express' actual route registry. This is deliberately
 * separate from the hydration inventory above: a newly registered mutation
 * must fail closed when its hydration policy was forgotten, while a path which
 * Express cannot dispatch must remain a normal 404.
 */
export function registeredAuthenticatedMutationRoute(app, method, pathname) {
  const requestMethod = String(method ?? '').toUpperCase()
  if (['GET', 'HEAD', 'OPTIONS'].includes(requestMethod)) return null

  const routeLayers = app?.router?.stack
  if (!Array.isArray(routeLayers)) return null
  for (const layer of routeLayers) {
    const route = layer?.route
    if (!route?._handlesMethod?.(requestMethod)) continue
    const matches = Array.isArray(layer.matchers) && layer.matchers.some((matcher) => {
      try {
        return matcher(String(pathname ?? '')) !== false
      } catch {
        return false
      }
    })
    if (!matches) continue
    const routePath = Array.isArray(route.path) ? route.path.join('|') : route.path
    return `${requestMethod} ${String(routePath ?? pathname ?? '')}`
  }
  return null
}

export function declaredAuthenticatedHydrationRoute(method, pathname) {
  const requestMethod = String(method ?? '').toUpperCase()
  for (const routeTemplate of DECLARED_AUTHENTICATED_API_ROUTE_TEMPLATES) {
    const separator = routeTemplate.indexOf(' ')
    if (routeTemplate.slice(0, separator) !== requestMethod) continue
    const templatePath = routeTemplate.slice(separator + 1)
    if (routeTemplateMatches(templatePath, pathname)) return routeTemplate
  }
  return null
}

export function resolveAuthenticatedHydrationPolicy({
  method,
  pathname,
  focusedSelector = null,
  authOnlySelector,
  registeredMutationRoute = null,
} = {}) {
  if (focusedSelector) {
    return { kind: 'scoped', declared: true, selector: focusedSelector, routeTemplate: null }
  }
  const routeTemplate = declaredAuthenticatedHydrationRoute(method, pathname)
  if (routeTemplate) {
    return { kind: 'legacy-broad', declared: true, selector: null, routeTemplate }
  }
  if (registeredMutationRoute) {
    return {
      kind: 'undeclared-mutation-denied',
      declared: false,
      selector: null,
      routeTemplate: registeredMutationRoute,
    }
  }
  if (!['GET', 'HEAD'].includes(String(method ?? '').toUpperCase())) {
    return {
      kind: 'unmatched-mutation-auth-only',
      declared: false,
      selector: { ...authOnlySelector },
      routeTemplate: null,
    }
  }
  return {
    kind: 'auth-only-default',
    declared: false,
    selector: { ...authOnlySelector },
    routeTemplate: null,
  }
}
