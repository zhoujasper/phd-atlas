import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workerPath = path.join(projectRoot, 'public', 'sw.js')
const workerSource = readFileSync(workerPath, 'utf8')

function loadWorker(fetchImpl = vi.fn()) {
  const listeners = new Map()
  const context = vm.createContext({
    AbortController,
    Promise,
    Request,
    Response,
    URL,
    clearTimeout,
    console,
    fetch: fetchImpl,
    setTimeout,
    caches: {
      delete: vi.fn(),
      keys: vi.fn().mockResolvedValue([]),
      match: vi.fn().mockResolvedValue(undefined),
      open: vi.fn(),
    },
    self: {
      addEventListener: (type, listener) => listeners.set(type, listener),
      location: {
        href: 'https://phd-atlas.test/sw.js',
        origin: 'https://phd-atlas.test',
      },
    },
  })
  new vm.Script(workerSource, { filename: workerPath }).runInContext(context)
  return { context, listeners }
}

describe('service worker cache budget', () => {
  it('preloads only the static dependency graph of the application entry', () => {
    const { context } = loadWorker()
    const manifest = {
      'index.html': {
        file: 'assets/index.js',
        css: ['assets/index.css'],
        imports: ['_vendor.js'],
        dynamicImports: ['src/App.tsx'],
        isEntry: true,
      },
      '_vendor.js': {
        file: 'assets/vendor.js',
        imports: ['index.html'],
      },
      'src/App.tsx': {
        file: 'assets/App.js',
        isDynamicEntry: true,
      },
      'src/i18n/fr.json': {
        file: 'assets/fr.js',
        isDynamicEntry: true,
      },
    }
    context.__manifest = manifest

    const coreAssets = Array.from(vm.runInContext(
      'collectCoreBuiltAssetUrls(__manifest)',
      context,
    ))
    const shellAssets = Array.from(vm.runInContext('[...APP_SHELL]', context))

    expect(coreAssets).toEqual([
      '/assets/index.js',
      '/assets/index.css',
      '/assets/vendor.js',
    ])
    expect(coreAssets).not.toContain('/assets/App.js')
    expect(coreAssets).not.toContain('/assets/fr.js')
    expect(shellAssets).toHaveLength(9)
    expect(shellAssets).toEqual(expect.arrayContaining([
      '/',
      '/asset-manifest.json',
      '/manifest.webmanifest',
      '/pwa-192x192.png',
      '/pwa-512x512.png',
      '/pwa-maskable-512x512.png',
    ]))
  })

  it('limits install fetch concurrency and enforces one total byte budget', async () => {
    let activeFetches = 0
    let peakFetches = 0
    const fetchImpl = vi.fn(async () => {
      activeFetches += 1
      peakFetches = Math.max(peakFetches, activeFetches)
      await new Promise((resolve) => setTimeout(resolve, 5))
      activeFetches -= 1
      return new Response('x', {
        headers: {
          'cache-control': 'public, max-age=31536000, immutable',
          'content-length': '1',
          'content-type': 'application/javascript',
        },
      })
    })
    const { context } = loadWorker(fetchImpl)
    const cache = { put: vi.fn().mockResolvedValue(undefined) }
    context.__cache = cache
    context.__urls = Array.from({ length: 12 }, (_, index) => `/assets/core-${index}.js`)

    await vm.runInContext(
      'precacheAssets(__cache, __urls, { concurrency: 3, maxBytes: 12 })',
      context,
    )

    expect(fetchImpl).toHaveBeenCalledTimes(12)
    expect(cache.put).toHaveBeenCalledTimes(12)
    expect(peakFetches).toBe(3)

    context.__smallBudgetCache = { put: vi.fn().mockResolvedValue(undefined) }
    context.__smallBudgetUrls = ['/assets/a.js', '/assets/b.js', '/assets/c.js']
    await expect(vm.runInContext(
      'precacheAssets(__smallBudgetCache, __smallBudgetUrls, { concurrency: 1, maxBytes: 2 })',
      context,
    )).rejects.toThrow('exceeds the offline cache budget')
    expect(context.__smallBudgetCache.put).toHaveBeenCalledTimes(2)
  })

  it('applies stale-while-revalidate only to the explicit public API whitelist', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const { context, listeners } = loadWorker(fetchImpl)
    context.caches.open = vi.fn().mockResolvedValue({
      put: vi.fn().mockResolvedValue(undefined),
    })
    const fetchListener = listeners.get('fetch')
    expect(fetchListener).toBeTypeOf('function')

    const healthEvent = {
      request: new Request('https://phd-atlas.test/api/health'),
      respondWith: vi.fn(),
      waitUntil: vi.fn(),
    }
    fetchListener(healthEvent)
    expect(healthEvent.respondWith).toHaveBeenCalledOnce()
    const response = await healthEvent.respondWith.mock.calls[0][0]
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })

    const authEvent = {
      request: new Request('https://phd-atlas.test/api/auth/me'),
      respondWith: vi.fn(),
      waitUntil: vi.fn(),
    }
    fetchListener(authEvent)
    expect(authEvent.respondWith).not.toHaveBeenCalled()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
