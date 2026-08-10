function normalizedByteLimit(maxBytes) {
  const value = Number(maxBytes)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError('maxBytes must be a positive safe integer.')
  }
  return value
}

function signalAbortReason(signal) {
  if (signal?.reason !== undefined) return signal.reason
  const error = new Error('The upstream response read was aborted.')
  error.name = 'AbortError'
  error.code = 'ABORT_ERR'
  return error
}

function declaredContentLength(response) {
  const raw = String(response?.headers?.get?.('content-length') ?? '').trim()
  if (!/^\d+$/.test(raw)) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : Number.POSITIVE_INFINITY
}

export class UpstreamResponseTooLargeError extends Error {
  constructor(maxBytes, actualBytes, bodyKind = 'response') {
    super(`The upstream ${bodyKind} exceeded the ${maxBytes}-byte limit.`)
    this.name = 'UpstreamResponseTooLargeError'
    this.code = 'UPSTREAM_RESPONSE_TOO_LARGE'
    this.maxBytes = maxBytes
    this.actualBytes = actualBytes
  }
}

/** Releases an HTTP response that a caller deliberately will not consume. */
export async function cancelResponseBody(response, reason) {
  try {
    await response?.body?.cancel?.(reason)
  } catch {
    // Releasing a failed upstream response is best effort.
  }
}

/**
 * Reads an upstream Fetch response without allowing an unexpected body to be
 * buffered without bound. The limit applies to bytes delivered by the Fetch
 * stream (including bytes after transparent content decoding).
 */
export async function readBoundedResponseText(response, {
  maxBytes,
  signal,
  bodyKind = 'response',
} = {}) {
  const byteLimit = normalizedByteLimit(maxBytes)
  if (signal?.aborted) throw signalAbortReason(signal)

  const contentLength = declaredContentLength(response)
  if (contentLength !== null && contentLength > byteLimit) {
    await cancelResponseBody(response)
    throw new UpstreamResponseTooLargeError(byteLimit, contentLength, bodyKind)
  }

  const reader = response?.body?.getReader?.()
  if (!reader) {
    const error = new TypeError('The upstream response does not expose a readable byte stream.')
    error.code = 'UPSTREAM_RESPONSE_STREAM_UNAVAILABLE'
    throw error
  }

  const decoder = new TextDecoder()
  const parts = []
  let bytesRead = 0
  let completed = false
  let abortCancellation = null
  const cancelForAbort = () => {
    abortCancellation = Promise.resolve(reader.cancel(signalAbortReason(signal))).catch(() => {})
  }
  signal?.addEventListener('abort', cancelForAbort, { once: true })

  try {
    while (true) {
      let chunk
      try {
        chunk = await reader.read()
      } catch (error) {
        if (signal?.aborted) throw signalAbortReason(signal)
        throw error
      }
      if (signal?.aborted) throw signalAbortReason(signal)
      if (chunk.done) {
        completed = true
        break
      }
      if (!chunk.value || !Number.isSafeInteger(chunk.value.byteLength)) {
        throw new TypeError('The upstream response stream returned a non-byte chunk.')
      }
      bytesRead += chunk.value.byteLength
      if (bytesRead > byteLimit) {
        throw new UpstreamResponseTooLargeError(byteLimit, bytesRead, bodyKind)
      }
      parts.push(decoder.decode(chunk.value, { stream: true }))
    }
    parts.push(decoder.decode())
    return parts.join('')
  } finally {
    signal?.removeEventListener('abort', cancelForAbort)
    if (!completed && !abortCancellation) {
      try {
        await reader.cancel()
      } catch {
        // Preserve the original read/size/parse failure.
      }
    } else if (abortCancellation) {
      await abortCancellation
    }
    try {
      reader.releaseLock()
    } catch {
      // A non-conforming test double must not mask the useful failure.
    }
  }
}

export async function readBoundedResponseJson(response, options) {
  const body = await readBoundedResponseText(response, options)
  return JSON.parse(body)
}
