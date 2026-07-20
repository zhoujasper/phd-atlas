const BUILD_ID = '__PHD_ATLAS_BUILD_ID__'
const SHELL_CACHE = `phd-atlas-shell-${BUILD_ID}`
const RUNTIME_CACHE = `phd-atlas-runtime-${BUILD_ID}`
const IS_DEVELOPMENT_WORKER = new URL(self.location.href).searchParams.has('dev')
const ASSET_MANIFEST_URL = '/asset-manifest.json'
const MAX_MANIFEST_ASSETS = 600
const MAX_CACHEABLE_BYTES = 8 * 1024 * 1024
const NAVIGATION_NETWORK_TIMEOUT_MS = 4_500
const APP_SHELL = [
  '/',
  ASSET_MANIFEST_URL,
  '/manifest.webmanifest',
  '/favicon.svg',
  '/favicon-48x48.png',
  '/apple-touch-icon.png',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512x512.png',
  '/icons.svg',
  '/boot-theme.js',
  '/boot-variant.js',
]

function expectedContentType(url) {
  if (url.pathname === '/') return 'text/html'
  if (url.pathname.endsWith('.js')) return 'javascript'
  if (url.pathname.endsWith('.css')) return 'text/css'
  if (url.pathname.endsWith('.webmanifest')) return 'manifest'
  if (url.pathname.endsWith('.json')) return 'json'
  if (/\.(?:png|svg|ico|webp|avif|jpe?g)$/i.test(url.pathname)) return 'image/'
  return null
}

function isSafeCacheableResponse(response, requestUrl) {
  if (!response || response.status !== 200 || !response.ok || response.redirected) return false
  if (response.type !== 'basic' && response.type !== 'default') return false

  const responseUrl = new URL(response.url || requestUrl.href, self.location.origin)
  if (requestUrl.origin !== self.location.origin || responseUrl.origin !== self.location.origin) return false

  const contentLength = Number(response.headers.get('content-length') || 0)
  if (Number.isFinite(contentLength) && contentLength > MAX_CACHEABLE_BYTES) return false

  const expected = expectedContentType(requestUrl)
  const contentType = (response.headers.get('content-type') || '').toLowerCase()
  if (!expected) return false
  if (expected === 'javascript') return contentType.includes('javascript')
  if (expected === 'manifest') return contentType.includes('manifest') || contentType.includes('json')
  if (expected === 'json') return contentType.includes('json')
  return contentType.includes(expected)
}

function collectBuiltAssetUrls(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Invalid production asset manifest.')
  }

  const assets = new Set()
  for (const entry of Object.values(manifest)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const candidates = [
      entry.file,
      ...(Array.isArray(entry.css) ? entry.css : []),
      ...(Array.isArray(entry.assets) ? entry.assets : []),
    ]
    for (const candidate of candidates) {
      if (typeof candidate !== 'string') continue
      const url = new URL(candidate, self.location.origin)
      if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
        assets.add(`${url.pathname}${url.search}`)
      }
    }
  }

  if (assets.size === 0 || assets.size > MAX_MANIFEST_ASSETS) {
    throw new Error('Production asset manifest is empty or unexpectedly large.')
  }
  return [...assets]
}

async function fetchCacheable(url) {
  const requestUrl = new URL(url, self.location.origin)
  const request = new Request(requestUrl, {
    cache: 'reload',
    credentials: 'same-origin',
  })
  const response = await fetch(request)
  if (!isSafeCacheableResponse(response, requestUrl)) {
    throw new Error(`Refused unsafe offline asset: ${requestUrl.pathname}`)
  }
  return { request, response }
}

async function precacheOfflineApp() {
  const cache = await caches.open(SHELL_CACHE)
  const manifestAsset = await fetchCacheable(ASSET_MANIFEST_URL)
  const manifest = await manifestAsset.response.clone().json()
  const builtAssets = collectBuiltAssetUrls(manifest)
  await cache.put(manifestAsset.request, manifestAsset.response)

  const shellAssets = APP_SHELL.filter((url) => url !== ASSET_MANIFEST_URL)
  await Promise.all([...shellAssets, ...builtAssets].map(async (url) => {
    const asset = await fetchCacheable(url)
    await cache.put(asset.request, asset.response)
  }))
}

self.addEventListener('install', (event) => {
  // Vite has no production asset manifest. The development worker exists solely
  // to exercise Push API subscriptions on trusted local hosts.
  event.waitUntil((IS_DEVELOPMENT_WORKER ? Promise.resolve() : precacheOfflineApp())
    // First install should become usable immediately. Updates stay waiting so
    // the app can protect unsaved work and let the user choose when to reload.
    .then(() => (self.registration.active ? undefined : self.skipWaiting())))
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable().catch(() => undefined)
    }
    await caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('phd-atlas-') && key !== SHELL_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim())
  })())
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
  if (event.data?.type === 'REQUEST_OFFLINE_SYNC') {
    event.waitUntil(notifyClientsToSync())
  }
})

