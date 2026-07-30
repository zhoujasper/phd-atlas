import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentFile = fileURLToPath(import.meta.url)
const projectRoot = resolve(dirname(currentFile), '..')
const apiHealthUrl = process.env.API_HEALTH_URL || 'http://127.0.0.1:4317/api/health'
export const defaultViteDevelopmentUrl = 'http://[::1]:5173/'
const viteUrl = process.env.VITE_HEALTH_URL || defaultViteDevelopmentUrl
const probeTimeoutMs = 2_000

function isConnectionUnavailable(error) {
  const code = error?.cause?.code ?? error?.code
  return code === 'ECONNREFUSED' || code === 'EADDRNOTAVAIL' || code === 'ENETUNREACH'
}

export function isPhdAtlasApiResponse(body) {
  try {
    const payload = JSON.parse(body)
    return payload?.ok === true && payload?.data?.status === 'ok'
  } catch {
    return false
  }
}

export function isPhdAtlasViteResponse(body) {
  return body.includes('/@vite/client')
    && body.includes('content="PhD Atlas"')
}

async function probeService(url, matchesPhdAtlas) {
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'text/html, application/json',
        connection: 'close',
      },
      signal: AbortSignal.timeout(probeTimeoutMs),
    })
    const body = await response.text()
    return {
      status: response.ok && matchesPhdAtlas(body) ? 'atlas' : 'occupied',
      detail: `HTTP ${response.status}`,
    }
  } catch (error) {
    if (isConnectionUnavailable(error)) {
      return { status: 'free', detail: error?.cause?.code ?? error?.code }
    }
    return {
      status: 'occupied',
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

export function planDevelopmentStart(apiStatus, viteStatus) {
  if (apiStatus === 'occupied') {
    return {
      kind: 'blocked',
      message: 'Port 4317 is occupied by a service that is not a healthy PhD Atlas API.',
    }
  }
  if (viteStatus === 'occupied') {
    return {
      kind: 'blocked',
      message: 'The IPv6 development listener on port 5173 is occupied by a service that is not PhD Atlas Vite.',
    }
  }
  if (apiStatus === 'atlas' && viteStatus === 'atlas') {
    return { kind: 'reuse' }
  }
  if (apiStatus === 'atlas') {
    return { kind: 'start', script: 'dev:web', reused: 'API' }
  }
  if (viteStatus === 'atlas') {
    return { kind: 'start', script: 'dev:api', reused: 'Vite' }
  }
  return { kind: 'start', script: 'dev:workers', reused: null }
}

function npmInvocation(script) {
  if (process.env.npm_execpath) {
    return {
      command: process.execPath,
      args: [process.env.npm_execpath, 'run', script],
      shell: false,
    }
  }
  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: ['run', script],
    shell: process.platform === 'win32',
  }
}

async function runNpmScript(script) {
  const invocation = npmInvocation(script)
  const child = spawn(invocation.command, invocation.args, {
    cwd: projectRoot,
    env: process.env,
    shell: invocation.shell,
    stdio: 'inherit',
  })

  const forwardSignal = (signal) => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal)
    }
  }
  const onSigint = () => forwardSignal('SIGINT')
  const onSigterm = () => forwardSignal('SIGTERM')
  process.once('SIGINT', onSigint)
  process.once('SIGTERM', onSigterm)

  try {
    const result = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolve({ code, signal }))
    })
    process.exitCode = result.code ?? (result.signal === 'SIGINT' ? 130 : 1)
  } finally {
    process.removeListener('SIGINT', onSigint)
    process.removeListener('SIGTERM', onSigterm)
  }
}

export async function startDevelopment() {
  const [apiProbe, viteProbe] = await Promise.all([
    probeService(apiHealthUrl, isPhdAtlasApiResponse),
    probeService(viteUrl, isPhdAtlasViteResponse),
  ])
  const plan = planDevelopmentStart(apiProbe.status, viteProbe.status)

  if (plan.kind === 'blocked') {
    console.error(`[dev] ${plan.message}`)
    console.error('[dev] The listener was left untouched. Stop only the owning process after confirming its project.')
    process.exitCode = 1
    return
  }

  if (plan.kind === 'reuse') {
    console.log('[dev] PhD Atlas is already running; reusing the existing local instance.')
    console.log(`[dev] App: ${defaultViteDevelopmentUrl}`)
    console.log(`[dev] API: ${apiHealthUrl}`)
    return
  }

  if (plan.reused) {
    console.log(`[dev] Reusing the existing PhD Atlas ${plan.reused}; starting the missing service.`)
  }
  console.log(`[dev] App after startup: ${defaultViteDevelopmentUrl}`)
  await runNpmScript(plan.script)
}

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  await startDevelopment()
}
