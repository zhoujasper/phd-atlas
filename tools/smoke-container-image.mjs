import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_ARCHITECTURES = ['amd64', 'arm64']
const VALID_ARCHITECTURES = new Set(DEFAULT_ARCHITECTURES)
const VALID_PULL_POLICIES = new Set(['always', 'missing', 'never'])

export function parseSmokeOptions(args, env = process.env) {
  const positional = []
  let architecturesValue = env.PHD_ATLAS_SMOKE_ARCHITECTURES || DEFAULT_ARCHITECTURES.join(',')
  let pullPolicy = env.PHD_ATLAS_SMOKE_PULL_POLICY || 'always'

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (value === '--architectures') {
      architecturesValue = args[index + 1] ?? ''
      index += 1
    } else if (value === '--pull') {
      pullPolicy = args[index + 1] ?? ''
      index += 1
    } else if (value.startsWith('--')) {
      throw new Error(`Unknown smoke option: ${value}`)
    } else {
      positional.push(value)
    }
  }

  const imageRef = positional[0] ?? ''
  const imageLabel = positional[1] ?? 'published'
  if (!imageRef) {
    throw new Error(
      'Usage: node tools/smoke-container-image.mjs <image-reference> [label] [--architectures amd64,arm64] [--pull always|missing|never]',
    )
  }

  const architectures = [...new Set(
    architecturesValue
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean),
  )]
  if (!architectures.length || architectures.some((architecture) => !VALID_ARCHITECTURES.has(architecture))) {
    throw new Error('Smoke architectures must be a non-empty subset of amd64,arm64.')
  }
  if (!VALID_PULL_POLICIES.has(pullPolicy)) {
    throw new Error('Smoke pull policy must be always, missing, or never.')
  }

  return { imageRef, imageLabel, architectures, pullPolicy }
}

export function sanitizeContainerName(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, 120)
}

function docker(args, { capture = false, allowFailure = false } = {}) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    windowsHide: true,
  })
  if (result.error && !allowFailure) throw result.error
  if (result.status !== 0 && !allowFailure) {
    const details = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    throw new Error(details || `Docker exited with status ${result.status ?? 'unknown'}.`)
  }
  return result
}

function removeImage(imageRef) {
  docker(['image', 'rm', '--force', imageRef], { capture: true, allowFailure: true })
}

function requestJson(port, pathname, timeoutMs) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: pathname,
      method: 'GET',
      headers: {
        Host: 'localhost',
        'X-Forwarded-Proto': 'https',
      },
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        if ((response.statusCode ?? 500) >= 400) {
          reject(new Error(`${pathname} returned HTTP ${response.statusCode}: ${body.slice(0, 500)}`))
          return
        }
        try {
          resolve(JSON.parse(body))
        } catch {
          reject(new Error(`${pathname} did not return JSON: ${body.slice(0, 500)}`))
        }
      })
    })
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`${pathname} timed out.`)))
    request.on('error', reject)
    request.end()
  })
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function readContainerState(containerName) {
  const result = docker(
    ['inspect', '--format', '{{json .State}}', containerName],
    { capture: true, allowFailure: true },
  )
  const value = String(result.stdout ?? '').trim()
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return { Status: 'unknown', Error: value.slice(0, 500) }
  }
}

async function waitForHealth(port, containerName, attempts = 120) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await requestJson(port, '/api/health', 3_000)
    } catch (error) {
      lastError = error
      const state = readContainerState(containerName)
      if (state && state.Status !== 'running') {
        throw new Error(
          `Container exited before becoming healthy `
          + `(status ${state.Status}, exit ${state.ExitCode ?? 'unknown'}): `
          + `${state.Error || lastError?.message || 'unknown container error'}`,
        )
      }
      if (attempt < attempts) await delay(2_000)
    }
  }
  throw new Error(`Container did not become healthy: ${lastError?.message ?? 'unknown health error'}`)
}

