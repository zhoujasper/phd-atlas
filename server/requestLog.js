const SECRET_PATH_BOUNDARIES = [
  /^\/api\/share\/[^/]+/i,
  /^\/api\/asset-upload\/[^/]+/i,
  /^\/api\/teams\/invites\/[^/]+/i,
  /^\/api\/teams\/join-codes\/[^/]+/i,
]

export function sanitizedRequestTarget(value) {
  const raw = String(value ?? '')
  const queryIndex = raw.search(/[?#]/)
  let pathname = queryIndex >= 0 ? raw.slice(0, queryIndex) : raw
  for (const pattern of SECRET_PATH_BOUNDARIES) {
    pathname = pathname.replace(pattern, (match) => {
      const boundary = match.lastIndexOf('/')
      return `${match.slice(0, boundary + 1)}[redacted]`
    })
  }
  return queryIndex >= 0 ? `${pathname}?[redacted]` : pathname
}

export const SAFE_MORGAN_FORMAT = ':remote-addr - [:date[clf]] ":method :safe-url HTTP/:http-version" :status :res[content-length] :response-time ms ":user-agent"'
