import { createServer } from 'node:http'
import { join } from 'node:path'
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
process.env.HOST ??= '127.0.0.1'
process.env.PORT ??= await findFreePort()

const { startServer } = await import('../server/index.js')
const server = await startServer({
  host: process.env.HOST,
  port: Number(process.env.PORT),
  appOptions: { desktopEnabled: true },
})
const address = server.address()
const port = typeof address === 'object' && address ? address.port : Number(process.env.PORT)
console.log(`PhD Atlas desktop runtime ready on http://127.0.0.1:${port}`)
console.log(`PHD_ATLAS_DESKTOP=1 storage=${process.env.PHD_ATLAS_STORAGE_ROOT}`)

async function findFreePort() {
  return await new Promise((resolve, reject) => {
    const probe = createServer()
    probe.listen(0, '127.0.0.1', () => {
      const found = probe.address()
      const next = typeof found === 'object' && found ? found.port : 0
      probe.close((error) => (error ? reject(error) : resolve(next)))
    })
    probe.on('error', reject)
  })
}