async function smokeContainerImageAttempt(options, smokeAttempt) {
  const jwtSecret = randomBytes(48).toString('hex')
  const settingsKey = randomBytes(32).toString('hex')
  const bootstrapUserPassword = `smoke-user-${randomBytes(24).toString('hex')}`
  const bootstrapAdminPassword = `smoke-admin-${randomBytes(24).toString('hex')}`
  if (process.env.GITHUB_ACTIONS === 'true') {
    for (const secret of [jwtSecret, settingsKey, bootstrapUserPassword, bootstrapAdminPassword]) {
      console.log(`::add-mask::${secret}`)
    }
  }

  const tempRoot = path.resolve(
    process.env.PHD_ATLAS_SMOKE_DIAGNOSTIC_DIR
      || path.join(os.tmpdir(), 'phd-atlas-container-smoke'),
  )
  await mkdir(tempRoot, { recursive: true })
  let activeContainer = ''
  let activeArchitecture = ''

  try {
    for (const architecture of options.architectures) {
      activeArchitecture = architecture
      // A manifest-list reference may resolve to a different platform on each
      // iteration. The classic Docker image store cannot retain both variants
      // under one digest, so remove the previous variant before the next pull.
      if (options.pullPolicy !== 'never') removeImage(options.imageRef)

      activeContainer = sanitizeContainerName([
        'phd-atlas',
        options.imageLabel,
        architecture,
        process.env.GITHUB_RUN_ID || 'local',
        process.env.GITHUB_RUN_ATTEMPT || process.pid,
        smokeAttempt,
      ].join('-'))

      const runResult = docker([
        'run',
        '--detach',
        '--pull', options.pullPolicy,
        '--platform', `linux/${architecture}`,
        '--name', activeContainer,
        '--env', 'NODE_ENV=production',
        '--env', 'PORT=4317',
        '--env', 'BASE_URL=https://localhost',
        '--env', 'CORS_ORIGIN=https://localhost',
        '--env', 'ALLOWED_HOSTS=localhost',
        // The smoke client reaches the container through exactly one Docker
        // forwarding hop and marks that simulated edge request as HTTPS.
        '--env', 'TRUST_PROXY=1',
        '--env', `JWT_SECRET=${jwtSecret}`,
        '--env', `SETTINGS_ENCRYPTION_KEY=${settingsKey}`,
        '--env', `BOOTSTRAP_USER_PASSWORD=${bootstrapUserPassword}`,
        '--env', `BOOTSTRAP_ADMIN_PASSWORD=${bootstrapAdminPassword}`,
        '--publish', '127.0.0.1::4317',
        options.imageRef,
      ], { capture: true })
      if (!String(runResult.stdout ?? '').trim()) {
        throw new Error(`Docker did not start the linux/${architecture} smoke container.`)
      }

      const portResult = docker(['port', activeContainer, '4317/tcp'], { capture: true })
      const publishedAddress = String(portResult.stdout ?? '').trim().split(/\r?\n/).at(-1) ?? ''
      const publishedPort = Number(publishedAddress.slice(publishedAddress.lastIndexOf(':') + 1))
      if (!Number.isSafeInteger(publishedPort) || publishedPort <= 0) {
        throw new Error(`Could not resolve the linux/${architecture} application port.`)
      }

      const health = await waitForHealth(publishedPort, activeContainer)
      const setup = await requestJson(publishedPort, '/api/setup/status', 10_000)
      const diagnosticPath = path.join(tempRoot, `${activeContainer}.json`)
      await writeFile(diagnosticPath, `${JSON.stringify({ health, setup }, null, 2)}\n`, 'utf8')

      if (health?.ok !== true || health?.data?.status !== 'ok') {
        throw new Error(`linux/${architecture} returned an invalid /api/health payload.`)
      }
      if (setup?.ok !== true || setup?.data?.required !== true) {
        throw new Error(`Fresh linux/${architecture} container did not require one-time /admin setup.`)
      }

      docker(['rm', '--force', '--volumes', activeContainer], { capture: true })
      activeContainer = ''
      if (options.pullPolicy !== 'never') removeImage(options.imageRef)
      console.log(`Verified ${options.imageLabel} linux/${architecture}: healthy and awaiting one-time /admin setup.`)
    }
  } catch (error) {
    let logs = ''
    let state = null
    if (activeContainer) {
      const logResult = docker(['logs', '--tail', '200', activeContainer], { capture: true, allowFailure: true })
      logs = [logResult.stdout, logResult.stderr].filter(Boolean).join('\n').trim()
      state = readContainerState(activeContainer)
      if (logs) console.error(logs)
    }
    const diagnosticPath = path.join(
      tempRoot,
      `${activeContainer || sanitizeContainerName(`phd-atlas-${options.imageLabel}-${activeArchitecture || 'unknown'}`)}-${Date.now()}-failure.json`,
    )
    await writeFile(diagnosticPath, `${JSON.stringify({
      at: new Date().toISOString(),
      imageRef: options.imageRef,
      imageLabel: options.imageLabel,
      architecture: activeArchitecture,
      container: activeContainer,
      error: error?.stack || String(error),
      state,
      logs,
    }, null, 2)}\n`, 'utf8')
    console.error(`Smoke diagnostic: ${diagnosticPath}`)
    throw error
  } finally {
    if (activeContainer) {
      docker(['rm', '--force', '--volumes', activeContainer], { capture: true, allowFailure: true })
    }
    if (options.pullPolicy !== 'never') removeImage(options.imageRef)
  }
}

export async function smokeContainerImage(options) {
  let firstError
  for (let smokeAttempt = 1; smokeAttempt <= 2; smokeAttempt += 1) {
    try {
      return await smokeContainerImageAttempt(options, smokeAttempt)
    } catch (error) {
      if (smokeAttempt === 2) {
        throw new AggregateError(
          [firstError, error].filter(Boolean),
          'Container smoke failed twice; publication remains blocked.',
        )
      }
      firstError = error
      console.warn('Container smoke attempt 1 failed; retrying once after a 5-second runtime-settle delay.')
      await delay(5_000)
    }
  }
}

async function main() {
  const options = parseSmokeOptions(process.argv.slice(2))
  await smokeContainerImage(options)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main()
}
