import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const localDevelopmentHosts = Array.from(new Set([
  'localhost',
  'phd-atlas.local',
  'phd-atlas-dev',
  process.env.COMPUTERNAME,
  process.env.HOSTNAME,
]
  .map((host) => host?.trim().toLocaleLowerCase())
  .filter((host): host is string => Boolean(host))))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Vite otherwise treats every HTML file under the workspace as a scan
    // entry. Browser QA profiles live under logs/tmp and contain extension
    // pages with Chrome-only imports that are not application dependencies.
    entries: ['index.html'],
    include: ['react', 'react-dom/client', 'lucide-react', 'clsx'],
  },
  build: {
    sourcemap: false,
    manifest: 'asset-manifest.json',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          const normalized = id.replaceAll('\\', '/')
          if (
            normalized.includes('/node_modules/react/') ||
            normalized.includes('/node_modules/react-dom/') ||
            normalized.includes('/node_modules/scheduler/')
          ) {
            return 'react-vendor'
          }
          // Keep feature-only libraries inside their lazy route chunks instead of
          // promoting the rich editor or passkey helpers to startup.
          return undefined
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
      ignored: ['**/logs/tmp/**'],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4317',
        changeOrigin: true,
        ws: true,
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
  },
})
