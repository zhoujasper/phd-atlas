import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export const DEFAULT_DEPENDENCY_REGISTRIES = [
  'https://registry.npmjs.org/',
  'https://registry.npmmirror.com/',
  'https://registry.yarnpkg.com/',
]
export const DEFAULT_DEPENDENCY_IDLE_TIMEOUT_MS = 5 * 60_000
export const DEFAULT_DEPENDENCY_ATTEMPT_TIMEOUT_MS = 15 * 60_000
export const DEFAULT_DEPENDENCY_TOTAL_TIMEOUT_MS = 30 * 60_000
const DEFAULT_HEARTBEAT_MS = 30_000
const MAX_OUTPUT_TAIL = 64 * 1024

export function dependencyArtifactCandidates(source) {
  const url = new URL(source)
  if (url.protocol !== 'https:') {
    throw new Error(`Dependency artifacts must use HTTPS: ${source}`)
  }
  const candidates = [url.href]
  if (['registry.npmjs.org', 'registry.npmmirror.com', 'registry.yarnpkg.com'].includes(url.hostname)) {
    for (const origin of [
      'https://registry.npmjs.org',
      'https://registry.npmmirror.com',
      'https://registry.yarnpkg.com',
    ]) {
      candidates.push(new URL(`${url.pathname}${url.search}`, origin).href)
    }
  }
  if (['github.com', 'objects.githubusercontent.com'].includes(url.hostname)) {
    for (const prefix of [
      'https://gh-proxy.com/',
      'https://ghproxy.net/',
      'https://ghpull.com/',
    ]) {
      candidates.push(`${prefix}${url.href}`)
    }
  }
  return [...new Set(candidates)]
}

function cleanProcessOutput(value) {
  const ansiEscapeSequence = new RegExp(
    `${String.fromCodePoint(27)}\\[[0-?]*[ -/]*[@-~]`,
    'g',
  )
  return String(value ?? '')
    .replace(ansiEscapeSequence, '')
    .replace(/\r/g, '')
}

function configuredTimeout(value, fallback) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 1_000 ? parsed : fallback
}

function normalizedRegistry(value) {
  try {
    const url = new URL(String(value ?? ''))
    if (url.protocol !== 'https:') return null
    return url.href.endsWith('/') ? url.href : `${url.href}/`
  } catch {
    return null
  }
}

export function dependencyInstallSources({
  vendored = false,
  env = process.env,
  registries = DEFAULT_DEPENDENCY_REGISTRIES,
} = {}) {
  if (vendored) return [{ label: 'bundled', registry: null, vendored: true }]
  const configured = normalizedRegistry(
    env.npm_config_registry
    ?? env.NPM_CONFIG_REGISTRY,
  )
  const sources = [
    ...(configured ? [{ label: 'configured', registry: configured }] : []),
    ...registries.map((registry, index) => ({
      label: index === 0 ? 'npmjs' : index === 1 ? 'npmmirror' : `mirror-${index + 1}`,
      registry: normalizedRegistry(registry),
    })),
  ]
  const seen = new Set()
  return sources.filter((source) => {
    if (!source.registry || seen.has(source.registry)) return false
    seen.add(source.registry)
    return true
  })
}

