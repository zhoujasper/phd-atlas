export const REALTIME_SCOPES = Object.freeze([
  'applications',
  'profile-assets',
  'backups',
  'teams',
  'notifications',
  'session',
  'ai-keys',
  'discover',
  'interview',
  'admission',
])

const TEAM_APPLICATION_MUTATION_PATTERNS = Object.freeze([
  /^\/api\/teams\/[^/]+\/transfer-requests\/[^/]+\/(?:approve|reject)\/?$/i,
  /^\/api\/teams\/[^/]+\/?$/i,
  /^\/api\/teams\/[^/]+\/members\/[^/]+\/?$/i,
  /^\/api\/teams\/[^/]+\/members\/[^/]+\/profile-recommenders\/?$/i,
])

function teamMutationChangesApplications(method, pathname) {
  if (method === 'DELETE' && TEAM_APPLICATION_MUTATION_PATTERNS[1].test(pathname)) return true
  if (method === 'DELETE' && TEAM_APPLICATION_MUTATION_PATTERNS[2].test(pathname)) return true
  if (method === 'PUT' && TEAM_APPLICATION_MUTATION_PATTERNS[3].test(pathname)) return true
  return method === 'POST'
    && TEAM_APPLICATION_MUTATION_PATTERNS[0].test(pathname)
}

/**
 * One browser/server authority for the datasets changed by an API mutation.
 * The server publishes these scopes to other tabs; the initiating browser uses
 * the same scopes to invalidate only its own affected reads.
 */
export function scopesForMutation(method, originalUrl) {
  const normalizedMethod = String(method ?? 'GET').toUpperCase()
  if (['GET', 'HEAD', 'OPTIONS'].includes(normalizedMethod)) return []
  const pathname = String(originalUrl ?? '').split('?')[0]
  const lowerPathname = pathname.toLowerCase()
  const scopes = new Set()
  const applicationAdmissionPath = /^\/api\/applications\/[^/]+\/admission-signals(?:\/history)?\/?$/i
    .test(pathname)
  const schoolLogoResolvePath = /^\/api\/applications\/[^/]+\/school-logo\/resolve\/?$/i
    .test(pathname)

  if (applicationAdmissionPath) {
    scopes.add('admission')
  } else if (
    !schoolLogoResolvePath
    && (lowerPathname.startsWith('/api/applications') || lowerPathname.startsWith('/api/share/'))
  ) {
    scopes.add('applications')
    scopes.add('session')
  }
  if (/^\/api\/applications\/[^/]+\/recommenders\/[^/]+\/resolve\/?$/i.test(pathname)) {
    scopes.add('teams')
  }
  if (
    lowerPathname.startsWith('/api/profile-recommenders')
    || lowerPathname.startsWith('/api/codex/profile-recommenders')
  ) {
    scopes.add('applications')
    scopes.add('session')
  }
  if (lowerPathname.startsWith('/api/profile-assets') || /\/profile-assets(?:\/|$)/i.test(pathname)) {
    scopes.add('profile-assets')
    scopes.add('session')
  }
  if (lowerPathname.startsWith('/api/backups') || lowerPathname.startsWith('/api/admin/backups')) {
    scopes.add('backups')
    scopes.add('session')
  }
  if (lowerPathname.startsWith('/api/teams')) {
    scopes.add('teams')
    if (teamMutationChangesApplications(normalizedMethod, pathname)) {
      scopes.add('applications')
    }
    scopes.add('session')
  }
  if (lowerPathname.startsWith('/api/notifications') || lowerPathname.startsWith('/api/push')) {
    scopes.add('notifications')
  }
  if (lowerPathname.startsWith('/api/admin/notifications')) scopes.add('notifications')
  if (lowerPathname.startsWith('/api/ai/keys')) scopes.add('ai-keys')
  if (lowerPathname.startsWith('/api/discover')) scopes.add('discover')
  if (lowerPathname.startsWith('/api/admission-')) scopes.add('admission')
  if (/^\/api\/interview-prep\/workspace\/?$/i.test(pathname)) scopes.add('interview')
  if (
    lowerPathname.startsWith('/api/settings')
    || lowerPathname.startsWith('/api/account')
    || lowerPathname.startsWith('/api/auth/passkeys')
    || lowerPathname.startsWith('/api/admin/settings')
    || lowerPathname.startsWith('/api/admin/users')
  ) {
    scopes.add('session')
  }
  return [...scopes]
}
