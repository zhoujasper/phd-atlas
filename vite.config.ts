import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

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
    port: 5173,
    strictPort: true,
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
    testTimeout: 15000,
    // Server-route suites share the workspace storage fixture. Bounding file
    // concurrency prevents Windows file locks and UI timer starvation while
    // still keeping the full suite parallel and fast.
    maxWorkers: 4,
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.js'],
  },
})