async function hasVendoredRuntimePackages(cwd) {
  try {
    await fs.access(path.join(cwd, 'tools', 'runtime-packages', 'index.json'))
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function terminateProcessTree(child, spawnProcess = spawn) {
  if (!child?.pid) return
  if (process.platform === 'win32') {
    const killer = spawnProcess(
      'taskkill.exe',
      ['/pid', String(child.pid), '/t', '/f'],
      { windowsHide: true, stdio: 'ignore' },
    )
    killer.once('error', () => child.kill('SIGKILL'))
    return
  }
  const killGroup = (signal) => {
    try {
      process.kill(-child.pid, signal)
    } catch {
      child.kill(signal)
    }
  }
  killGroup('SIGTERM')
  const forceTimer = setTimeout(() => killGroup('SIGKILL'), 5_000)
  forceTimer.unref?.()
}

function runInstallAttempt(cwd, source, options) {
  const spawnProcess = options.spawnProcess ?? spawn
  const idleTimeoutMs = options.idleTimeoutMs
  const attemptTimeoutMs = options.attemptTimeoutMs
  const heartbeatMs = options.heartbeatMs
  const npmArgs = [
    'ci',
    '--omit=dev',
    '--no-audit',
    '--no-fund',
    '--foreground-scripts',
    '--prefer-offline',
  ]
  const npmCommand = process.platform === 'win32'
    ? process.env.ComSpec ?? 'cmd.exe'
    : 'npm'
  const commandArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm.cmd', ...npmArgs]
    : npmArgs
  return new Promise((resolve, reject) => {
    const child = spawnProcess(npmCommand, commandArgs, {
      cwd,
      env: {
        ...options.env,
        npm_config_cache: options.cacheRoot,
        npm_config_progress: 'false',
        npm_config_update_notifier: 'false',
        npm_config_fetch_retries: '2',
        npm_config_fetch_retry_mintimeout: '1000',
        npm_config_fetch_retry_maxtimeout: '15000',
        ...(source.registry ? {
          npm_config_registry: source.registry,
          npm_config_replace_registry_host: 'always',
        } : {}),
      },
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const startedAt = Date.now()
    let lastProgressAt = startedAt
    let settled = false
    let outputTail = ''
    const outputBuffers = { stdout: '', stderr: '' }
    const finish = (callback) => {
      if (settled) return
      settled = true
      clearInterval(watchdog)
      callback()
    }
    const failForTimeout = (kind, elapsedMs) => {
      finish(() => {
        terminateProcessTree(child, spawnProcess)
        const error = Object.assign(
          new Error(`npm ci ${kind} timeout after ${Math.round(elapsedMs / 1_000)} seconds.`),
          {
            code: 'UPDATE_DEPENDENCY_INSTALL_TIMEOUT',
            updateDependencyOutput: outputTail,
            dependencySource: source.label,
          },
        )
        reject(error)
      })
    }
    const capture = (streamName, chunk) => {
      const text = cleanProcessOutput(chunk)
      if (!text) return
      lastProgressAt = Date.now()
      outputTail = `${outputTail}${text}`.slice(-MAX_OUTPUT_TAIL)
      const combined = `${outputBuffers[streamName]}${text}`
      const lines = combined.split('\n')
      outputBuffers[streamName] = lines.pop() ?? ''
      for (const line of lines) {
        const message = line.trim()
        if (message) options.onLine?.({ source, streamName, message })
      }
    }
    child.stdout?.on('data', (chunk) => capture('stdout', chunk))
    child.stderr?.on('data', (chunk) => capture('stderr', chunk))
    const watchdog = setInterval(() => {
      const now = Date.now()
      const elapsedMs = now - startedAt
      const idleMs = now - lastProgressAt
      options.onHeartbeat?.({ source, elapsedMs, idleMs })
      if (idleMs >= idleTimeoutMs) {
        failForTimeout('no-progress', idleMs)
      } else if (elapsedMs >= attemptTimeoutMs) {
        failForTimeout('attempt', elapsedMs)
      }
    }, Math.min(heartbeatMs, idleTimeoutMs, attemptTimeoutMs))
    watchdog.unref?.()
    child.once('error', (error) => finish(() => {
      const spawnCode = error?.code ?? null
      Object.assign(error, {
        code: 'UPDATE_DEPENDENCY_INSTALL_FAILED',
        spawnCode,
        updateDependencyOutput: outputTail,
        dependencySource: source.label,
      })
      reject(error)
    }))
    child.once('exit', (code, signal) => finish(() => {
      for (const [streamName, remainder] of Object.entries(outputBuffers)) {
        const message = remainder.trim()
        if (message) options.onLine?.({ source, streamName, message })
      }
      if (code === 0) {
        resolve({ source, outputTail })
        return
      }
      reject(Object.assign(
        new Error(`npm ci failed with ${signal ? `signal ${signal}` : `exit code ${code}`}.`),
        {
          code: 'UPDATE_DEPENDENCY_INSTALL_FAILED',
          updateDependencyOutput: outputTail,
          dependencySource: source.label,
        },
      ))
    }))
  })
}

export async function runProductionDependencyInstall(cwd, options = {}) {
  const env = options.env ?? process.env
  const vendored = options.vendored ?? await hasVendoredRuntimePackages(cwd)
  const sources = dependencyInstallSources({
    vendored,
    env,
    registries: options.registries,
  })
  if (sources.length === 0) {
    throw Object.assign(new Error('No HTTPS npm dependency source is configured.'), {
      code: 'UPDATE_DEPENDENCY_INSTALL_FAILED',
    })
  }
  const idleTimeoutMs = configuredTimeout(
    options.idleTimeoutMs ?? env.PHD_ATLAS_UPDATE_NPM_IDLE_TIMEOUT_MS,
    DEFAULT_DEPENDENCY_IDLE_TIMEOUT_MS,
  )
  const configuredAttemptTimeoutMs = configuredTimeout(
    options.attemptTimeoutMs ?? env.PHD_ATLAS_UPDATE_NPM_ATTEMPT_TIMEOUT_MS,
    DEFAULT_DEPENDENCY_ATTEMPT_TIMEOUT_MS,
  )
  const totalTimeoutMs = configuredTimeout(
    options.totalTimeoutMs ?? env.PHD_ATLAS_UPDATE_NPM_TOTAL_TIMEOUT_MS,
    DEFAULT_DEPENDENCY_TOTAL_TIMEOUT_MS,
  )
  const heartbeatMs = configuredTimeout(options.heartbeatMs, DEFAULT_HEARTBEAT_MS)
  const startedAt = Date.now()
  const failures = []
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index]
    const remainingMs = totalTimeoutMs - (Date.now() - startedAt)
    if (remainingMs < 1_000) break
    options.onAttempt?.({ source, index, total: sources.length })
    try {
      return await runInstallAttempt(cwd, source, {
        ...options,
        env,
        idleTimeoutMs: Math.min(idleTimeoutMs, remainingMs),
        attemptTimeoutMs: Math.min(configuredAttemptTimeoutMs, remainingMs),
        heartbeatMs,
        cacheRoot: options.cacheRoot
          ?? env.npm_config_cache
          ?? path.join(options.storageRoot ?? cwd, 'update-npm-cache'),
      })
    } catch (error) {
      failures.push(error)
      options.onAttemptFailure?.({ source, index, total: sources.length, error })
    }
  }
  const lastError = failures.at(-1)
  const message = failures.length > 0
    ? `Production dependency installation failed across ${failures.length} source attempt(s): ${
      failures.map((error) => `${error.dependencySource}: ${error.message}`).join('; ')
    }`
    : `Production dependency installation exceeded its ${Math.round(totalTimeoutMs / 1_000)}-second total timeout.`
  throw Object.assign(new Error(message), {
    code: lastError?.code ?? 'UPDATE_DEPENDENCY_INSTALL_TIMEOUT',
    updateDependencyOutput: failures
      .map((error) => `[${error.dependencySource ?? 'unknown'}]\n${error.updateDependencyOutput ?? error.message}`)
      .join('\n')
      .slice(-MAX_OUTPUT_TAIL),
    cause: lastError,
  })
}
