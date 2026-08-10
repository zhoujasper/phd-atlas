import https from 'node:https'
import { Transform } from 'node:stream'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import { resolvePinnedNetworkTarget } from './outboundNetworkPolicy.js'

const DEFAULT_MAX_RESPONSE_BYTES = 32 * 1024 * 1024

function responseBodyStream(response, encoding, maximumBytes) {
  let source = response
  let decoder = null
  if (encoding === 'gzip') decoder = createGunzip()
  if (encoding === 'deflate') decoder = createInflate()
  if (encoding === 'br') decoder = createBrotliDecompress()
  if (decoder) source = source.pipe(decoder)
  let received = 0
  const limiter = source.pipe(new Transform({
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
  // `pipe()` deliberately does not forward source errors to its destination.
  // Make every owner converge on the one body error observed by the consumer.
  response.on('error', (error) => limiter.destroy(error))
  decoder?.on('error', (error) => limiter.destroy(error))
  return {
    stream: limiter,
    cancel() {
      // Do not pass the Web-stream cancellation reason into destroy(): after
      // the adapter removes its listeners that would create a late unhandled
      // Node `error` event. Cancellation is already represented to the reader.
      if (!limiter.destroyed) limiter.destroy()
      if (decoder && !decoder.destroyed) decoder.destroy()
      if (!response.destroyed) response.destroy()
    },
  }
}

/**
 * Node 24's `Readable.toWeb()` adapter can enqueue once more after a Web reader
 * is cancelled while an HTTPS/decompression stream is still emitting. That
 * process-level `ERR_INVALID_STATE` is especially harmful for bounded, timed
 * AI calls. This small adapter owns cancellation explicitly, removes every
 * listener before destroying the socket pipeline, and ignores all late data.
 */
function cancellationSafeWebBody(source, cancelSource) {
  let controller = null
  let closed = false
  let ended = false

  const cleanup = () => {
    source.removeListener('data', onData)
    source.removeListener('end', onEnd)
    source.removeListener('error', onError)
    source.removeListener('close', onClose)
  }
  const finish = () => {
    if (closed) return
    ended = true
    closed = true
    cleanup()
    controller.close()
  }
  const fail = (error) => {
    if (closed) return
    closed = true
    cleanup()
    controller.error(error)
    cancelSource()
  }
  const onData = (chunk) => {
    if (closed) return
    try {
      controller.enqueue(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk))
      if (controller.desiredSize !== null && controller.desiredSize <= 0) source.pause()
    } catch {
      // A consumer may cancel between the data event and enqueue. The closed
      // guard normally handles that race; fail closed if a runtime interleaves
      // the callbacks more aggressively.
      closed = true
      cleanup()
      cancelSource()
    }
  }
  const onEnd = () => finish()
  const onError = (error) => fail(error)
  const onClose = () => {
    if (!closed && !ended) fail(new Error('The HTTPS response body closed before it completed.'))
  }

  return new ReadableStream({
    start(nextController) {
      controller = nextController
      source.on('data', onData)
      source.once('end', onEnd)
      source.once('error', onError)
      source.once('close', onClose)
    },
    pull() {
      if (!closed) source.resume()
    },
    cancel() {
      if (closed) return
      closed = true
      cleanup()
      cancelSource()
    },
  })
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
        body = cancellationSafeWebBody(decoded.stream, decoded.cancel)
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
