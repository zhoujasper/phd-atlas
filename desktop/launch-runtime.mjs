import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertDesktopIntegrity } from './integrity.mjs'
import { resolvePortableStorageRoot } from './portablePaths.mjs'

const projectRoot = join(fileURLToPath(new URL('..', import.meta.url)))
const dev = process.env.PHD_ATLAS_DESKTOP_DEV === '1' || process.env.NODE_ENV === 'test'
assertDesktopIntegrity(projectRoot, { dev })

process.env.PHD_ATLAS_DESKTOP = '1'
process.env.PHD_ATLAS_STORAGE_ROOT = resolvePortableStorageRoot({
  packaged: false,
  projectRoot,
  envStorageRoot: process.env.PHD_ATLAS_STORAGE_ROOT,
})
process.env.HOST = '127.0.0.1'

let shutdownRequested = false
let dispatchShutdown = null
const requestShutdown = () => {
  shutdownRequested = true
  dispatchShutdown?.()
}
process.on('SIGTERM', requestShutdown)
process.on('SIGINT', requestShutdown)
if (process.channel) process.on('disconnect', requestShutdown)
// IPC also provides graceful shutdown on Windows, where kill(SIGTERM) is fatal.
process.on('message', (message) => {
  if (message?.type === 'phd-atlas-desktop-shutdown') requestShutdown()
})

const { startServer, stopServer } = await import('../server/index.js')
const { requestStorageTerminalShutdown, shutdownStorage } = await import('../server/storage.js')
const { createBoundedGracefulShutdown } = await import('../tools/start-server.mjs')
const controller = new AbortController()
let server = null
let startupSettled = Promise.resolve()
let shutdownPromise = null
const shutdown = createBoundedGracefulShutdown({
  stopServer: () => stopServer(server),
  shutdownStorage,
})
dispatchShutdown = () => {
  if (shutdownPromise) return
  requestStorageTerminalShutdown()
  controller.abort(new Error('Desktop application is closing.'))
  shutdownPromise = startupSettled.then(() => shutdown({ expectedExitCode: 0, reason: 'desktop-quit' }))
}

const portFile = process.env.PHD_ATLAS_DESKTOP_PORT_FILE
let preferredPort = Number(process.env.PORT) || 0
if (!preferredPort && portFile) {
  try {
    const saved = JSON.parse(await readFile(portFile, 'utf8'))
    if (Number.isInteger(saved.port) && saved.port >= 1024 && saved.port <= 65535) preferredPort = saved.port
  } catch { /* A new or cleared cache receives a fresh local port. */ }
}

if (shutdownRequested) dispatchShutdown()
else {
  const start = async (port) => startServer({
    host: '127.0.0.1', port, signal: controller.signal,
    onListener: (listener) => { server = listener },
    appOptions: { desktopEnabled: true },
  })
  const starting = start(preferredPort).catch((error) => {
    if (preferredPort && error?.code === 'EADDRINUSE' && !shutdownRequested) return start(0)
    throw error
  })
  startupSettled = starting.then(() => undefined, () => undefined)
  try {
    server = await starting
    if (!shutdownRequested) {
      const port = server.address().port
      if (portFile) {
        try {
          await mkdir(dirname(portFile), { recursive: true })
          const temporary = `${portFile}.${process.pid}.tmp`
          await writeFile(temporary, JSON.stringify({ port }), { mode: 0o600 })
          await rename(temporary, portFile)
        } catch (error) {
          console.error('Could not remember the desktop local address:', error.code || error.message)
        }
      }
      console.log(`PhD Atlas desktop runtime ready on http://127.0.0.1:${port}`)
      console.log(`PHD_ATLAS_DESKTOP=1 storage=${process.env.PHD_ATLAS_STORAGE_ROOT}`)
    }
  } catch (error) {
    if (!shutdownRequested) {
      console.error('Desktop runtime startup failed:', error)
      process.exitCode = 1
      await shutdown({ expectedExitCode: 1, reason: 'desktop-startup-failed' })
    }
  }
}
