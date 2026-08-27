import { configDefaults, defineConfig } from 'vitest/config'
import type { ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function configFilePath(moduleUrl: string) {
  // Node exposes a file URL here, while Vitest's transformed config module can
  // expose the native Windows absolute path. Treat both as the same local file
  // without accepting arbitrary non-file URL schemes.
  if (isAbsolute(moduleUrl)) return moduleUrl
  const parsed = new URL(moduleUrl)
  if (parsed.protocol !== 'file:') {
    throw new TypeError(`Unsupported Vite config URL scheme: ${parsed.protocol}`)
  }
  return fileURLToPath(parsed)
}

// Node's own experimental global `localStorage`/`sessionStorage` (unbacked
// without --localstorage-file) can shadow jsdom's per-window Storage
// instances depending on install order, leaving `localStorage` undefined in
// every Vitest run regardless of app code. Forked test workers inherit this
// process's env, so disabling it here reaches them before jsdom installs its
// own Storage globals.
// --expose-gc backs the deterministic memory-growth assertions in
// server/loginConcurrency.test.js: without a forced collection immediately
// before each `process.memoryUsage()` snapshot, not-yet-collected garbage
// from an earlier large allocation can inflate one snapshot but not the
// other, making an RSS delta assertion measure GC timing instead of actual
// retained memory.
process.env.NODE_OPTIONS = [
  process.env.NODE_OPTIONS,
  '--no-experimental-webstorage',
  '--expose-gc',
].filter(Boolean).join(' ')

const projectRoot = dirname(configFilePath(import.meta.url))
const packageMetadata = JSON.parse(
  readFileSync(resolve(projectRoot, 'package.json'), 'utf8'),
) as { version?: string }

export function resolveFrontendBuiltAt(
  environment: NodeJS.ProcessEnv = process.env,
  now: () => Date = () => new Date(),
) {
  const explicitlyConfigured = environment.VITE_FRONTEND_BUILT_AT?.trim()
  if (explicitlyConfigured) return explicitlyConfigured

  // Release/update builders expose the reproducible-build standard timestamp.
  // Use the same instant in the user-visible build metadata so content hashes,
  // service-worker cache ids, and the final archive stay stable across rebuilds.
  const sourceDateEpoch = environment.SOURCE_DATE_EPOCH?.trim()
  if (sourceDateEpoch && /^\d+$/u.test(sourceDateEpoch)) {
    const epochSeconds = Number(sourceDateEpoch)
    const builtAt = new Date(epochSeconds * 1000)
    if (Number.isSafeInteger(epochSeconds) && !Number.isNaN(builtAt.getTime())) {
      return builtAt.toISOString()
    }
  }

  return now().toISOString()
}

function gitValue(args: string[], fallback: string) {
  try {
    return execFileSync('git', args, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || fallback
  } catch {
    return fallback
  }
}

const frontendVersion = packageMetadata.version?.trim() || '0.0.0-dev'
const frontendBuiltAt = resolveFrontendBuiltAt()
const frontendCommit = (
  process.env.VITE_FRONTEND_COMMIT?.trim()
  || process.env.GITHUB_SHA?.trim().slice(0, 12)
  || gitValue(['rev-parse', '--short=12', 'HEAD'], 'unversioned')
)
const frontendSourceDirty = gitValue(['status', '--porcelain'], '') ? 'dirty' : 'clean'
const frontendBuildId = [
  frontendVersion,
  frontendBuiltAt.replaceAll(/[-:.]/gu, '').replace('T', '.').replace('Z', 'Z'),
  frontendCommit,
  frontendSourceDirty,
].join('+')

const localDevelopmentHosts = Array.from(new Set([
  'localhost',
  'phd-atlas.local',
  'phd-atlas-dev',
  process.env.COMPUTERNAME,
  process.env.HOSTNAME,
]
  .map((host) => host?.trim().toLocaleLowerCase())
  .filter((host): host is string => Boolean(host))))

// `npm run dev` runs the API under `node --watch`, so every source edit closes
// the listener for a second or two. Requests in flight across that window fail
// with one of these codes. They are expected and self-healing: answer them with
// the same JSON envelope the API uses for a temporary outage so the client's
// connectivity layer backs off and retries, instead of dumping a raw stack that
// reads like a server crash.
const TRANSIENT_PROXY_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'EPIPE',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ESOCKETTIMEDOUT',
])

type ProxyErrorTarget = {
  writableEnded?: boolean
  destroyed?: boolean
  headersSent?: boolean
  writeHead?: (status: number, headers: Record<string, string>) => unknown
  end?: (chunk?: string) => unknown
  destroy?: () => unknown
}

