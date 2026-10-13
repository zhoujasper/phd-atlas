/**
 * Keeps an MCP device-approval code alive across sign-in. A client opens
 * `/settings?mcpCode=XXXX-XXXX`; when the browser is signed out the auth
 * surface and session reset can rewrite the URL, so the code is parked in
 * session storage and restored to Settings once a session exists.
 */
const STORAGE_KEY = 'phd-atlas:pending-mcp-code'
const MAX_AGE_MS = 15 * 60 * 1000

function codeFromSearch(search: string) {
  const query = new URLSearchParams(search)
  const value = (query.get('mcpCode') || query.get('codexCode'))?.trim() ?? ''
  return /^[0-9A-Za-z-]{4,16}$/.test(value) ? value : ''
}

export function capturePendingMcpCode() {
  if (typeof window === 'undefined') return
  const code = codeFromSearch(window.location.search)
  if (!code) return
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ code, at: Date.now() }))
  } catch {
    // Storage may be unavailable; the URL itself still carries the code.
  }
}

export function consumePendingMcpCode(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    window.sessionStorage.removeItem(STORAGE_KEY)
    const parsed = JSON.parse(raw) as { code?: unknown; at?: unknown }
    if (typeof parsed.code !== 'string' || typeof parsed.at !== 'number') return null
    if (Date.now() - parsed.at > MAX_AGE_MS) return null
    return codeFromSearch(`?mcpCode=${encodeURIComponent(parsed.code)}`) || null
  } catch {
    return null
  }
}

/** Puts a pending code back on the Settings URL and notifies route listeners. */
export function restorePendingMcpCode(): boolean {
  const code = consumePendingMcpCode()
  if (!code) return false
  if (codeFromSearch(window.location.search) === code && window.location.pathname === '/settings') return false
  window.history.replaceState(window.history.state, '', `/settings?mcpCode=${encodeURIComponent(code)}`)
  window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
  return true
}
