export type LoadingVariant =
  | 'auth'
  | 'dashboard'
  | 'workspace'
  | 'profile'
  | 'settings'
  | 'team'
  | 'admin'
  | 'standalone'

export type ScreenSkeletonVariant = Exclude<LoadingVariant, 'auth' | 'admin' | 'standalone'>

function hasStoredSession(key: string) {
  if (typeof window === 'undefined') return false
  try {
    const value = window.localStorage.getItem(key)
    if (!value) return false
    const parsed = JSON.parse(value) as { token?: unknown }
    return typeof parsed?.token === 'string' && parsed.token.length > 0
  } catch {
    return false
  }
}

export function inferLoadingVariant(pathname = typeof window === 'undefined' ? '/' : window.location.pathname): LoadingVariant {
  if (pathname.startsWith('/admin')) {
    return hasStoredSession('phd-atlas-admin-session') ? 'admin' : 'auth'
  }

  if (
    pathname.startsWith('/share/')
    || pathname.startsWith('/asset-upload/')
    || pathname.startsWith('/reset-password/')
    || pathname.startsWith('/team/accept-invite/')
    || pathname.startsWith('/team/join/')
    || ['/upgrade-pro', '/pro', '/membership'].includes(pathname)
  ) {
    return 'standalone'
  }

  if (!hasStoredSession('phd-atlas-session')) return 'auth'
  if (pathname.startsWith('/applications/')) return 'workspace'
  if (pathname === '/applications') return 'workspace'
  if (pathname.startsWith('/profile')) return 'profile'
  if (pathname.startsWith('/settings')) return 'settings'
  if (pathname.startsWith('/team/applications/')) return 'workspace'
  if (pathname.startsWith('/team')) return 'team'
  return 'dashboard'
}
