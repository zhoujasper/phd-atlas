import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { planPublicSync } from './plan-public-sync.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDirectory, '..')
const publicRepository = 'https://github.com/zhoujasper/phd-atlas.git'
const publicPackageUrl = 'https://raw.githubusercontent.com/zhoujasper/phd-atlas/main/package.json'
const zeroSha = '0'.repeat(40)
const maxCommandOutputTail = 64_000
const report = {
  startedAt: new Date().toISOString(),
  mode: '',
  result: 'running',
  steps: [],
}

function commandInvocation(name, args) {
  if (process.platform === 'win32' && name === 'npm') {
    const npmCli = process.env.npm_execpath
      || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    if (!existsSync(npmCli)) {
      throw new Error(`Could not locate the npm CLI at ${npmCli}.`)
    }
    return { command: process.execPath, args: [npmCli, ...args] }
  }
  return { command: name, args }
}

function appendOutputTail(current, chunk) {
  const next = `${current}${chunk}`
  return next.length > maxCommandOutputTail ? next.slice(-maxCommandOutputTail) : next
}

async function run(name, args, { cwd = projectRoot, env = process.env, capture = false } = {}) {
  const started = Date.now()
  const label = `${name} ${args.join(' ')}`
  console.log(`\n[preflight] ${label}`)
  return await new Promise((resolve, reject) => {
    const invocation = commandInvocation(name, args)
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout = capture ? `${stdout}${chunk}` : appendOutputTail(stdout, chunk)
      if (!capture) process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr = capture ? `${stderr}${chunk}` : appendOutputTail(stderr, chunk)
      if (!capture) process.stderr.write(chunk)
    })
    child.on('error', (error) => {
      report.steps.push({ label, status: 'failed', durationMs: Date.now() - started, error: error.message })
      reject(error)
    })
    child.on('exit', (code, signal) => {
      if (code === 0) {
        report.steps.push({ label, status: 'passed', durationMs: Date.now() - started })
        resolve({ stdout, stderr })
        return
      }
      const details = [stdout, stderr].filter(Boolean).join('\n').trim()
      const error = new Error(
        details || `${label} failed with ${signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`}.`,
      )
      report.steps.push({ label, status: 'failed', durationMs: Date.now() - started, error: error.message.slice(0, 2_000) })
      reject(error)
    })
  })
}

export function assertPackageMetadata(packageJson, lockJson) {
  const packageVersion = packageJson?.version
  const lockVersion = lockJson?.version
  const rootLockVersion = lockJson?.packages?.['']?.version
  const packageName = packageJson?.name
  const lockName = lockJson?.name
  const rootLockName = lockJson?.packages?.['']?.name

  if (!packageVersion || packageVersion !== lockVersion || packageVersion !== rootLockVersion) {
    throw new Error(
      `Version mismatch: package.json=${packageVersion || '(missing)'}, `
      + `package-lock.json=${lockVersion || '(missing)'}, package-lock root=${rootLockVersion || '(missing)'}.`,
    )
  }
  if (!packageName || packageName !== lockName || packageName !== rootLockName) {
    throw new Error(
      `Package-name mismatch: package.json=${packageName || '(missing)'}, `
      + `package-lock.json=${lockName || '(missing)'}, package-lock root=${rootLockName || '(missing)'}.`,
    )
  }
  return { name: packageName, version: packageVersion }
}

export function parseWorkflowDocument(contents, label) {
  const document = YAML.parseDocument(contents)
  if (document.errors.length) {
    throw new Error(`${label} is invalid YAML: ${document.errors.map((error) => error.message).join('; ')}`)
  }
  const workflow = document.toJS()
  if (!workflow || typeof workflow !== 'object' || !workflow.jobs || typeof workflow.jobs !== 'object') {
    throw new Error(`${label} does not contain a jobs mapping.`)
  }
  return workflow
}

export function assertWorkflowValidationContract(contents, label) {
  parseWorkflowDocument(contents, label)
  if (contents.includes('npx tsc --noEmit')) {
    throw new Error(`${label} uses the weaker tsc --noEmit check; use the shared tsc -b preflight.`)
  }
  if (!contents.includes('npm run verify:tree')) {
    throw new Error(`${label} does not call the shared verify:tree gate.`)
  }
}

function workflowStepScripts(job) {
  return Array.isArray(job?.steps)
    ? job.steps.map((step) => String(step?.run ?? '')).join('\n')
    : ''
}

export function assertPublicContainerWorkflowContract(contents, label = 'publish-container.yml') {
  const workflow = parseWorkflowDocument(contents, label)
  const publishJob = workflow.jobs?.['publish-main']
  if (!publishJob) {
    throw new Error(`${label} is missing the publish-main job.`)
  }
  if (publishJob.permissions?.actions !== 'read') {
    throw new Error(`${label} publish-main must have read access to matching CI run state.`)
  }
  const scripts = workflowStepScripts(publishJob)
  for (const required of [
    '--workflow ci.yml',
    '--commit "$GITHUB_SHA"',
    '--event push',
    'gh run watch "$run_id"',
    '--exit-status',
  ]) {
    if (!scripts.includes(required)) {
      throw new Error(`${label} publish-main is missing the matching-CI contract '${required}'.`)
    }
  }
  if (scripts.includes('npm run verify:tree')) {
    throw new Error(
      `${label} publish-main must consume the matching CI result instead of repeating the full tree gate.`,
    )
  }
}

export function assertReleaseWorkflowExecutionContract(contents, label = 'release.yml') {
  const workflow = parseWorkflowDocument(contents, label)
  if (workflow.jobs?.['mssql-release-gate']) {
    throw new Error(
      `${label} must keep the MSSQL gate in the release job so a passed gate cannot wait for a second runner.`,
    )
  }
  const releaseJob = workflow.jobs?.release
  if (!releaseJob) {
    throw new Error(`${label} is missing the release job.`)
  }
  if (releaseJob.needs) {
    throw new Error(`${label} release must not reacquire a runner after a prerequisite job.`)
  }
  const scripts = workflowStepScripts(releaseJob)
  if (!scripts.includes('PHD_ATLAS_SMOKE_DB_ENGINE=mssql')) {
    throw new Error(`${label} release job is missing the Microsoft SQL Server gate.`)
  }
  const installCount = scripts.match(/(?:^|\n)\s*npm ci\s*(?:\n|$)/g)?.length ?? 0
  if (installCount !== 1) {
    throw new Error(`${label} release job must install dependencies exactly once; found ${installCount}.`)
  }
}

export function assertReleaseWorkflowStateContract(contents, label = 'release.yml') {
  if (contents.includes('gh release view "$GITHUB_REF_NAME"')) {
    throw new Error(`${label} looks up a Draft Release by tag instead of its persisted database ID.`)
  }
  for (const required of [
    'RELEASE_ID=$release_id',
    'releases/${RELEASE_ID}',
    'releases/assets/${asset_id}',
  ]) {
    if (!contents.includes(required)) {
      throw new Error(`${label} is missing the ID-based Release contract '${required}'.`)
    }
  }
  const pinnedMetadataPatch = '{tag_name: $tag, target_commitish: $target'
  const pinnedMetadataPatchCount = contents.split(pinnedMetadataPatch).length - 1
  if (pinnedMetadataPatchCount < 2) {
    throw new Error(
      `${label} must pin tag_name and target_commitish in both Draft and publication PATCH payloads.`,
    )
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function validateContracts(root) {
  const packageJson = await readJson(path.join(root, 'package.json'))
  const lockJson = await readJson(path.join(root, 'package-lock.json'))
  const metadata = assertPackageMetadata(packageJson, lockJson)
  if (packageJson.scripts?.typecheck !== 'tsc -b --force') {
    throw new Error("package.json script 'typecheck' must be exactly 'tsc -b --force'.")
  }
  if (!String(packageJson.scripts?.build ?? '').startsWith('tsc -b &&')) {
    throw new Error("package.json script 'build' must start with 'tsc -b &&'.")
  }
  if (packageJson.phdAtlas?.runtimeDependencies) {
    throw new Error(
      'Release updates must derive production dependencies automatically; remove phdAtlas.runtimeDependencies.',
    )
  }
  for (const frontendDependency of ['react', 'react-dom', 'xlsx']) {
    if (packageJson.dependencies?.[frontendDependency]) {
      throw new Error(
        `Frontend build dependency '${frontendDependency}' must not enter the server production install graph.`,
      )
    }
    if (!packageJson.devDependencies?.[frontendDependency]) {
      throw new Error(`Frontend build dependency '${frontendDependency}' is missing from devDependencies.`)
    }
  }

  const runtimeManifestBuilder = await readFile(
    path.join(root, 'tools', 'runtime-package-manifest.mjs'),
    'utf8',
  )
  for (const required of [
    "'dependencies'",
    "'optionalDependencies'",
    'createVendoredRuntimePackageLock',
    'file:tools/runtime-packages/',
  ]) {
    if (!runtimeManifestBuilder.includes(required)) {
      throw new Error(`Runtime dependency packaging contract is missing '${required}'.`)
    }
  }
  const dependencyInstaller = await readFile(
    path.join(root, 'server', 'dependencyInstall.js'),
    'utf8',
  )
  for (const required of [
    'https://registry.npmjs.org/',
    'https://registry.npmmirror.com/',
    'https://registry.yarnpkg.com/',
    'DEFAULT_DEPENDENCY_IDLE_TIMEOUT_MS',
    'DEFAULT_DEPENDENCY_TOTAL_TIMEOUT_MS',
    'npm_config_replace_registry_host',
  ]) {
    if (!dependencyInstaller.includes(required)) {
      throw new Error(`Runtime dependency installation contract is missing '${required}'.`)
    }
  }
  const updatePackageVerifier = await readFile(
    path.join(root, 'tools', 'verify-update-package.mjs'),
    'utf8',
  )
  if (!updatePackageVerifier.includes("'--offline'")) {
    throw new Error('Update package verification must prove the bundled dependency graph offline.')
  }

  const sourceTemplates = path.join(root, '.public')
  const workflowPaths = existsSync(sourceTemplates)
    ? [
        path.join(root, '.github', 'workflows', 'sync-public.yml'),
        path.join(sourceTemplates, 'ci.yml'),
        path.join(sourceTemplates, 'publish-container.yml'),
        path.join(sourceTemplates, 'release.yml'),
      ]
    : [
        path.join(root, '.github', 'workflows', 'ci.yml'),
        path.join(root, '.github', 'workflows', 'publish-container.yml'),
        path.join(root, '.github', 'workflows', 'release.yml'),
      ]

  for (const workflowPath of workflowPaths) {
    const contents = await readFile(workflowPath, 'utf8')
    assertWorkflowValidationContract(contents, path.relative(root, workflowPath))
    const workflowName = path.basename(workflowPath)
    if (workflowName === 'publish-container.yml') {
      assertPublicContainerWorkflowContract(contents, path.relative(root, workflowPath))
    }
    if (workflowName === 'release.yml') {
      assertReleaseWorkflowExecutionContract(contents, path.relative(root, workflowPath))
      assertReleaseWorkflowStateContract(contents, path.relative(root, workflowPath))
    }
  }

  const smokeScript = await readFile(path.join(root, 'tools', 'smoke-container-image.mjs'), 'utf8')
  for (const required of [
    "const DEFAULT_ARCHITECTURES = ['amd64', 'arm64']",
    'BOOTSTRAP_USER_PASSWORD',
    'BOOTSTRAP_ADMIN_PASSWORD',
    'TRUST_PROXY=1',
    '/api/setup/status',
    'setup?.data?.required !== true',
    'PHD_ATLAS_SMOKE_DIAGNOSTIC_DIR',
    'Container smoke failed twice; publication remains blocked.',
    'Container exited before becoming healthy',
  ]) {
    if (!smokeScript.includes(required)) {
      throw new Error(`Container smoke contract is missing '${required}'.`)
    }
  }

  const dockerfile = await readFile(path.join(root, 'Dockerfile'), 'utf8')
  for (const required of [
    'FROM node:24-alpine AS build',
    'COPY tools/start-server.mjs tools/apply-update.mjs tools/container-entrypoint.mjs tools/stamp-service-worker.mjs ./tools/',
    'npm prune --omit=dev',
  ]) {
    if (!dockerfile.includes(required)) {
      throw new Error(`Dockerfile release contract is missing '${required}'.`)
    }
  }
  if (dockerfile.includes('COPY tools ./tools')) {
    throw new Error('Dockerfile must not invalidate production layers for release-only tool changes.')
  }

  return metadata
}

async function sourceTreeFingerprint(root) {
  if (!existsSync(path.join(root, '.git'))) return null
  const files = (await gitOutput(
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    root,
  ))
    .split('\0')
    .filter(Boolean)
    .sort()
  const hash = createHash('sha256')
  for (const relativePath of files) {
    hash.update(`${relativePath}\0`)
    try {
      hash.update(await readFile(path.join(root, relativePath)))
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      hash.update('<deleted>')
    }
    hash.update('\0')
  }
  return hash.digest('hex')
}

async function assertSourceTreeUnchanged(root, initialFingerprint) {
  const finalFingerprint = await sourceTreeFingerprint(root)
  if (initialFingerprint && finalFingerprint !== initialFingerprint) {
    throw new Error(
      'Source files changed while the gate was running. Results describe a mixed tree; rerun against the stable final tree.',
    )
  }
}

async function runTree(root) {
  const initialFingerprint = await sourceTreeFingerprint(root)
  const metadata = await validateContracts(root)
  console.log(`[preflight] Verifying ${metadata.name}@${metadata.version}`)
  for (const script of [
    'lint',
    'i18n:check',
    'release:notes:check',
    'typecheck',
    'test',
    'build',
    'verify:discover-adapters',
  ]) {
    await run('npm', ['run', script], { cwd: root })
  }
  await assertSourceTreeUnchanged(root, initialFingerprint)
  return metadata
}

async function gitOutput(args, cwd = projectRoot) {
  const result = await run('git', args, { cwd, capture: true })
  return result.stdout.trim()
}

async function exportPublicTree(sourceRoot) {
  const destination = await mkdtemp(path.join(os.tmpdir(), 'phd-atlas-public-preflight-'))
  try {
    await run('node', [path.join(sourceRoot, 'tools', 'export-public.mjs'), destination], { cwd: sourceRoot })
    return destination
  } catch (error) {
    await rm(destination, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 })
    throw error
  }
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function verifyDeterministicUpdatePackage(publicRoot, version, sourceDateEpoch) {
  const env = { ...process.env, SOURCE_DATE_EPOCH: String(sourceDateEpoch) }
  const packagePath = path.join(
    publicRoot,
    'storage',
    'update-packages',
    `phd-atlas-update-${version}-release.tar.gz`,
  )
  const checksumPath = `${packagePath}.sha256`

  await run('npm', ['run', 'build:update-package'], { cwd: publicRoot, env })
  const firstPackage = await readFile(packagePath)
  const firstChecksum = await readFile(checksumPath)
  await run('npm', ['run', 'build:update-package'], { cwd: publicRoot, env })
  const secondPackage = await readFile(packagePath)
  const secondChecksum = await readFile(checksumPath)

  if (!firstPackage.equals(secondPackage) || !firstChecksum.equals(secondChecksum)) {
    throw new Error('The update package is not byte-for-byte reproducible across two builds.')
  }
  const checksumLine = secondChecksum.toString('ascii').trim()
  const expectedHash = checksumLine.split(/\s+/)[0]
  const actualHash = sha256(secondPackage)
  if (expectedHash !== actualHash) {
    throw new Error(`Update-package checksum mismatch: expected ${expectedHash}, received ${actualHash}.`)
  }
  await run('node', ['tools/verify-update-package.mjs', packagePath], { cwd: publicRoot, env })
}

async function validateCompose(publicRoot) {
  const envPath = path.join(publicRoot, '.env')
  const hadEnv = existsSync(envPath)
  if (!hadEnv) await copyFile(path.join(publicRoot, '.env.example'), envPath)
  try {
    await run('docker', ['compose', 'config', '--quiet'], { cwd: publicRoot })
  } finally {
    if (!hadEnv) await rm(envPath, { force: true })
  }
}

async function assertDockerReady() {
  const result = await run('docker', ['info', '--format', '{{.ServerVersion}}'], { capture: true })
  if (!result.stdout.trim()) throw new Error('Docker Engine did not report a server version.')
  await run('docker', ['buildx', 'version'], { capture: true })
}

async function verifyDockerImages(publicRoot, version) {
  await assertDockerReady()
  await validateCompose(publicRoot)
  const suffix = `${version}-${Date.now()}-${process.pid}`.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-')

  for (const architecture of ['amd64', 'arm64']) {
    const imageRef = `phd-atlas-preflight:${suffix}-${architecture}`
    try {
      await run('docker', [
        'buildx',
        'build',
        '--platform', `linux/${architecture}`,
        '--load',
        '--tag', imageRef,
        '.',
      ], { cwd: publicRoot })
      await run('node', [
        'tools/smoke-container-image.mjs',
        imageRef,
        `local-${architecture}`,
        '--architectures', architecture,
        '--pull', 'never',
      ], {
        cwd: publicRoot,
        env: {
          ...process.env,
          PHD_ATLAS_SMOKE_DIAGNOSTIC_DIR: path.join(projectRoot, 'logs', 'tmp', 'container-smoke'),
        },
      })
    } finally {
      await run('docker', ['image', 'rm', '--force', imageRef], { cwd: publicRoot, capture: true }).catch(() => {})
    }
  }
}

async function runPublic(sourceRoot, { includeReleaseArtifacts = false, includeDocker = false } = {}) {
  const publicRoot = await exportPublicTree(sourceRoot)
  console.log(`[preflight] Public export: ${publicRoot}`)
  try {
    await run('npm', ['ci'], { cwd: publicRoot })
    const metadata = await runTree(publicRoot)
    if (includeReleaseArtifacts) {
      const timestamp = Number(await gitOutput(['show', '-s', '--format=%ct', 'HEAD'], sourceRoot))
      if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
        throw new Error('Could not derive a deterministic SOURCE_DATE_EPOCH from HEAD.')
      }
      await verifyDeterministicUpdatePackage(publicRoot, metadata.version, timestamp)
    }
    if (includeDocker) await verifyDockerImages(publicRoot, metadata.version)
    return metadata
  } finally {
    await rm(publicRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 500 })
  }
}

async function runCurrentPublicRelease(root) {
  const metadata = await runTree(root)
  const timestamp = Number(await gitOutput(['show', '-s', '--format=%ct', 'HEAD'], root))
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new Error('Could not derive a deterministic SOURCE_DATE_EPOCH from HEAD.')
  }
  await verifyDeterministicUpdatePackage(root, metadata.version, timestamp)
  await verifyDockerImages(root, metadata.version)
}

async function fetchPublicPackage() {
  const response = await fetch(publicPackageUrl, { signal: AbortSignal.timeout(20_000) })
  if (!response.ok) {
    throw new Error(`Could not read public package.json: HTTP ${response.status}.`)
  }
  return await response.json()
}

async function remoteTagTarget(repository, tagName) {
  for (const ref of [`refs/tags/${tagName}^{}`, `refs/tags/${tagName}`]) {
    const result = await run('git', ['ls-remote', repository, ref], { capture: true })
    const target = result.stdout.trim().split(/\s+/)[0] ?? ''
    if (/^[0-9a-f]{40}$/i.test(target)) return target
  }
  return ''
}

async function publicTagExists(tagName) {
  return Boolean(await remoteTagTarget(publicRepository, tagName))
}

async function readStandardInput() {
  process.stdin.setEncoding('utf8')
  let contents = ''
  for await (const chunk of process.stdin) contents += chunk
  return contents
}

export function parsePrePushInput(contents) {
  const updates = String(contents ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [localRef, localSha, remoteRef, remoteSha] = line.split(/\s+/)
      if (!localRef || !localSha || !remoteRef || !remoteSha) {
        throw new Error(`Malformed pre-push input: ${line}`)
      }
      return { localRef, localSha, remoteRef, remoteSha }
    })
  const manualVersionTag = updates.find(
    (update) => update.remoteRef.startsWith('refs/tags/v') && update.localSha !== zeroSha,
  )
  if (manualVersionTag) {
    throw new Error(
      `Refusing manual release-tag push '${manualVersionTag.remoteRef}'. `
      + 'The sync workflow creates version tags only after public CI and container gates pass.',
    )
  }
  return updates
}

export function prePushBranchUpdates(updates) {
  return updates.filter(
    (update) => update.remoteRef.startsWith('refs/heads/') && update.localSha !== zeroSha,
  )
}

async function assertHookTargetsCurrentCleanHead(updates) {
  const branchUpdates = prePushBranchUpdates(updates)
  const pushedShas = [...new Set(branchUpdates.map((update) => update.localSha))]
  if (pushedShas.length > 1) {
    throw new Error('Push contains multiple branch commits; push one verified branch at a time.')
  }
  if (pushedShas.length === 0) return false
  const head = await gitOutput(['rev-parse', 'HEAD'])
  if (pushedShas[0].toLowerCase() !== head.toLowerCase()) {
    throw new Error(`Pre-push target ${pushedShas[0]} is not the checked-out HEAD ${head}.`)
  }
  const dirty = await gitOutput(['status', '--porcelain=v1', '--untracked-files=all'])
  if (dirty) {
    throw new Error('Working tree changed after the commit being pushed. Commit or stash those changes, then retry.')
  }
  return true
}

async function planPush(root, sourceSha) {
  const sourcePackage = await readJson(path.join(root, 'package.json'))
  const publicPackage = await fetchPublicPackage()
  const tagName = `v${sourcePackage.version}`
  return planPublicSync({
    sourceVersion: sourcePackage.version,
    publicVersion: publicPackage.version,
    sourceSha,
    sourceTagTarget: await remoteTagTarget('origin', tagName),
    publicTagExists: await publicTagExists(tagName),
    forceSync: false,
  })
}

async function runPush({ hook = false } = {}) {
  let updates = []
  if (hook) {
    const stdin = await readStandardInput()
    updates = parsePrePushInput(stdin)
    const hasBranchUpdate = await assertHookTargetsCurrentCleanHead(updates)
    if (!hasBranchUpdate) {
      console.log('[preflight] No branch update requires verification.')
      return
    }
  }

  const initialFingerprint = await sourceTreeFingerprint(projectRoot)
  const sourceSha = await gitOutput(['rev-parse', 'HEAD'])
  const delivery = await planPush(projectRoot, sourceSha)
  report.delivery = delivery
  console.log(`[preflight] Delivery plan: ${delivery.mode} — ${delivery.reason}`)

  await runTree(projectRoot)
  if (delivery.syncPublic) {
    await runPublic(projectRoot, { includeReleaseArtifacts: true, includeDocker: true })
  } else {
    console.log('[preflight] Version is unchanged; public sync, Release, and Docker publication remain disabled.')
  }
  await assertSourceTreeUnchanged(projectRoot, initialFingerprint)
}

async function writeReport() {
  report.finishedAt = new Date().toISOString()
  const reportDirectory = path.join(projectRoot, 'logs', 'tmp')
  await mkdir(reportDirectory, { recursive: true })
  await writeFile(
    path.join(reportDirectory, 'release-preflight-latest.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  )
}

async function main() {
  const [mode = '', ...args] = process.argv.slice(2)
  report.mode = mode
  try {
    if (mode === 'contracts') {
      await validateContracts(projectRoot)
    } else if (mode === 'tree') {
      await runTree(projectRoot)
    } else if (mode === 'public') {
      if (existsSync(path.join(projectRoot, 'tools', 'export-public.mjs'))) {
        await runPublic(projectRoot)
      } else {
        await runTree(projectRoot)
      }
    } else if (mode === 'release') {
      if (existsSync(path.join(projectRoot, 'tools', 'export-public.mjs'))) {
        const initialFingerprint = await sourceTreeFingerprint(projectRoot)
        await runTree(projectRoot)
        await runPublic(projectRoot, { includeReleaseArtifacts: true, includeDocker: true })
        await assertSourceTreeUnchanged(projectRoot, initialFingerprint)
      } else {
        await runCurrentPublicRelease(projectRoot)
      }
    } else if (mode === 'push') {
      await runPush({ hook: args.includes('--hook') })
    } else {
      throw new Error('Usage: node tools/release-preflight.mjs contracts|tree|public|release|push [--hook]')
    }
    report.result = 'passed'
    console.log(`\n[preflight] ${mode} gate passed.`)
  } catch (error) {
    report.result = 'failed'
    report.error = error?.stack || String(error)
    console.error(`\n[preflight] ${mode || 'unknown'} gate failed: ${error?.message || error}`)
    process.exitCode = 1
  } finally {
    await writeReport()
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main()
}