async function notifyClientsToSync() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  clients.forEach((client) => client.postMessage({ type: 'OFFLINE_SYNC_REQUEST' }))
}

self.addEventListener('sync', (event) => {
  if (event.tag === 'phd-atlas-offline-sync') {
    event.waitUntil(notifyClientsToSync())
  }
})

function pushDestination(data) {
  if (typeof data?.targetPath === 'string' && data.targetPath.startsWith('/')) return data.targetPath
  if (typeof data?.applicationId === 'string' && data.applicationId) {
    const tab = typeof data.targetTab === 'string' && data.targetTab ? data.targetTab : 'dossier'
    return `/applications/${encodeURIComponent(data.applicationId)}/${encodeURIComponent(tab)}`
  }
  return '/'
}

async function handlePushNotification(notification) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const visibleClient = clients.find((client) => client.visibilityState === 'visible' && client.focused)
    || clients.find((client) => client.visibilityState === 'visible')
  if (visibleClient) {
    visibleClient.postMessage({ type: 'PUSH_NOTIFICATION', notification })
    // A transport test must surface as a real operating-system notification even
    // while Settings is visible. Otherwise the endpoint reports a successful push
    // but the user only gets an easy-to-miss in-app toast and reasonably concludes
    // that device delivery is broken. Normal pushes still avoid duplicate banners.
    if (notification.type !== 'push_test') return
  }

  await self.registration.showNotification(notification.title || 'PhD Atlas', {
    body: notification.body || '',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: `phd-atlas:${notification.id || notification.type || 'notification'}`,
    renotify: false,
    data: notification,
  })
}

self.addEventListener('push', (event) => {
  let notification = {}
  try {
    notification = event.data?.json() ?? {}
  } catch {
    notification = { title: 'PhD Atlas', body: event.data?.text() ?? '' }
  }
  event.waitUntil(handlePushNotification(notification))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const destination = pushDestination(event.notification.data)
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const client = clients.find((candidate) => candidate.url.startsWith(self.location.origin))
    if (client) {
      await client.focus()
      if (client.url !== `${self.location.origin}${destination}`) await client.navigate(destination)
      return
    }
    await self.clients.openWindow(destination)
  })())
})

function isStaticRequest(url) {
  return (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/i18n/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.json') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.ico') ||
    url.pathname.endsWith('.webmanifest')
  )
}

function isImmutableAssetRequest(url) {
  return url.pathname.startsWith('/assets/')
}

async function networkFirstNavigation(request, preloadResponse) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), NAVIGATION_NETWORK_TIMEOUT_MS)
  try {
    const timeoutFailure = new Promise((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('Navigation network timeout.')), { once: true })
    })
    const networkResponse = Promise.resolve(preloadResponse)
      .then((preloaded) => preloaded || fetch(request, { signal: controller.signal }))
    const response = await Promise.race([networkResponse, timeoutFailure])
    if (isSafeCacheableResponse(response, new URL('/', self.location.origin))) {
      const cache = await caches.open(SHELL_CACHE)
      cache.put('/', response.clone()).catch(() => undefined)
    }
    return response
  } catch {
    return (await caches.match(request)) || (await caches.match('/')) || Response.error()
  } finally {
    clearTimeout(timeout)
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request)
  const refresh = fetch(request)
    .then((response) => {
      if (isSafeCacheableResponse(response, new URL(request.url))) {
        caches.open(RUNTIME_CACHE)
          .then((cache) => cache.put(request, response.clone()))
          .catch(() => undefined)
      }
      return response
    })
    .catch(() => undefined)

  return cached || (await refresh) || Response.error()
}

async function cacheFirst(request) {
  // Hashed Vite assets are immutable and same-origin, but production middleware
  // adds Vary: Origin, Accept-Encoding. Module-import requests can therefore
  // carry different request headers from the install-time precache request and
  // miss an otherwise valid cached chunk during an offline cold start.
  const cached = await caches.match(request, { ignoreVary: true })
  if (cached) return cached
  const response = await fetch(request)
  if (isSafeCacheableResponse(response, new URL(request.url))) {
    const cache = await caches.open(RUNTIME_CACHE)
    cache.put(request, response.clone()).catch(() => undefined)
  }
  return response
}

self.addEventListener('fetch', (event) => {
  if (IS_DEVELOPMENT_WORKER) return

  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    // The response strategy may fall back to the cached shell when its timeout
    // wins the race. Keep the fetch event alive until Chrome's navigation
    // preload body settles as well; waiting only for the Response headers still
    // lets Chrome cancel the unread body and report an unhandled preload.
    const preloadResponse = event.preloadResponse.catch(() => undefined)
    const preloadCompletion = preloadResponse
      .then((response) => response?.clone().arrayBuffer())
      .catch(() => undefined)
    event.waitUntil(preloadCompletion)
    event.respondWith(networkFirstNavigation(request, preloadResponse))
    return
  }

  if (isImmutableAssetRequest(url)) {
    event.respondWith(cacheFirst(request))
    return
  }

  if (isStaticRequest(url)) {
    event.respondWith(staleWhileRevalidate(request))
  }
})
