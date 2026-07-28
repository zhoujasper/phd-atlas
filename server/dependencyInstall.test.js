import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_DEPENDENCY_REGISTRIES,
  dependencyArtifactCandidates,
  dependencyInstallSources,
  runProductionDependencyInstall,
} from './dependencyInstall.js'

class FakeProcess extends EventEmitter {
  constructor(pid = 42_001) {
    super()
    this.pid = pid
    this.stdout = new EventEmitter()
    this.stderr = new EventEmitter()
    this.kills = []
  }

  kill(signal) {
    this.kills.push(signal)
    return true
  }
}

describe('production dependency installer', () => {
  it('offers international and mainland mirrors for locked npm archives', () => {
    expect(dependencyArtifactCandidates(
      'https://registry.npmjs.org/express/-/express-5.2.1.tgz',
    )).toEqual([
      'https://registry.npmjs.org/express/-/express-5.2.1.tgz',
      'https://registry.npmmirror.com/express/-/express-5.2.1.tgz',
      'https://registry.yarnpkg.com/express/-/express-5.2.1.tgz',
    ])
  })

  it('uses the bundled graph as the first source while retaining online lifecycle access', async () => {
    const child = new FakeProcess()
    const spawnProcess = vi.fn(() => child)
    const result = runProductionDependencyInstall('C:\\runtime', {
      vendored: true,
      spawnProcess,
      cacheRoot: 'C:\\cache',
    })
    queueMicrotask(() => child.emit('exit', 0, null))

    await expect(result).resolves.toMatchObject({
      source: { label: 'bundled', vendored: true },
    })
    const [command, args, options] = spawnProcess.mock.calls[0]
    if (process.platform === 'win32') {
      expect(command.toLowerCase()).toMatch(/(?:^|[\\/])cmd\.exe$/)
      expect(args.slice(0, 4)).toEqual(['/d', '/s', '/c', 'npm.cmd'])
    } else {
      expect(command).toBe('npm')
    }
    expect(args).toEqual(expect.arrayContaining([
      'ci',
      '--omit=dev',
      '--foreground-scripts',
      '--prefer-offline',
    ]))
    expect(args).not.toContain('--offline')
    expect(options.env.npm_config_cache).toBe('C:\\cache')
    expect(options.env).not.toHaveProperty('npm_config_registry')
    expect(options.env.npm_config_fetch_retry_mintimeout).toBe('1000')
    expect(options.env.npm_config_fetch_retry_maxtimeout).toBe('15000')
    expect(options.detached).toBe(process.platform !== 'win32')
  })

  it('orders configured, international, and mainland mirrors without duplicates', () => {
    const sources = dependencyInstallSources({
      env: { npm_config_registry: 'https://registry.npmmirror.com' },
      registries: DEFAULT_DEPENDENCY_REGISTRIES,
    })

    expect(sources.map((source) => source.registry)).toEqual([
      'https://registry.npmmirror.com/',
      'https://registry.npmjs.org/',
      'https://registry.yarnpkg.com/',
    ])
  })

  it('falls through a failed registry to the next integrity-compatible mirror', async () => {
    const children = [new FakeProcess(42_101), new FakeProcess(42_102)]
    const spawnProcess = vi.fn(() => children.shift())
    const failures = []
    const result = runProductionDependencyInstall('C:\\runtime', {
      vendored: false,
      spawnProcess,
      registries: [
        'https://registry.npmjs.org/',
        'https://registry.npmmirror.com/',
      ],
      onAttemptFailure: (failure) => failures.push(failure.source.label),
    })
    queueMicrotask(() => {
      spawnProcess.mock.results[0].value.emit('exit', 1, null)
      queueMicrotask(() => spawnProcess.mock.results[1].value.emit('exit', 0, null))
    })

    await expect(result).resolves.toMatchObject({
      source: { registry: 'https://registry.npmmirror.com/' },
    })
    expect(failures).toEqual(['npmjs'])
    expect(spawnProcess.mock.calls[0][2].env.npm_config_replace_registry_host).toBe('always')
    expect(spawnProcess.mock.calls[1][2].env.npm_config_registry).toBe(
      'https://registry.npmmirror.com/',
    )
  })

  it('terminates an npm attempt after a finite period with no output', async () => {
    vi.useFakeTimers()
    try {
      const child = new FakeProcess(42_201)
      const killer = new FakeProcess(42_202)
      const spawnProcess = vi.fn()
        .mockReturnValueOnce(child)
        .mockReturnValueOnce(killer)
      const result = runProductionDependencyInstall('C:\\runtime', {
        vendored: true,
        spawnProcess,
        idleTimeoutMs: 1_000,
        attemptTimeoutMs: 10_000,
        totalTimeoutMs: 10_000,
        heartbeatMs: 1_000,
      })
      const rejection = expect(result).rejects.toMatchObject({
        code: 'UPDATE_DEPENDENCY_INSTALL_TIMEOUT',
      })
      await vi.advanceTimersByTimeAsync(1_100)
      await rejection
      if (process.platform === 'win32') {
        expect(spawnProcess.mock.calls[1][0]).toBe('taskkill.exe')
      } else {
        expect(child.kills).toContain('SIGTERM')
      }
    } finally {
      vi.useRealTimers()
    }
  })
})
