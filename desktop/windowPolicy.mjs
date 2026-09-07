import { pathToFileURL } from 'node:url'

export const DESKTOP_CONTENT_SECURITY_POLICY = [
  "default-src 'self'", "base-uri 'self'", "script-src 'self'", "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*",
  "font-src 'self' data: blob:", "frame-src 'self' blob:",
  "worker-src 'self' blob:", "object-src 'none'", "form-action 'self'",
].join('; ')

export function desktopNavigationAllowed(value, { runtimeOrigin, splashPath }) {
  try {
    const url = new URL(value)
    return Boolean(runtimeOrigin && url.origin === runtimeOrigin)
      || url.href === pathToFileURL(splashPath).href
  } catch {
    return false
  }
}

export function desktopExternalUrlAllowed(value) {
  try {
    return ['https:', 'http:', 'mailto:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

export function desktopResponseHeaders(headers = {}) {
  const next = { ...headers }
  // CSP policies are cumulative. Keep route-specific restrictions (including
  // uploaded-content sandboxing) while adding the shell's navigation policy.
  const key = Object.keys(next).find((name) => name.toLowerCase() === 'content-security-policy')
  const existing = key ? next[key] : []
  if (key) delete next[key]
  next['Content-Security-Policy'] = [
    ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
    DESKTOP_CONTENT_SECURITY_POLICY,
  ]
  return next
}
