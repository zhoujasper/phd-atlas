import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  defaultViteDevelopmentUrl,
  isPhdAtlasApiResponse,
  isPhdAtlasViteResponse,
  planDevelopmentStart,
} from '../tools/start-dev.mjs'

const projectRoot = path.resolve(import.meta.dirname, '..')
const waitScript = path.join(projectRoot, 'tools', 'wait-for-api.mjs')

describe('development startup sequencing', () => {
  it('uses an idempotent preflight before launching the workers', async () => {
    const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'))
    const fullCommand = packageJson.scripts['dev:full']
    const workerCommand = packageJson.scripts['dev:workers']

    expect(fullCommand).toBe('node tools/start-dev.mjs')
    expect(packageJson.scripts['dev:api']).toBe('node tools/start-server.mjs')
    expect(workerCommand).toContain('node tools/start-server.mjs')
    expect(workerCommand).toContain('node tools/wait-for-api.mjs && vite')
    expect(packageJson.scripts['dev:api:watch']).toBe('node --watch tools/start-server.mjs')
    expect(packageJson.scripts['dev:workers:watch']).toContain('node --watch tools/start-server.mjs')
    expect(packageJson.scripts['dev:watch']).toBe('npm run dev:workers:watch')
  })

  it('recognizes only the PhD Atlas API and Vite signatures', () => {
    expect(defaultViteDevelopmentUrl).toBe('http://[::1]:5173/')
    expect(isPhdAtlasApiResponse('{"ok":true,"data":{"status":"ok"}}')).toBe(true)
    expect(isPhdAtlasApiResponse('{"ok":true,"data":{"status":"other"}}')).toBe(false)
    expect(isPhdAtlasViteResponse(
      '<script type="module" src="/@vite/client"></script><meta content="PhD Atlas">',
    )).toBe(true)
    expect(isPhdAtlasViteResponse('<main>Another project</main>')).toBe(false)
  })

  it('reuses complete or partial PhD Atlas instances without touching foreign listeners', () => {
    expect(planDevelopmentStart('atlas', 'atlas')).toEqual({ kind: 'reuse' })
    expect(planDevelopmentStart('atlas', 'free')).toEqual({
      kind: 'start',
      script: 'dev:web',
      reused: 'API',
    })
    expect(planDevelopmentStart('free', 'atlas')).toEqual({
      kind: 'start',
      script: 'dev:api',
      reused: 'Vite',
    })
    expect(planDevelopmentStart('free', 'free')).toEqual({
      kind: 'start',
      script: 'dev:workers',
      reused: null,
    })
    expect(planDevelopmentStart('occupied', 'free')).toMatchObject({ kind: 'blocked' })
    expect(planDevelopmentStart('free', 'occupied')).toMatchObject({ kind: 'blocked' })
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
