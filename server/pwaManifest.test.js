import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BUILD_ID_TOKEN, createBuildId, stampServiceWorker } from '../tools/stamp-service-worker.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const publicRoot = path.join(projectRoot, 'public')

function readManifest() {
  return JSON.parse(readFileSync(path.join(publicRoot, 'manifest.webmanifest'), 'utf8'))
}

function readPngDimensions(filePath) {
  const contents = readFileSync(filePath)
  expect(contents.subarray(1, 4).toString('ascii')).toBe('PNG')
  return {
    width: contents.readUInt32BE(16),
    height: contents.readUInt32BE(20),
  }
}

describe('installable PWA contract', () => {
  it('declares a stable standalone application identity', () => {
    const manifest = readManifest()

    expect(manifest).toMatchObject({
      id: '/',
      name: 'PhD Atlas',
      short_name: 'PhD Atlas',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      display_override: ['standalone', 'minimal-ui'],
      background_color: '#f5f5f7',
      theme_color: '#0071e3',
      prefer_related_applications: false,
      launch_handler: { client_mode: 'navigate-existing' },
      handle_links: 'preferred',
    })
    expect(manifest.shortcuts.map((shortcut) => shortcut.url)).toEqual([
      '/',
      '/applications',
      '/settings',
    ])
  })

  it('provides real 192px, 512px, and maskable PNG icons', () => {
    const { icons } = readManifest()
    const requiredIcons = [
      { src: '/pwa-192x192.png', sizes: '192x192', purpose: 'any' },
      { src: '/pwa-512x512.png', sizes: '512x512', purpose: 'any' },
      { src: '/pwa-maskable-512x512.png', sizes: '512x512', purpose: 'maskable' },
    ]

    for (const required of requiredIcons) {
      expect(icons).toContainEqual(expect.objectContaining({
        ...required,
        type: 'image/png',
      }))
      const [width, height] = required.sizes.split('x').map(Number)
      expect(readPngDimensions(path.join(publicRoot, required.src.slice(1)))).toEqual({
        width,
        height,
      })
    }
  })

  it('links the manifest and precaches all install metadata', () => {
    const indexHtml = readFileSync(path.join(projectRoot, 'index.html'), 'utf8')
    const serviceWorker = readFileSync(path.join(publicRoot, 'sw.js'), 'utf8')
    const registration = readFileSync(path.join(projectRoot, 'src', 'serviceWorker.ts'), 'utf8')
    const viteConfig = readFileSync(path.join(projectRoot, 'vite.config.ts'), 'utf8')
    const installAssets = [
      '/manifest.webmanifest',
      '/pwa-192x192.png',
      '/pwa-512x512.png',
      '/pwa-maskable-512x512.png',
    ]

    expect(indexHtml).toContain('<link rel="manifest" href="/manifest.webmanifest" />')
    for (const asset of installAssets) {
      expect(serviceWorker).toContain(`'${asset}'`)
    }
    expect(serviceWorker).toContain("const ASSET_MANIFEST_URL = '/asset-manifest.json'")
    expect(serviceWorker).toContain(`const BUILD_ID = '${BUILD_ID_TOKEN}'`)
    expect(serviceWorker).toContain('isSafeCacheableResponse')
    expect(serviceWorker).toContain('caches.match(request, { ignoreVary: true })')
    expect(serviceWorker).toContain('NAVIGATION_NETWORK_TIMEOUT_MS')
    expect(serviceWorker).toContain('fetch(request, { signal: controller.signal })')
    expect(serviceWorker).toContain('event.waitUntil(preloadCompletion)')
    expect(serviceWorker).toContain('response?.clone().arrayBuffer()')
    expect(serviceWorker).toContain('networkFirstNavigation(request, preloadResponse)')
    expect(serviceWorker).toContain("event.tag === 'phd-atlas-offline-sync'")
    expect(serviceWorker).toContain('self.registration.active ? undefined : self.skipWaiting()')
    expect(serviceWorker).toContain("notification.type !== 'push_test'")
    expect(viteConfig).toContain("manifest: 'asset-manifest.json'")
    expect(registration).toContain("updateViaCache: 'none'")
    expect(registration).toContain("window.addEventListener('focus', checkForUpdate)")
    expect(registration).toContain("window.addEventListener('pageshow', checkForUpdate)")
    expect(registration).toContain("window.dispatchEvent(new CustomEvent('phd-atlas:pwa-update-ready'))")
    expect(registration).toContain('export function activatePwaUpdate()')
  })

  it('stamps every changed production build with a new service worker cache version', () => {
    const outputRoot = mkdtempSync(path.join(tmpdir(), 'phd-atlas-sw-'))
    const serviceWorkerPath = path.join(outputRoot, 'sw.js')
    const assetPath = path.join(outputRoot, 'assets', 'app.js')
    const workerTemplate = [
      `const BUILD_ID = '${BUILD_ID_TOKEN}'`,
      'const CACHE = `phd-atlas-shell-${BUILD_ID}`',
    ].join('\n')

    try {
      mkdirSync(path.dirname(assetPath), { recursive: true })
      writeFileSync(serviceWorkerPath, workerTemplate, 'utf8')
      writeFileSync(assetPath, 'console.log("first build")', 'utf8')

      const firstBuildId = createBuildId(outputRoot)
      expect(createBuildId(outputRoot)).toBe(firstBuildId)
      expect(stampServiceWorker(outputRoot)).toBe(firstBuildId)
      expect(readFileSync(serviceWorkerPath, 'utf8')).toContain(firstBuildId)
      expect(readFileSync(serviceWorkerPath, 'utf8')).not.toContain(BUILD_ID_TOKEN)

      writeFileSync(serviceWorkerPath, workerTemplate, 'utf8')
      writeFileSync(assetPath, 'console.log("second build")', 'utf8')

      const secondBuildId = createBuildId(outputRoot)
      expect(secondBuildId).not.toBe(firstBuildId)
      expect(stampServiceWorker(outputRoot)).toBe(secondBuildId)
    } finally {
      rmSync(outputRoot, { recursive: true, force: true })
    }
  })
})
