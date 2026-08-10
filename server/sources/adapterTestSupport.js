import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function readFixture(name) {
  return readFileSync(resolve(process.cwd(), 'server', 'sources', 'fixtures', name), 'utf8')
}

export function jsonFixture(name) {
  return JSON.parse(readFixture(name))
}

export function jsonResponse(value, options = {}) {
  return new Response(JSON.stringify(value), {
    status: options.status || 200,
    headers: options.headers || {},
  })
}

export function htmlResponse(value, options = {}) {
  return new Response(String(value), {
    status: options.status || 200,
    headers: options.headers || { 'content-type': 'text/html; charset=utf-8' },
  })
}

export function neverSettlingFetch() {
  return (_url, init) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener?.('abort', () => reject(init.signal.reason), { once: true })
  })
}

export function fetchSequence(responses) {
  let index = 0
  return async () => {
    const response = responses[Math.min(index, responses.length - 1)]
    index += 1
    return response
  }
}