const configureApiProxy: NonNullable<ProxyOptions['configure']> = (proxy) => {
  proxy.on('error', (error, _request, response) => {
    const transient = TRANSIENT_PROXY_ERROR_CODES.has(
      String((error as NodeJS.ErrnoException)?.code ?? ''),
    )
    if (!transient) {
      console.error('[dev] API proxy error:', error?.message ?? error)
    }
    // `response` is a ServerResponse for ordinary requests and a raw Socket for
    // websocket/SSE upgrades.
    const target = response as unknown as ProxyErrorTarget | undefined
    if (!target || target.destroyed || target.writableEnded) return
    // A raw socket has no writeHead. Closing it lets EventSource run its own
    // reconnect backoff.
    if (typeof target.writeHead !== 'function') {
      target.destroy?.()
      return
    }
    if (target.headersSent) {
      target.end?.()
      return
    }
    target.writeHead(503, {
      'content-type': 'application/json; charset=utf-8',
      'retry-after': '1',
      'cache-control': 'no-store',
    })
    target.end?.(JSON.stringify({
      ok: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: transient
          ? 'The local API is restarting. The request was not applied; retry shortly.'
          : 'The local API could not be reached.',
      },
    }))
  })
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_FRONTEND_VERSION': JSON.stringify(frontendVersion),
    'import.meta.env.VITE_FRONTEND_BUILD_ID': JSON.stringify(frontendBuildId),
    'import.meta.env.VITE_FRONTEND_BUILT_AT': JSON.stringify(frontendBuiltAt),
    'import.meta.env.VITE_FRONTEND_COMMIT': JSON.stringify(frontendCommit),
    'import.meta.env.VITE_FRONTEND_SOURCE_STATE': JSON.stringify(frontendSourceDirty),
  },
  optimizeDeps: {
    // Vite otherwise treats every HTML file under the workspace as a scan
    // entry. Browser QA profiles live under logs/tmp and contain extension
    // pages with Chrome-only imports that are not application dependencies.
    entries: ['index.html'],
    include: [
      'react',
      'react-dom/client',
      'lucide-react',
      'clsx',
      'react-simple-code-editor',
      '@dnd-kit/core',
      '@dnd-kit/sortable',
      '@dnd-kit/utilities',
      'unified',
      'remark-parse',
      'remark-rehype',
      'remark-gfm',
      'rehype-parse',
      'rehype-raw',
      'rehype-sanitize',
      'rehype-stringify',
    ],
    // react-simple-code-editor advertises __esModule from CommonJS. Vite 8's
    // on-demand optimizer otherwise hands React the wrapping exports object.
    needsInterop: ['react-simple-code-editor'],
  },
  build: {
    sourcemap: false,
    manifest: 'asset-manifest.json',
    rollupOptions: {
      output: {
        // Rolldown's entry-aware groups keep feature-only dependencies attached
        // to the routes that use them. Application modules and i18n namespaces
        // deliberately stay under automatic splitting so a core locale import
        // cannot pull every screen dictionary into the launch path.
        codeSplitting: {
          groups: [
            {
              name: 'react-vendor',
              test: /[\\/]node_modules[\\/](?:react|react-dom|scheduler)(?:[\\/]|$)/,
              priority: 40,
            },
            {
              name: 'dnd-vendor',
              test: /[\\/]node_modules[\\/]@dnd-kit[\\/]/,
              priority: 30,
              entriesAware: true,
            },
            {
              name: 'markdown-vendor',
              test: /[\\/]node_modules[\\/](?:remark-|rehype-|unified[\\/]|micromark)/,
              priority: 20,
              entriesAware: true,
            },
            {
              name: 'ui-vendor',
              test: /[\\/]node_modules[\\/](?:lucide-react|clsx)(?:[\\/]|$)/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
  server: {
    // Bind the dual-stack wildcard so `localhost` can use ::1 even when
    // another local tool has mistakenly reserved only 127.0.0.1:5173.
    host: '::',
    port: 5173,
    strictPort: true,
    // Vite 8 blocks non-localhost Host headers by default. Keep the allow-list
    // bounded while supporting this machine's LAN name and the documented
    // local PhD Atlas aliases used by desktop/browser previews.
    allowedHosts: localDevelopmentHosts,
    watch: {
      // Local browser profiles, screenshots, and traces are disposable QA
      // artifacts. Their frequent writes must not trigger app rebuilds.
      // Ignore unused language packs to reduce file watcher pressure.
      ignored: [
        '**/logs/tmp/**',
        '**/src/i18n/{es,fr,it,ja,ko,pt,ru,th,vi,de}/**',
      ],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4317',
        changeOrigin: true,
        ws: true,
        configure: configureApiProxy,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    css: true,
    // App-level tests exercise several real lazy route chunks. On Windows a
    // cold transform cache or concurrent filesystem scan can legitimately push
    // those integration flows beyond 15 seconds without indicating a hang.
    testTimeout: 45_000,
    // Server-route suites share the workspace storage fixture. Release
    // preflight runs the source and a clean public export back to back while
    // Docker Desktop is resident, so two workers keep Windows and smaller CI
    // runners below the process/memory cliff without making the suite serial.
    maxWorkers: 2,
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.js'],
    // Mixed personal test files can retain historical collaboration cases.
    // Do not execute those named cases as part of current personal qualification.
    testNamePattern: /^(?!.*\bteam\b).*/i,
    // Team implementation and its historical tests remain in the repository as
    // an archive, but current qualification covers the supported personal product.
    exclude: [
      ...configDefaults.exclude,
      '**/*Team*.test.{ts,tsx,js}',
      '**/*team*.test.{ts,tsx,js}',
      'server/applicationTrashOwnership.test.js',
    ],
  },
})
