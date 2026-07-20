import http from 'node:http'
import https from 'node:https'

const healthUrl = new URL(process.env.API_HEALTH_URL || 'http://127.0.0.1:4317/api/health')
const timeoutMs = 30_000
const retryDelayMs = 250
const deadline = Date.now() + timeoutMs
let ready = false

function checkHealth() {
  return new Promise((resolve) => {
    const transport = healthUrl.protocol === 'https:' ? https : http
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const request = transport.get(healthUrl, {
      headers: {
        accept: 'application/json',
        connection: 'close',
      },
    }, (response) => {
      const healthy = response.statusCode >= 200 && response.statusCode < 300
      // Consume the response before this short-lived process exits. Leaving a
      // fetch body/socket pending can trip Node's Windows libuv close assertion.
      response.resume()
      response.once('end', () => finish(healthy))
      response.once('error', () => finish(false))
    })
    request.setTimeout(2_000, () => {
      request.destroy()
      finish(false)
    })
    request.once('error', () => finish(false))
  })
}

while (Date.now() < deadline) {
  if (await checkHealth()) {
    ready = true
    break
  }
  // The API initializes storage and web-push state before listening.
  await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
}

if (!ready) {
  console.error(`PhD Atlas API did not become ready within ${timeoutMs / 1_000} seconds: ${healthUrl.href}`)
  process.exitCode = 1
}
