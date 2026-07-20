import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = path.resolve(import.meta.dirname, '..')
const waitScript = path.join(projectRoot, 'tools', 'wait-for-api.mjs')

describe('development startup sequencing', () => {
  it('waits for the API before launching Vite', async () => {
    const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'))
    const command = packageJson.scripts['dev:full']

    expect(command).toContain('node tools/wait-for-api.mjs && vite')
  })

  it('survives the API becoming available after the readiness probe starts', async () => {
    const reservation = http.createServer()
    reservation.listen(0, '127.0.0.1')
    await once(reservation, 'listening')
    const { port } = reservation.address()
    await new Promise((resolve) => reservation.close(resolve))

    const child = spawn(process.execPath, [waitScript], {
      cwd: projectRoot,
      env: {
        ...process.env,
        API_HEALTH_URL: `http://127.0.0.1:${port}/api/health`,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })

    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"ok":true}')
    })

    try {
      await new Promise((resolve) => setTimeout(resolve, 350))
      server.listen(port, '127.0.0.1')
      await once(server, 'listening')

      const [code, signal] = await once(child, 'exit')
      expect({ code, signal, stderr }).toEqual({ code: 0, signal: null, stderr: '' })
    } finally {
      if (server.listening) await new Promise((resolve) => server.close(resolve))
      if (child.exitCode === null && child.signalCode === null) child.kill()
    }
  })
})
