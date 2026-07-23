import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createImageRuntimeManifest,
  restartDelayMs,
  runContainerSupervisor,
  UPDATE_RESTART_EXIT_CODE,
  verifyImageRuntime,
} from '../tools/container-entrypoint.mjs'

class FakeWorker extends EventEmitter {
  exitCode = null
  signalCode = null
  kills = []
  pid

  constructor(pid = 10_000) {
    super()
    this.pid = pid
  }

  finish(code, signal = null) {
    this.exitCode = code
    this.signalCode = signal
    this.emit('exit', code, signal)
  }

  kill(signal) {
    this.kills.push(signal)
    this.finish(null, signal)
    return true
  }
}

const scratchRoots = new Set()

async function scratch(label) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `phd-atlas-entrypoint-${label}-`))
  scratchRoots.add(root)
  return root
}

afterEach(async () => {
  await Promise.all([...scratchRoots].map((root) => fs.rm(root, { recursive: true, force: true })))
  scratchRoots.clear()
})

function quietLogger() {
  return {
    error: vi.fn(),
    info: vi.fn(),
  }
}

describe('container update supervisor', () => {
  it('keeps the container alive across exit 75 without killing the detached helper path', async () => {
    const processRef = new EventEmitter()
    const workers = [new FakeWorker(), new FakeWorker()]
    const sleeps = []
    let spawnCount = 0
    let prepareCount = 0
    let updateWaitCount = 0

    const resultPromise = runContainerSupervisor({
      projectRoot: process.cwd(),
      storageRoot: process.cwd(),
      processRef,
      logger: quietLogger(),
      prepareRuntime: async () => {
        prepareCount += 1
      },
      waitForUpdate: async () => {
        updateWaitCount += 1
      },
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      spawnWorker: () => {
        const worker = workers[spawnCount]
        spawnCount += 1
        queueMicrotask(() => {
          worker.finish(spawnCount === 1 ? UPDATE_RESTART_EXIT_CODE : 0)
        })
        return worker
      },
    })

    await expect(resultPromise).resolves.toBe(0)
    expect(spawnCount).toBe(2)
    expect(prepareCount).toBe(2)
    expect(updateWaitCount).toBe(3)
    expect(sleeps).toEqual([restartDelayMs(1)])
    expect(workers[0].kills).toEqual([])
  })

  it('backs off runtime preparation failures instead of starting an old worker', async () => {
    const processRef = new EventEmitter()
    const worker = new FakeWorker()
    const sleeps = []
    let prepareCount = 0
    let spawnCount = 0

    const resultPromise = runContainerSupervisor({
      projectRoot: process.cwd(),
      storageRoot: process.cwd(),
      processRef,
      logger: quietLogger(),
      waitForUpdate: async () => {},
      prepareRuntime: async () => {
        prepareCount += 1
        if (prepareCount < 3) throw new Error('active package replay failed')
      },
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      spawnWorker: () => {
        spawnCount += 1
        queueMicrotask(() => worker.finish(0))
        return worker
      },
    })

    await expect(resultPromise).resolves.toBe(0)
    expect(prepareCount).toBe(3)
    expect(spawnCount).toBe(1)
    expect(sleeps).toEqual([restartDelayMs(1), restartDelayMs(2)])
  })

  it('forwards termination signals to the current worker', async () => {
    const processRef = new EventEmitter()
    const worker = new FakeWorker()
    const resultPromise = runContainerSupervisor({
      projectRoot: process.cwd(),
      storageRoot: process.cwd(),
      processRef,
      logger: quietLogger(),
      waitForUpdate: async () => {},
      prepareRuntime: async () => {},
      spawnWorker: () => {
        queueMicrotask(() => processRef.emit('SIGTERM'))
        return worker
      },
    })

    await expect(resultPromise).resolves.toBe(0)
    expect(worker.kills).toEqual(['SIGTERM'])
  })

  it('claims a pending boot before a broken launcher can exit and rolls it back once', async () => {
    const processRef = new EventEmitter()
    const workers = [new FakeWorker(61_001), new FakeWorker(61_002)]
    const claimPendingBoot = vi.fn(async () => ({}))
    const recoverPendingRuntime = vi.fn()
      .mockResolvedValueOnce({
        rolledBack: true,
        version: '0.2.0-beta.2',
      })
      .mockResolvedValueOnce({
        rolledBack: false,
        pending: false,
      })
    let spawnCount = 0

    const result = runContainerSupervisor({
      projectRoot: process.cwd(),
      storageRoot: process.cwd(),
      processRef,
      logger: quietLogger(),
      waitForUpdate: async () => {},
      prepareRuntime: async () => {},
      claimPendingBoot,
      recoverPendingRuntime,
      sleep: async () => {},
      spawnWorker: () => {
        const worker = workers[spawnCount]
        spawnCount += 1
        queueMicrotask(() => worker.finish(spawnCount === 1 ? 1 : 0))
        return worker
      },
    })

    await expect(result).resolves.toBe(0)
    expect(claimPendingBoot).toHaveBeenNthCalledWith(1, 61_001)
    expect(recoverPendingRuntime).toHaveBeenCalledTimes(2)
    expect(spawnCount).toBe(2)
  })

  it('fails closed without respawning when automatic first-boot rollback fails', async () => {
    const processRef = new EventEmitter()
    const worker = new FakeWorker(62_001)
    const logger = quietLogger()
    const spawnWorker = vi.fn(() => {
      queueMicrotask(() => worker.finish(1))
      return worker
    })

    await expect(runContainerSupervisor({
      projectRoot: process.cwd(),
      storageRoot: process.cwd(),
      processRef,
      logger,
      waitForUpdate: async () => {},
      prepareRuntime: async () => {},
      claimPendingBoot: async () => ({}),
      recoverPendingRuntime: async () => {
        throw new Error('rollback npm ci failed')
      },
      spawnWorker,
    })).resolves.toBe(1)

    expect(spawnWorker).toHaveBeenCalledOnce()
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('automatic update rollback could not complete'),
      expect.any(Error),
    )
  })

  it('releases a claimed trial boot on intentional supervisor termination', async () => {
    const processRef = new EventEmitter()
    const worker = new FakeWorker(63_001)
    const releasePendingBoot = vi.fn(async () => true)

    const result = runContainerSupervisor({
      projectRoot: process.cwd(),
      storageRoot: process.cwd(),
      processRef,
      logger: quietLogger(),
      waitForUpdate: async () => {},
      prepareRuntime: async () => {},
      claimPendingBoot: async () => ({}),
      releasePendingBoot,
      spawnWorker: () => {
        queueMicrotask(() => processRef.emit('SIGTERM'))
        return worker
      },
    })

    await expect(result).resolves.toBe(0)
    expect(releasePendingBoot).toHaveBeenCalledWith(63_001)
    expect(worker.kills).toEqual(['SIGTERM'])
  })

  it('uses an immutable image manifest to distinguish clean and modified runtimes', async () => {
    const root = await scratch('image-manifest')
    for (const [relativePath, contents] of [
      ['dist/index.html', '<title>clean</title>'],
      ['server/index.js', 'export const clean = true\n'],
      ['tools/start-server.mjs', 'export const clean = true\n'],
      ['tools/apply-update.mjs', 'export const clean = true\n'],
      ['tools/container-entrypoint.mjs', 'export const clean = true\n'],
      ['package.json', '{"name":"phd-atlas","version":"0.2.0-beta.3","type":"module"}\n'],
      ['package-lock.json', '{"name":"phd-atlas","version":"0.2.0-beta.3","lockfileVersion":3,"packages":{"":{"name":"phd-atlas","version":"0.2.0-beta.3"}}}\n'],
    ]) {
      const target = path.join(root, ...relativePath.split('/'))
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, contents)
    }
    const manifestPath = path.join(await scratch('immutable-manifest'), 'runtime-manifest.json')
    const manifest = await createImageRuntimeManifest(root, manifestPath)
    const imageRuntime = { version: manifest.version, manifest }

    await expect(verifyImageRuntime(root, imageRuntime)).resolves.toBe(true)
    await fs.writeFile(path.join(root, 'server', 'index.js'), 'export const clean = false\n')
    await expect(verifyImageRuntime(root, imageRuntime)).resolves.toBe(false)
  })
})
