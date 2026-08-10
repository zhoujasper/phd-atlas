import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const execFileAsync = promisify(execFile)

function dockerHealthcheckCommand(dockerfile) {
  const match = dockerfile.match(/HEALTHCHECK[^\n]*\n\s*CMD\s+(\[[^\r\n]+\])/u)
  if (!match) throw new Error('Dockerfile HEALTHCHECK command is missing.')
  return JSON.parse(match[1])
}

function applicationUploadRoutes(serverSource, middlewarePattern) {
  const routes = []
  const matcher = new RegExp(
    String.raw`app\.post\(\s*(['"])(\/api\/[^'"]+)\1\s*,\s*${middlewarePattern}`,
    'gu',
  )
  for (const match of serverSource.matchAll(matcher)) routes.push(match[2])
  return routes.sort()
}

function concreteRoutePath(template) {
  return template.replace(/:[A-Za-z][A-Za-z0-9_]*/gu, 'sample')
}

function markedNginxLocationRegex(nginx, marker) {
  const markerIndex = nginx.indexOf(marker)
  if (markerIndex < 0) throw new Error(`Missing Nginx marker: ${marker}`)
  const match = nginx.slice(markerIndex).match(/location\s+~\*\s+(\^[^\r\n]+)\s+\{/u)
  if (!match) throw new Error(`Missing regex location after Nginx marker: ${marker}`)
  return new RegExp(match[1], 'iu')
}

function nginxLocationBlock(nginx, locationDeclaration) {
  const start = nginx.indexOf(locationDeclaration)
  if (start < 0) throw new Error(`Missing Nginx location: ${locationDeclaration}`)
  const openingBrace = nginx.indexOf('{', start)
  let depth = 0
  for (let index = openingBrace; index < nginx.length; index += 1) {
    if (nginx[index] === '{') depth += 1
    if (nginx[index] === '}') depth -= 1
    if (depth === 0) return nginx.slice(start, index + 1)
  }
  throw new Error(`Unterminated Nginx location: ${locationDeclaration}`)
}

function systemdSizeBytes(unit, key) {
  const match = unit.match(new RegExp(String.raw`^${key}=(\d+)([MG])\r?$`, 'mu'))
  if (!match) throw new Error(`Missing systemd size: ${key}`)
  return Number(match[1]) * (match[2] === 'G' ? 1024 ** 3 : 1024 ** 2)
}

describe('deployment resilience configuration', () => {
  it('uses the truthful readiness probe for the container health check', async () => {
    const dockerfile = await readFile(resolve(projectRoot, 'Dockerfile'), 'utf8')
    const smokeTool = await readFile(
      resolve(projectRoot, 'tools', 'smoke-container-image.mjs'),
      'utf8',
    )
    const systemdUnit = await readFile(
      resolve(projectRoot, 'deploy', 'linux', 'phd-atlas.service'),
      'utf8',
    )
    const [compose, serverSource, memoryPressureSource] = await Promise.all([
      readFile(resolve(projectRoot, 'compose.yaml'), 'utf8'),
      readFile(resolve(projectRoot, 'server', 'index.js'), 'utf8'),
      readFile(resolve(projectRoot, 'server', 'memoryPressure.js'), 'utf8'),
    ])

    expect(dockerfile).toContain("path:'/api/health/ready'")
    expect(dockerfile).not.toContain("path:'/api/health'")
    expect(dockerfile).toContain(
      "process.env.BASE_URL||process.env.DOMAIN||'https://localhost'",
    )
    expect(dockerfile).toMatch(/ENV NODE_ENV=production[\s\S]*?TRUST_PROXY=loopback/u)
    expect(dockerfile).toMatch(
      /PHD_ATLAS_PROJECT_ROOT=\/app[\s\S]*?PHD_ATLAS_STORAGE_ROOT=\/app\/storage/u,
    )
    expect(dockerfile).toContain('COPY shared ./shared')
    expect(dockerfile).toContain('COPY --from=build --chown=node:node /app/shared ./shared')
    expect(dockerfile).toContain('tools/verify-build-entry-budget.mjs ./tools/')
    expect(dockerfile).toContain('npm --ignore-scripts run build')
    expect(dockerfile).not.toMatch(/RUN npm run build/u)
    expect(smokeTool).toContain("requestJson(port, '/api/health/ready'")
    expect(compose).toContain('NODE_ENV: production')
    expect(compose).toContain('PHD_ATLAS_PROJECT_ROOT: /app')
    expect(compose).toContain('PHD_ATLAS_STORAGE_ROOT: /app/storage')
    expect(compose).toContain('phd-atlas-data:/app/storage')
    expect(compose).toContain('TRUST_PROXY: ${TRUST_PROXY:-1}')
    expect(compose).toContain('"127.0.0.1:${APP_PORT:-4317}:4317"')
    expect(serverSource).toContain("'X-PhD-Gateway-Error'")
    expect(systemdUnit).toContain('Restart=always')
    expect(systemdUnit).not.toContain('Restart=on-failure')
    expect(systemdUnit).toContain('StartLimitIntervalSec=300')
    expect(systemdUnit).toContain('StartLimitBurst=6')
    expect(systemdUnit).toContain('TimeoutStopSec=75')
    expect(systemdUnit).toContain('clamps cooperative drain to 20 seconds')
    expect(systemdUnit).not.toContain('55-second')
    expect(systemdUnit).toContain('MemoryHigh=1536M')
    expect(systemdUnit).toContain('MemoryMax=2G')
    expect(systemdUnit).toContain('TasksMax=256')
    expect(systemdUnit).toContain('CPUQuota=200%')
    expect(systemdUnit).toContain('EnvironmentFile=/etc/phd-atlas/phd-atlas.env')
    expect(systemdUnit).toContain(
      'ExecStart=/usr/bin/env NODE_ENV=production TRUST_PROXY=loopback RUNTIME_MEMORY_BUDGET_BYTES=1073741824 /usr/bin/node tools/start-server.mjs',
    )
    expect(systemdUnit).not.toMatch(
      /^Environment=(?:NODE_ENV|TRUST_PROXY|RUNTIME_MEMORY_BUDGET_BYTES)=/mu,
    )
    // start-server.mjs sizes the libuv pool from the host CPU count, and only
    // while the variable is unset. A pinned value in a deployment template
    // silently holds every host at the formula's floor. Assignment, not mere
    // mention: the unit documents the omission in a comment.
    expect(systemdUnit).not.toMatch(/^(?:Environment=)?UV_THREADPOOL_SIZE=/mu)
    expect(systemdUnit).not.toMatch(/^ExecStart=.*\bUV_THREADPOOL_SIZE=/mu)

    const mebibyte = 1024 ** 2
    const runtimeBudgetBytes = 1024 * mebibyte
    const hardBoundaryBytes = Math.floor(runtimeBudgetBytes * 0.875)
    const maximumSingleReservationBytes = 128 * mebibyte
    expect(memoryPressureSource).toContain('DEFAULT_MEMORY_HARD_RATIO = 0.875')
    expect(serverSource).toContain('export: 128 * MEBIBYTE')
    expect(serverSource).toContain('Math.min(128 * MEBIBYTE, estimatedBytes)')
    expect(systemdSizeBytes(systemdUnit, 'MemoryHigh') - hardBoundaryBytes)
      .toBeGreaterThan(maximumSingleReservationBytes)
    expect(systemdSizeBytes(systemdUnit, 'MemoryMax') - hardBoundaryBytes)
      .toBeGreaterThan(maximumSingleReservationBytes)
  })

  it('layers update and shutdown deadlines outside the durability retry budget', async () => {
    const [
      compose,
      systemdUnit,
      windowsService,
      workerSource,
      supervisorSource,
      helperSource,
      serverSource,
      systemUpdateSource,
    ] =
      await Promise.all([
        readFile(resolve(projectRoot, 'compose.yaml'), 'utf8'),
        readFile(resolve(projectRoot, 'deploy', 'linux', 'phd-atlas.service'), 'utf8'),
        readFile(resolve(projectRoot, 'deploy', 'windows', 'PhDAtlas.xml.example'), 'utf8'),
        readFile(resolve(projectRoot, 'tools', 'start-server.mjs'), 'utf8'),
        readFile(resolve(projectRoot, 'tools', 'container-entrypoint.mjs'), 'utf8'),
        readFile(resolve(projectRoot, 'tools', 'apply-update.mjs'), 'utf8'),
        readFile(resolve(projectRoot, 'server', 'index.js'), 'utf8'),
        readFile(resolve(projectRoot, 'server', 'systemUpdate.js'), 'utf8'),
      ])

    expect(workerSource).toContain('const DEFAULT_SHUTDOWN_TIMEOUT_MS = 20_000')
    expect(workerSource).toContain('const DEFAULT_STORAGE_SHUTDOWN_RETRY_MS = 40_000')
    expect(supervisorSource).toContain('DEFAULT_WORKER_SHUTDOWN_GRACE_MS = 70_000')
    expect(compose).toContain('stop_grace_period: ${PHD_ATLAS_STOP_GRACE_PERIOD:-75s}')
    expect(systemdUnit).toContain('TimeoutStopSec=75')
    expect(windowsService).toContain('<stoptimeout>75 sec</stoptimeout>')
    expect(windowsService).toContain('<env name="TRUST_PROXY" value="loopback" />')
    // Pinning the pool size here would defeat the CPU-count sizing in
    // start-server.mjs, which only runs while the variable is unset.
    expect(windowsService).not.toMatch(/<env\s+name="UV_THREADPOOL_SIZE"/u)
    expect(windowsService.match(/<onfailure action="restart"/gu)).toHaveLength(2)
    expect(windowsService).toContain('<onfailure action="none" />')
    expect(windowsService).toContain('<resetfailure>1 hour</resetfailure>')
    expect(helperSource).toContain('PREVIOUS_PROCESS_WAIT_TIMEOUT_MS = 65_000')
    expect(helperSource).toContain('await requireUpdateSafeShutdownMarker(storageRoot, claimedLock)')
    expect(helperSource.indexOf('await requireUpdateSafeShutdownMarker(storageRoot, claimedLock)'))
      .toBeLessThan(helperSource.indexOf('await applyUpdatePackage({'))
    expect(systemUpdateSource).toContain("UPDATE_SAFE_SHUTDOWN_NAME = '.update-safe-shutdown.json'")

    const listenerInstall = workerSource.indexOf(
      'const removeWorkerShutdownSignals = installPersistentWorkerShutdownSignals(',
    )
    const updateWait = workerSource.indexOf('waitForUpdateCompletion(storageRoot, {')
    const serverStart = workerSource.indexOf('const startingServer = startServer({')
    expect(listenerInstall).toBeGreaterThan(-1)
    expect(updateWait).toBeGreaterThan(-1)
    expect(listenerInstall).toBeLessThan(updateWait)
    expect(listenerInstall).toBeLessThan(serverStart)
    expect(workerSource).toContain('requestStorageTerminalShutdown()')
    expect(workerSource).toContain("reason: 'startup-failure'")
    expect(workerSource).toContain("reason: 'unexpected-listener-close'")
    expect(workerSource).toContain("reason: 'unexpected-before-exit'")
    expect(workerSource).toContain('appOptions: {')
    expect(workerSource).toContain('requestGracefulShutdown: (request) => {')
    expect(workerSource).toContain('const receipt = requestWorkerShutdown(request)')
    expect(workerSource).not.toContain('process.emit(WORKER_SHUTDOWN_REQUEST_EVENT, request)')
    expect(workerSource).toContain('await writeUpdateSafeShutdownMarker(storageRoot, {')
    expect(serverSource).toContain('return requestGracefulShutdown({')
    expect(serverSource).toContain('expectedExitCode: 75')
    expect(serverSource).toContain("reason: 'system-update'")
    expect(serverSource).not.toContain('process.exit(75)')
  })

  it('runs the exact Docker readiness command through the production loopback proxy contract', async () => {
    const dockerfile = await readFile(resolve(projectRoot, 'Dockerfile'), 'utf8')
    const [runtime, ...healthcheckArgs] = dockerHealthcheckCommand(dockerfile)
    expect(runtime).toBe('node')

    const temporaryRoot = await mkdtemp(join(tmpdir(), 'phd-atlas-deployment-health-'))
    const serverModuleUrl = pathToFileURL(resolve(projectRoot, 'server', 'index.js')).href
    const integrationScript = `
      import { spawn } from 'node:child_process'
      import { once } from 'node:events'

      const api = await import(${JSON.stringify(serverModuleUrl)})
      const app = api.createApp()
      app.locals.startupState = {
        status: 'ready',
        attempt: 1,
        retryDelayMs: null,
        errorCode: null,
      }
      const server = app.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      const probe = spawn(process.execPath, ${JSON.stringify(healthcheckArgs)}, {
        env: {
          ...process.env,
          BASE_URL: 'https://phd.example.com',
          PORT: String(address.port),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      let stderr = ''
      probe.stderr.setEncoding('utf8')
      probe.stderr.on('data', (chunk) => { stderr += chunk })
      const [code, signal] = await once(probe, 'exit')
      const stopped = await api.stopServer(server)
      if (!stopped.safeToShutdownStorage) {
        throw new Error('Deployment health integration did not stop cleanly.')
      }
      if (code !== 0) {
        throw new Error(
          'Docker HEALTHCHECK failed with ' + (signal || 'exit ' + code) + ': ' + stderr,
        )
      }
    `

    try {
      await execFileAsync(
        process.execPath,
        ['--input-type=module', '--eval', integrationScript],
        {
          cwd: projectRoot,
          env: {
            ...process.env,
            NODE_ENV: 'production',
            DOMAIN: 'https://phd.example.com',
            BASE_URL: 'https://phd.example.com',
            CORS_ORIGIN: 'https://phd.example.com',
            ALLOWED_HOSTS: 'phd.example.com',
            TRUST_PROXY: 'loopback',
            RATE_LIMIT_DISABLED: '0',
            JWT_SECRET: randomBytes(48).toString('base64url'),
            SETTINGS_ENCRYPTION_KEY: randomBytes(48).toString('base64url'),
            BOOTSTRAP_USER_PASSWORD: `Deployment-User-${randomBytes(18).toString('base64url')}!7`,
            BOOTSTRAP_ADMIN_PASSWORD: `Deployment-Admin-${randomBytes(18).toString('base64url')}!9`,
            PHD_ATLAS_STORAGE_ROOT: temporaryRoot,
            PHD_ATLAS_SQLITE_PATH: join(temporaryRoot, 'workspace.sqlite'),
          },
          maxBuffer: 1024 * 1024,
          timeout: 30_000,
          windowsHide: true,
        },
      )
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true })
    }
  })

  it('buffers ordinary responses while preserving only the four streaming endpoints', async () => {
    const nginx = await readFile(
      resolve(projectRoot, 'deploy', 'nginx', 'phd-atlas.conf'),
      'utf8',
    )

    for (const endpoint of [
      '/api/events',
      '/api/workspace/bootstrap/stream',
      '/api/ai/draft',
      '/api/health/ws',
    ]) {
      expect(nginx).toContain(`location = ${endpoint}`)
      const block = nginxLocationBlock(nginx, `location = ${endpoint}`)
      expect(block).toContain('proxy_buffering off;')
      expect(block).toContain('proxy_intercept_errors off;')
      expect(block).toContain('error_page 502 504 = @phd_atlas_api_unavailable;')
      expect(block).not.toContain('proxy_set_header Accept-Encoding "";')
    }
    for (const locationDeclaration of [
      'location @phd_atlas_static_upstream',
      'location ~* ^/api/(?:share/',
      'location ~* ^/api/applications/[^/]+/communications/send',
      'location ~* ^/api/admin/system-update/?$',
      'location ~* ^/api/auth/(?:login|register|password-reset|passkeys|impersonate|change-password)(?:/|$)',
      'location /api/',
      'location / {',
    ]) {
      expect(nginxLocationBlock(nginx, locationDeclaration))
        .toContain('proxy_set_header Accept-Encoding "";')
    }
    expect(nginx.match(/proxy_set_header Accept-Encoding "";/g)).toHaveLength(7)
    expect(nginx.match(/proxy_buffering off;/g)).toHaveLength(4)
    expect(nginx.match(/proxy_buffering on;/g)).toHaveLength(8)
    expect(nginx).toMatch(/upstream phd_atlas_upstream \{[\s\S]*?keepalive 64;/)
    expect(nginx).toContain("'' '';")
    expect(nginx).not.toContain("'' close;")
    expect(nginx).toContain('client_header_timeout 15s;')
    expect(nginx).toContain('proxy_connect_timeout 5s;')
    expect(nginx).toContain('gzip_comp_level 4;')
    expect(nginx).toMatch(/gzip_types[^;]*application\/x-ndjson[^;]*;/u)
    expect(nginxLocationBlock(nginx, 'location = /api/workspace/bootstrap/stream'))
      .toContain('proxy_buffering off;')
    const unavailableBlock = nginxLocationBlock(nginx, 'location @phd_atlas_api_unavailable')
    expect(unavailableBlock).toContain('"code":"SERVER_UNAVAILABLE"')
    expect(unavailableBlock).toContain(
      'add_header X-PhD-Gateway-Error "unavailable" always;',
    )
    expect(unavailableBlock).toContain(
      'add_header Access-Control-Expose-Headers "X-PhD-Gateway-Error, X-Request-Id, Retry-After" always;',
    )
    expect(nginx).toContain('error_page 429 = @phd_atlas_upload_busy;')
    const uploadBusyBlock = nginxLocationBlock(nginx, 'location @phd_atlas_upload_busy')
    expect(uploadBusyBlock).toContain('internal;')
    expect(uploadBusyBlock).toContain('default_type application/json;')
    expect(uploadBusyBlock).toContain('add_header Retry-After "2" always;')
    expect(uploadBusyBlock).toContain('return 429')
    expect(uploadBusyBlock).toContain('"code":"SERVER_BUSY"')
    expect(uploadBusyBlock).not.toContain('X-PhD-Gateway-Error')
    expect(nginx).toContain('error_page 413 = @phd_atlas_request_too_large;')
    const requestTooLargeBlock = nginxLocationBlock(
      nginx,
      'location @phd_atlas_request_too_large',
    )
    expect(requestTooLargeBlock).toContain('internal;')
    expect(requestTooLargeBlock).toContain('default_type application/json;')
    expect(requestTooLargeBlock).toContain('add_header Cache-Control "no-store" always;')
    expect(requestTooLargeBlock).toContain('add_header X-Request-Id $request_id always;')
    expect(requestTooLargeBlock).toContain('return 413')
    expect(requestTooLargeBlock).toContain('"code":"REQUEST_TOO_LARGE"')
    expect(requestTooLargeBlock).toContain('"message":"The request body is too large."')
    expect(requestTooLargeBlock).not.toContain('Retry-After')
    expect(requestTooLargeBlock).not.toContain('X-PhD-Gateway-Error')
    expect(nginx).toContain('proxy_intercept_errors off;')
    expect(nginx).toContain('error_page 502 504 = @phd_atlas_api_unavailable;')
    expect(nginx).toMatch(/location \/ \{[\s\S]*?proxy_read_timeout 120s;[\s\S]*?proxy_buffering on;/)
    expect(nginxLocationBlock(nginx, 'location ~* ^/api/admin/system-update/?$'))
      .toMatch(/proxy_read_timeout 3600s;[\s\S]*?proxy_buffering on;/u)
    expect(nginx).toContain('With proxy_intercept_errors off, an upstream')
    expect(nginx).toContain('structured JSON 5xx remains untouched.')
    expect(nginx).toContain(
      'an Nginx-owned 502/504 before upstream response headers have begun.',
    )
  })

  it('keeps large request bodies confined to the complete audited multipart route inventory', async () => {
    const [nginx, serverSource, mailBudgetSource, installation, installationZh] =
      await Promise.all([
        readFile(resolve(projectRoot, 'deploy', 'nginx', 'phd-atlas.conf'), 'utf8'),
        readFile(resolve(projectRoot, 'server', 'index.js'), 'utf8'),
        readFile(resolve(projectRoot, 'server', 'mailAttachmentBudget.js'), 'utf8'),
        readFile(resolve(projectRoot, 'INSTALLATION.md'), 'utf8'),
        readFile(resolve(projectRoot, 'INSTALLATION.zh-CN.md'), 'utf8'),
      ])

    const generalUploadRoutes = [
      '/api/applications/:id/materials',
      '/api/applications/:id/materials/:materialId/file',
      '/api/applications/:id/tasks/:taskId/file',
      '/api/asset-upload/:token/file',
      '/api/profile-assets/:id/files',
      '/api/share/:token/materials/:materialId/file',
      '/api/share/:token/tasks/:taskId/file',
    ].sort()
    const mailUploadRoutes = ['/api/applications/:id/communications/send']
    const systemUpdateRoutes = ['/api/admin/system-update']

    // These exact inventories make a new Multer endpoint fail closed until its
    // proxy body allowance has been deliberately classified and tested.
    expect(applicationUploadRoutes(serverSource, String.raw`uploadFiles\s*,`))
      .toEqual(generalUploadRoutes)
    expect(applicationUploadRoutes(serverSource, String.raw`mailUpload\.array\(`))
      .toEqual(mailUploadRoutes)
    expect(applicationUploadRoutes(serverSource, String.raw`systemUpdateUpload\.single\(`))
      .toEqual(systemUpdateRoutes)
    expect(serverSource.match(/\bmulter\(\{/gu) ?? []).toHaveLength(3)
    expect([
      ...serverSource.matchAll(
        /\b(?:upload|mailUpload|systemUpdateUpload)\.(?:array|fields|single|none|any)\(/gu,
      ),
    ].map((match) => match[0])).toEqual([
      'upload.array(',
      'mailUpload.array(',
      'systemUpdateUpload.single(',
    ])
    expect(serverSource).toContain('const MAX_UPLOAD_FILE_SIZE_BYTES = 25 * 1024 * 1024')
    expect(serverSource).toContain('const MAX_UPLOAD_FILES_PER_BATCH = 20')
    expect(serverSource).toContain('const MAX_MAIL_UPLOAD_FILES = 10')
    expect(serverSource).toContain('const MAX_SYSTEM_UPDATE_FILE_SIZE_BYTES = 100 * 1024 * 1024')
    expect(mailBudgetSource).toContain(
      'export const MAX_MAIL_ATTACHMENT_TOTAL_BYTES = 50 * 1024 * 1024',
    )

    const generalUploadLocation = markedNginxLocationRegex(
      nginx,
      '# PHD_ATLAS_MULTIPART_UPLOADS',
    )
    const mailUploadLocation = markedNginxLocationRegex(
      nginx,
      '# PHD_ATLAS_MAIL_MULTIPART',
    )
    const systemUpdateLocation = markedNginxLocationRegex(
      nginx,
      '# PHD_ATLAS_SYSTEM_UPDATE_UPLOAD',
    )
    const systemUpdateInstallLocation = markedNginxLocationRegex(
      nginx,
      '# PHD_ATLAS_SYSTEM_UPDATE_INSTALL',
    )
    for (const route of generalUploadRoutes) {
      expect(generalUploadLocation.test(concreteRoutePath(route)), route).toBe(true)
    }
    for (const route of mailUploadRoutes) {
      expect(mailUploadLocation.test(concreteRoutePath(route)), route).toBe(true)
    }
    for (const route of ['/api/admin/system-update', '/api/admin/system-update/']) {
      expect(systemUpdateLocation.test(route), route).toBe(true)
    }
    for (const route of [
      '/api/admin/system-update/install-release',
      '/api/admin/system-update/install-release/',
    ]) {
      expect(systemUpdateInstallLocation.test(route), route).toBe(true)
      expect(systemUpdateLocation.test(route), route).toBe(false)
    }
    for (const route of [
      '/api/admin/system-update//',
      '/api/admin/system-update/extra',
      '/api/admin/system-update/install-release/extra',
    ]) {
      expect(systemUpdateLocation.test(route), route).toBe(false)
      expect(systemUpdateInstallLocation.test(route), route).toBe(false)
    }

    for (const ordinaryRoute of [
      '/api/auth/login',
      '/api/applications/sample',
      '/api/applications/sample/communications',
      '/api/profile-assets/sample',
    ]) {
      expect(generalUploadLocation.test(ordinaryRoute), ordinaryRoute).toBe(false)
      expect(mailUploadLocation.test(ordinaryRoute), ordinaryRoute).toBe(false)
    }

    expect(nginx).toMatch(/server \{[\s\S]*?client_max_body_size 2m;/u)
    expect([...nginx.matchAll(/client_max_body_size\s+([^;]+);/gu)].map((match) => match[1]))
      .toEqual(['2m', '502m', '52m', '102m'])
    expect(nginx).not.toContain('location ^~ /api/')
    expect(nginxLocationBlock(nginx, 'location /api/'))
      .not.toContain('client_max_body_size')
    expect(nginxLocationBlock(nginx, 'location ~* ^/api/(?:share/'))
      .toContain('client_max_body_size 502m;')
    expect(nginxLocationBlock(nginx, 'location ~* ^/api/applications/[^/]+/communications/send'))
      .toContain('client_max_body_size 52m;')
    expect(nginxLocationBlock(nginx, 'location ~* ^/api/admin/system-update/?$'))
      .toContain('client_max_body_size 102m;')
    for (const locationDeclaration of [
      'location ~* ^/api/(?:share/',
      'location ~* ^/api/applications/[^/]+/communications/send',
      'location ~* ^/api/admin/system-update/?$',
    ]) {
      const block = nginxLocationBlock(nginx, locationDeclaration)
      expect(block).toContain('limit_conn phd_atlas_upload_global_conn 8;')
      expect(block).toContain('limit_conn phd_atlas_upload_ip_conn 4;')
      expect(block).toContain('limit_req zone=phd_atlas_upload_global_rate burst=16 nodelay;')
      expect(block).toContain('limit_req zone=phd_atlas_upload_ip_rate burst=8 nodelay;')
    }
    expect(nginx).toContain(
      'limit_req_zone $binary_remote_addr zone=phd_atlas_upload_ip_rate:10m rate=4r/s;',
    )
    expect(nginx).toContain('A campus/company NAT may use at most half')
    expect(nginx).toContain(
      'client_body_temp_path /var/lib/nginx/phd-atlas-client-body 1 2;',
    )
    for (const ordinaryOrStreamingLocation of [
      'location = /api/events',
      'location = /api/workspace/bootstrap/stream',
      'location = /api/ai/draft',
      'location = /api/health/ws',
      'location /api/',
    ]) {
      expect(nginxLocationBlock(nginx, ordinaryOrStreamingLocation))
        .not.toContain('limit_conn phd_atlas_upload_')
      expect(nginxLocationBlock(nginx, ordinaryOrStreamingLocation))
        .not.toContain('limit_req zone=phd_atlas_upload_')
    }
    expect(nginxLocationBlock(
      nginx,
      'location ~* ^/api/admin/system-update/install-release/?$',
    )).toMatch(/proxy_read_timeout 3600s;[\s\S]*?proxy_buffering on;/u)
    expect(nginxLocationBlock(
      nginx,
      'location ~* ^/api/admin/system-update/install-release/?$',
    )).not.toContain('client_max_body_size')
    expect(installation).not.toContain('client_max_body_size 550m')
    expect(installationZh).not.toContain('client_max_body_size 550m')
    expect(installation).toContain('only the\nnine audited multipart endpoints')
    expect(installationZh).toContain('审计过的 9 个\nmultipart 端点')
  })

  it('serves precompressed immutable assets directly or through a locked proxy cache', async () => {
    const nginx = await readFile(
      resolve(projectRoot, 'deploy', 'nginx', 'phd-atlas.conf'),
      'utf8',
    )
    const stampTool = await readFile(
      resolve(projectRoot, 'tools', 'stamp-service-worker.mjs'),
      'utf8',
    )

    expect(nginx).toContain('proxy_cache_path /var/cache/nginx/phd-atlas-static')
    expect(nginx).toMatch(/location \^~ \/assets\/ \{[\s\S]*?gzip_static on;[\s\S]*?try_files \$uri @phd_atlas_static_upstream;/)
    expect(nginx).toMatch(/location @phd_atlas_static_upstream \{[\s\S]*?proxy_cache phd_atlas_static;[\s\S]*?proxy_cache_lock on;/)
    expect(nginx).toContain('max-age=31536000, immutable')
    expect(nginx).not.toContain('max-age=31536000, immutable" always')
    expect(nginx).not.toMatch(/proxy_cache_valid\s+404\b/u)
    expect(nginx).toContain('proxy_no_cache $phd_atlas_static_no_cache;')
    expect(stampTool).toContain('precompressStaticAssets(outputRoot)')
    expect(stampTool).toContain('gzipSync(contents, { level: 9 })')
  })

  it('bounds container resources, logs, and graceful stop time', async () => {
    const compose = await readFile(resolve(projectRoot, 'compose.yaml'), 'utf8')

    expect(compose).toContain('stop_grace_period: ${PHD_ATLAS_STOP_GRACE_PERIOD:-75s}')
    expect(compose).toContain('mem_limit: ${PHD_ATLAS_MEMORY_LIMIT:-1g}')
    expect(compose).toContain('mem_reservation: ${PHD_ATLAS_MEMORY_RESERVATION:-512m}')
    expect(compose).toContain('RUNTIME_MEMORY_BUDGET_BYTES: ${RUNTIME_MEMORY_BUDGET_BYTES:-536870912}')
    expect(compose).toContain('cpus: ${PHD_ATLAS_CPU_LIMIT:-2.0}')
    expect(compose).toContain('pids_limit: ${PHD_ATLAS_PIDS_LIMIT:-256}')
    expect(compose).toContain('max-size: "${PHD_ATLAS_LOG_MAX_SIZE:-10m}"')
    expect(compose).toContain('max-file: "${PHD_ATLAS_LOG_MAX_FILES:-5}"')
  })

  it('keeps destructive volume deletion out of ordinary deployment and upgrade paths', async () => {
    const [deployment, deploymentZh, environmentExample, compose, systemdUnit] = await Promise.all([
      readFile(resolve(projectRoot, 'DEPLOYMENT.md'), 'utf8'),
      readFile(resolve(projectRoot, 'DEPLOYMENT.zh-CN.md'), 'utf8'),
      readFile(resolve(projectRoot, '.env.example'), 'utf8'),
      readFile(resolve(projectRoot, 'compose.yaml'), 'utf8'),
      readFile(resolve(projectRoot, 'deploy', 'linux', 'phd-atlas.service'), 'utf8'),
    ])

    expect(deployment).not.toContain('docker volume rm')
    expect(deploymentZh).not.toContain('docker volume rm')
    expect(deployment).toContain('localhost-only temporary HTTP previews')
    expect(deploymentZh).toContain('仅用于**本机临时 HTTP 体验**')
    expect(deployment).toContain('container-restart-fuse.json')
    expect(deploymentZh).toContain('container-restart-fuse.json')
    expect(systemdUnit).toContain('ReadWritePaths=/opt/phd-atlas')
    expect(systemdUnit).toContain('StateDirectory=phd-atlas')
    expect(deployment).toContain('PHD_ATLAS_STORAGE_ROOT=/var/lib/phd-atlas')
    expect(deploymentZh).toContain('PHD_ATLAS_STORAGE_ROOT=/var/lib/phd-atlas')
    expect(deployment).toContain('sudo mkdir -p /etc/phd-atlas')
    expect(deploymentZh).toContain('sudo mkdir -p /etc/phd-atlas')
    expect(deployment).toContain('chown 1000:1000 /www/wwwroot/phd-atlas-data')
    expect(deploymentZh).toContain('chown 1000:1000 /www/wwwroot/phd-atlas-data')
    expect(deployment).toContain('globally/four per client IP')
    expect(deploymentZh).toContain('全局 8 个、每客户端 IP 4 个')
    expect(deployment).toContain('structured JSON 429')
    expect(deploymentZh).toContain('结构化 JSON 429')
    expect(deployment.slice(deployment.indexOf('## Management commands')))
      .not.toMatch(/^docker (?:stop|start|restart|logs|exec)\b/mu)
    expect(deploymentZh.slice(deploymentZh.indexOf('## 管理命令')))
      .not.toMatch(/^docker (?:stop|start|restart|logs|exec)\b/mu)
    expect(deployment.slice(deployment.indexOf('## Management commands')))
      .not.toContain('http://your-domain')
    expect(deploymentZh.slice(deploymentZh.indexOf('## 管理命令')))
      .not.toContain('http://你的域名')
    expect(environmentExample).toContain('DOMAIN=https://phd.example.com')
    expect(environmentExample).toMatch(/^PHD_ATLAS_BOOTSTRAP_TOKEN=$/mu)
    expect(environmentExample).not.toContain('docker run')
    expect(compose).toMatch(
      /PHD_ATLAS_STORAGE_ROOT: \/app\/storage[\s\S]*?phd-atlas-data:\/app\/storage/u,
    )
  })

  it('applies proxy auth rate limits with a structured Retry-After contract', async () => {
    const nginx = await readFile(
      resolve(projectRoot, 'deploy', 'nginx', 'phd-atlas.conf'),
      'utf8',
    )

    expect(nginx).toContain(
      'limit_req_zone $server_name zone=phd_atlas_auth_global_rate:1m rate=20r/s;',
    )
    expect(nginx).toContain(
      'limit_req_zone $binary_remote_addr zone=phd_atlas_auth_ip_rate:10m rate=5r/s;',
    )
    expect(nginx).toContain(
      'limit_conn_zone $binary_remote_addr zone=phd_atlas_auth_ip_conn:10m;',
    )

    const authLocation = nginxLocationBlock(
      nginx,
      'location ~* ^/api/auth/(?:login|register|password-reset|passkeys|impersonate|change-password)(?:/|$)',
    )
    expect(authLocation).toContain('limit_conn phd_atlas_auth_ip_conn 8;')
    expect(authLocation).toContain('limit_req zone=phd_atlas_auth_global_rate burst=30 nodelay;')
    expect(authLocation).toContain('limit_req zone=phd_atlas_auth_ip_rate burst=12 nodelay;')
    expect(authLocation).toContain('error_page 429 = @phd_atlas_auth_busy;')
    expect(authLocation).not.toContain('limit_conn phd_atlas_upload_')

    const authBusyBlock = nginxLocationBlock(nginx, 'location @phd_atlas_auth_busy')
    expect(authBusyBlock).toContain('internal;')
    expect(authBusyBlock).toContain('default_type application/json;')
    expect(authBusyBlock).toContain('add_header Retry-After "2" always;')
    expect(authBusyBlock).toContain('return 429')
    expect(authBusyBlock).toContain('"code":"SERVER_BUSY"')
  })

  it('emits Strict-Transport-Security once behind the proxy and still covers other topologies', async () => {
    const [nginx, serverSource] = await Promise.all([
      readFile(resolve(projectRoot, 'deploy', 'nginx', 'phd-atlas.conf'), 'utf8'),
      readFile(resolve(projectRoot, 'server', 'index.js'), 'utf8'),
    ])

    // Node must keep sending it. Disabling it here would leave a different
    // proxy, a cloud load balancer, or a direct TLS listener with no HSTS.
    expect(serverSource).not.toContain('strictTransportSecurity: false')
    expect(nginx).toContain(
      'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;',
    )
    // The proxy drops the upstream copy so the browser still sees exactly one.
    expect(nginx).toContain('proxy_hide_header Strict-Transport-Security;')

    // A location that declares proxy_hide_header replaces the inherited list
    // rather than extending it, so each one must repeat the HSTS entry.
    for (const declaration of nginx.matchAll(/^[ \t]*location\s[^\n{]*\{/gmu)) {
      const start = declaration.index ?? 0
      let depth = 0
      let end = start
      for (let index = nginx.indexOf('{', start); index < nginx.length; index += 1) {
        if (nginx[index] === '{') depth += 1
        if (nginx[index] === '}') depth -= 1
        if (depth === 0) { end = index + 1; break }
      }
      const block = nginx.slice(start, end)
      if (!block.includes('proxy_hide_header')) continue
      expect(block, declaration[0].trim()).toContain('proxy_hide_header Strict-Transport-Security;')
    }
  })
})
