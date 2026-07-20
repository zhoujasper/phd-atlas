import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const envFile = resolve(process.cwd(), '.env')
if (existsSync(envFile)) {
  process.loadEnvFile(envFile)
}

const updateLock = resolve(process.cwd(), 'storage', '.update-in-progress.json')
const updateDeadline = Date.now() + 15 * 60_000
while (existsSync(updateLock)) {
  if (Date.now() >= updateDeadline) {
    console.error(`Update lock ${updateLock} did not clear within 15 minutes. Refusing to start over a possibly changing runtime.`)
    process.exit(1)
  }
  await new Promise((resolveWait) => setTimeout(resolveWait, 500))
}

const { startServer } = await import('../server/index.js')

const server = await startServer()
const shutdown = () => {
  server.close(() => process.exit(0))
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
