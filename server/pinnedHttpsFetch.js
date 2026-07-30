import https from 'node:https'
import { Readable, Transform } from 'node:stream'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import { resolvePinnedNetworkTarget } from './outboundNetworkPolicy.js'

const DEFAULT_MAX_RESPONSE_BYTES = 32 * 1024 * 1024

function responseBodyStream(response, encoding, maximumBytes) {
  let source = response
  if (encoding === 'gzip') source = source.pipe(createGunzip())
  if (encoding === 'deflate') source = source.pipe(createInflate())
  if (encoding === 'br') source = source.pipe(createBrotliDecompress())
  let received = 0
  return source.pipe(new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length
      if (received > maximumBytes) {
        const error = new Error(`HTTPS response exceeded the ${maximumBytes}-byte limit.`)
        error.code = 'OUTBOUND_RESPONSE_TOO_LARGE'
        callback(error)
        return
      }
      callback(null, chunk)
    },
  }))
}

function requestHeaders(initHeaders, host) {
  const headers = new Headers(initHeaders)
  headers.set('host', host)
  if (!headers.has('accept-encoding')) headers.set('accept-encoding', 'gzip, deflate, br')
  return Object.fromEntries(headers.entries())
}

/**
 * A deliberately small fetch-compatible HTTPS transport for server-owned JSON
 * and SSE requests. DNS is validated once and the socket connects to that
 * numeric result, while Host and TLS SNI retain the original hostname.
 */
export async function pinnedHttpsFetch(input, init = {}, options = {}) {
  const url = input instanceof URL ? new URL(input) : new URL(String(input))
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || !url.hostname
    || url.hash
  ) {
    const error = new Error('Only credential-free HTTPS URLs are supported.')
    error.code = 'INVALID_OUTBOUND_URL'
    throw error
  }
  const target = await (options.resolveTarget ?? resolvePinnedNetworkTarget)(url.hostname, {
    enforcePublic: options.enforcePublic ?? true,
    privateHostAllowlist: options.privateHostAllowlist,
  })
  const method = String(init.method ?? 'GET').toUpperCase()
  const maximumBytes = Number.isSafeInteger(options.maxResponseBytes)
    ? options.maxResponseBytes
    : DEFAULT_MAX_RESPONSE_BYTES

  return new Promise((resolve, reject) => {
    const request = (options.requestImpl ?? https.request)({
      protocol: 'https:',
      hostname: target.address,
      port: url.port ? Number(url.port) : 443,
      method,
      path: `${url.pathname}${url.search}`,
      headers: requestHeaders(init.headers, url.host),
      ...(target.servername ? { servername: target.servername } : {}),
      rejectUnauthorized: true,
      signal: init.signal,
    }, (incoming) => {
      const status = Number(incoming.statusCode ?? 0)
      if (status < 200 || status > 599) {
        incoming.destroy()
        reject(new Error('HTTPS server returned an invalid status code.'))
        return
      }
      const headers = new Headers()
      for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
        headers.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1])
      }
      const encoding = String(headers.get('content-encoding') ?? '').trim().toLowerCase()
      const hasBody = method !== 'HEAD' && ![204, 205, 304].includes(status)
      let body = null
      if (hasBody) {
        const decoded = responseBodyStream(incoming, encoding, maximumBytes)
        body = Readable.toWeb(decoded)
        if (['gzip', 'deflate', 'br'].includes(encoding)) {
          headers.delete('content-encoding')
          headers.delete('content-length')
        }
      }
      resolve(new Response(body, {
        status,
        statusText: incoming.statusMessage,
        headers,
      }))
    })
    request.once('error', reject)

    const body = init.body
    if (body === undefined || body === null) {
      request.end()
      return
    }
    if (
      typeof body === 'string'
      || Buffer.isBuffer(body)
      || body instanceof Uint8Array
    ) {
      request.end(body)
      return
    }
    request.destroy(new TypeError('Pinned HTTPS requests support only string or byte request bodies.'))
  })
}

export const pinnedHttpsFetchLimits = {
  maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
}
