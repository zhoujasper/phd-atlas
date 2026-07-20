(() => {
  const screen = document.getElementById('boot-screen')
  if (!screen) return

  const hasToken = (key) => {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || 'null')
      return typeof parsed?.token === 'string' && parsed.token.length > 0
    } catch {
      return false
    }
  }

  const path = location.pathname
  let variant = 'dashboard'
  if (path.startsWith('/admin')) {
    variant = hasToken('phd-atlas-admin-session') ? 'admin' : 'auth'
  } else if (
    path.startsWith('/share/') ||
    path.startsWith('/asset-upload/') ||
    path.startsWith('/reset-password/') ||
    path.startsWith('/team/accept-invite/') ||
    ['/upgrade-pro', '/pro', '/membership'].includes(path)
  ) {
    variant = 'standalone'
  } else if (!hasToken('phd-atlas-session')) {
    variant = 'auth'
  } else if (path.startsWith('/applications') || path.startsWith('/team/applications/')) {
    variant = 'workspace'
  } else if (path.startsWith('/profile')) {
    variant = 'profile'
  } else if (path.startsWith('/settings')) {
    variant = 'settings'
  } else if (path.startsWith('/team')) {
    variant = 'team'
  }
  screen.classList.add(`launch-variant-${variant}`)
})()
