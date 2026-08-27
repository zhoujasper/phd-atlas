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
import { assertNoCoauthorTrailers } from './no-coauthors.mjs'
import { planPublicSync } from './plan-public-sync.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDirectory, '..')
const publicRepository = 'https://github.com/zhoujasper/phd-atlas.git'
const publicPackageUrl = 'https://raw.githubusercontent.com/zhoujasper/phd-atlas/main/package.json'
const zeroSha = '0'.repeat(40)
const maxCommandOutputTail = 64_000
export const COMPOSE_VALIDATION_IMAGE = 'docker:29.7.2-cli@sha256:000bb62ff495f986c9f5578eb67cc2cb98b91138eda81d7762d5371eb8a497fe'
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

export function assertDesktopReleaseScriptContract(packageJson) {
  const required = 'node desktop/prepare-release-artifacts.mjs'
  if (packageJson.scripts?.['desktop:release-artifacts'] !== required) {
    throw new Error(
      `package.json script 'desktop:release-artifacts' must be exactly '${required}'.`,
    )
  }
}

export function releaseTreeScriptArguments(script) {
  if (script === 'test') {
    return ['run', script, '--', '--maxWorkers=1', '--no-file-parallelism']
  }
  return ['run', script]
}

export const RELEASE_TEST_SHARD_COUNT = 4

export function releaseTreeScriptInvocations(script) {
  const args = releaseTreeScriptArguments(script)
  if (script !== 'test') return [args]
  return Array.from({ length: RELEASE_TEST_SHARD_COUNT }, (_, index) => [
    ...args,
    `--shard=${index + 1}/${RELEASE_TEST_SHARD_COUNT}`,
  ])
}

export function composeValidationCreateArguments(containerName) {
  return [
    'create',
    '--name', containerName,
    COMPOSE_VALIDATION_IMAGE,
    'compose',
    '--project-name', 'phd-atlas',
    '--project-directory', '/',
    '-f', '/compose.yaml',
    '--env-file', '/.env',
    'config',
    '--quiet',
  ]
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
  if (!scripts.includes('npm run verify:beta8-update -- "$package_path"')) {
    throw new Error(`${label} release job must replay the published package through the historical beta.8 updater.`)
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

export function assertDesktopReleaseWorkflowContract(contents, label = 'desktop-release.yml') {
  const workflow = parseWorkflowDocument(contents, label)
  const trigger = workflow.on?.workflow_run
  const triggerWorkflows = Array.isArray(trigger?.workflows) ? trigger.workflows : []
  const triggerTypes = Array.isArray(trigger?.types) ? trigger.types : []
  if (
    !triggerWorkflows.includes('Release update package and container')
    || !triggerTypes.includes('completed')
  ) {
    throw new Error(`${label} must run only after the canonical public Release workflow completes.`)
  }
  if (workflow.permissions?.contents !== 'read') {
    throw new Error(`${label} must default to read-only repository contents.`)
  }

  const requiredGuard = "github.event.workflow_run.conclusion == 'success'"
  const buildContracts = [
    ['build-windows', 'windows-latest', 'npm run desktop:build:win', '--platform windows'],
    ['build-macos', 'macos-latest', 'npm run desktop:build:mac', '--platform macos'],
  ]
  for (const [jobName, runner, buildCommand, platformArgument] of buildContracts) {
    const job = workflow.jobs?.[jobName]
    if (!job) throw new Error(`${label} is missing ${jobName}.`)
    if (job['runs-on'] !== runner) {
      throw new Error(`${label} ${jobName} must use the native ${runner} runner.`)
    }
    if (!String(job.if ?? '').includes(requiredGuard)) {
      throw new Error(`${label} ${jobName} must be gated by a successful canonical Release run.`)
    }
    const checkout = job.steps?.find((step) => step?.uses === 'actions/checkout@v4')
    if (checkout?.with?.ref !== '${{ github.event.workflow_run.head_sha }}') {
      throw new Error(`${label} ${jobName} must build the exact released commit SHA.`)
    }
    const scripts = workflowStepScripts(job)
    for (const required of ['npm ci', buildCommand, platformArgument]) {
      if (!scripts.includes(required)) {
        throw new Error(`${label} ${jobName} is missing '${required}'.`)
      }
    }
    if (!job.steps?.some((step) => step?.uses === 'actions/upload-artifact@v4')) {
      throw new Error(`${label} ${jobName} must upload its native candidates before Release attachment.`)
    }
  }

  const attachJob = workflow.jobs?.['attach-release-assets']
  if (!attachJob) throw new Error(`${label} is missing attach-release-assets.`)
  if (!String(attachJob.if ?? '').includes(requiredGuard)) {
    throw new Error(`${label} attach-release-assets must be gated by a successful canonical Release run.`)
  }
  if (attachJob.permissions?.contents !== 'write') {
    throw new Error(`${label} must grant write access only to the final Release attachment job.`)
  }
  const needs = Array.isArray(attachJob.needs) ? [...attachJob.needs].sort() : []
  if (JSON.stringify(needs) !== JSON.stringify(['build-macos', 'build-windows'])) {
    throw new Error(`${label} must wait for both native desktop builds before attaching assets.`)
  }
  const checkout = attachJob.steps?.find((step) => step?.uses === 'actions/checkout@v4')
  if (checkout?.with?.ref !== '${{ github.event.workflow_run.head_sha }}') {
    throw new Error(`${label} attachment must verify the exact released commit SHA.`)
  }
  if (!attachJob.steps?.some((step) => step?.uses === 'actions/download-artifact@v4')) {
    throw new Error(`${label} attachment must download both native candidate sets.`)
  }
  const attachScripts = workflowStepScripts(attachJob)
  for (const required of [
    'sha256sum --check',
    'git rev-list -n 1 "$tag"',
    'releases/tags/${DESKTOP_TAG}',
    'releases/assets/${asset_id}',
    'cmp --silent "$asset_path" "$remote_path"',
  ]) {
    if (!attachScripts.includes(required)) {
      throw new Error(`${label} attachment is missing the immutable asset contract '${required}'.`)
    }
  }
  if (attachScripts.includes('--clobber')) {
    throw new Error(`${label} must never overwrite an existing desktop Release asset.`)
  }
}

export function assertGitHookInstallationContract(indexEntry, installerContents) {
  if (!String(indexEntry).startsWith('100755 ')) {
    throw new Error('The tracked pre-push hook must have executable mode 100755.')
  }
  for (const required of [
    "path.join(projectRoot, '.githooks', 'pre-push')",
    "path.join(projectRoot, '.githooks', 'commit-msg')",
    'chmod(prePushHook, 0o755)',
    'chmod(commitMessageHook, 0o755)',
    "core.hooksPath', '.githooks'",
  ]) {
    if (!installerContents.includes(required)) {
      throw new Error(`Git hook installer contract is missing '${required}'.`)
    }
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function validateContracts(root) {
  const packageJson = await readJson(path.join(root, 'package.json'))
  const lockJson = await readJson(path.join(root, 'package-lock.json'))
  const metadata = assertPackageMetadata(packageJson, lockJson)
  assertDesktopReleaseScriptContract(packageJson)
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
  if (existsSync(sourceTemplates)) {
    const hookIndexEntry = await gitOutput(
      ['ls-files', '--stage', '--', '.githooks/pre-push'],
      root,
    )
    const hookInstaller = await readFile(path.join(root, 'tools', 'install-git-hooks.mjs'), 'utf8')
    assertGitHookInstallationContract(hookIndexEntry, hookInstaller)
  }
  const workflowPaths = existsSync(sourceTemplates)
    ? [
        path.join(root, '.github', 'workflows', 'sync-public.yml'),
        path.join(sourceTemplates, 'ci.yml'),
        path.join(sourceTemplates, 'publish-container.yml'),
        path.join(sourceTemplates, 'release.yml'),
        path.join(sourceTemplates, 'desktop-release.yml'),
      ]
    : [
        path.join(root, '.github', 'workflows', 'ci.yml'),
        path.join(root, '.github', 'workflows', 'publish-container.yml'),
        path.join(root, '.github', 'workflows', 'release.yml'),
        path.join(root, '.github', 'workflows', 'desktop-release.yml'),
      ]

  for (const workflowPath of workflowPaths) {
    const contents = await readFile(workflowPath, 'utf8')
    const workflowName = path.basename(workflowPath)
    if (workflowName === 'desktop-release.yml') {
      assertDesktopReleaseWorkflowContract(contents, path.relative(root, workflowPath))
      continue
    }
    assertWorkflowValidationContract(contents, path.relative(root, workflowPath))
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
    'COPY shared ./shared',
    'COPY desktop/portablePaths.mjs desktop/portablePaths.d.mts ./desktop/',
    'COPY tools/start-server.mjs tools/apply-update.mjs tools/container-entrypoint.mjs tools/stamp-service-worker.mjs tools/verify-build-entry-budget.mjs ./tools/',
    'npm --ignore-scripts run build',
    'npm prune --omit=dev',
    'COPY --from=build --chown=node:node /app/server ./server',
  ]) {
    if (!dockerfile.includes(required)) {
      throw new Error(`Dockerfile release contract is missing '${required}'.`)
    }
  }
  if (dockerfile.includes('COPY tools ./tools')) {
    throw new Error('Dockerfile must not invalidate production layers for release-only tool changes.')
  }
  if (dockerfile.includes('COPY --from=build --chown=node:node /app/shared ./shared')) {
    throw new Error('Docker runtime must use the legacy-update-compatible server/shared module boundary.')
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
    'security:audit',
    'i18n:check',
    'release:notes:check',
    'typecheck',
    'test',
    'test:codex-plugin',
    'build',
    'check:codex-skill-bundles',
    'verify:discover-adapters',
  ]) {
    for (const args of releaseTreeScriptInvocations(script)) {
      await run('npm', args, { cwd: root })
    }
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
  return packagePath
}

async function verifyBeta8UpdateCompatibility(sourceRoot, packagePath) {
  const verifier = path.join(sourceRoot, 'tools', 'verify-beta8-update-compatibility.mjs')
  if (!existsSync(verifier)) {
    throw new Error(`Beta.8 update compatibility verifier is missing: ${verifier}`)
  }
  await run(process.execPath, [verifier, packagePath], { cwd: sourceRoot })
}

async function validateCompose(publicRoot) {
  const envPath = path.join(publicRoot, '.env')
  const hadEnv = existsSync(envPath)
  const containerName = `phd-atlas-compose-config-${Date.now()}-${process.pid}`
  let containerCreated = false
  if (!hadEnv) await copyFile(path.join(publicRoot, '.env.example'), envPath)
  try {
    await run('docker', composeValidationCreateArguments(containerName), {
      cwd: publicRoot,
      capture: true,
    })
    containerCreated = true
    await run('docker', [
      'cp',
      path.join(publicRoot, 'compose.yaml'),
      `${containerName}:/compose.yaml`,
    ], { cwd: publicRoot })
    await run('docker', ['cp', envPath, `${containerName}:/.env`], { cwd: publicRoot })
    await run('docker', ['start', '--attach', containerName], { cwd: publicRoot })
  } finally {
    if (containerCreated) {
      await run('docker', ['rm', '--force', containerName], {
        cwd: publicRoot,
        capture: true,
      }).catch(() => {})
    }
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
      const packagePath = await verifyDeterministicUpdatePackage(publicRoot, metadata.version, timestamp)
      await verifyBeta8UpdateCompatibility(sourceRoot, packagePath)
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
  const packagePath = await verifyDeterministicUpdatePackage(root, metadata.version, timestamp)
  await verifyBeta8UpdateCompatibility(root, packagePath)
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

export function prePushRevisionSpecs(updates) {
  return [...new Set(updates
    .filter((update) => update.localSha !== zeroSha)
    .map((update) => update.remoteSha === zeroSha
      ? update.localSha
      : `${update.remoteSha}..${update.localSha}`))]
}

async function assertPrePushCommitsHaveNoCoauthors(updates) {
  for (const revision of prePushRevisionSpecs(updates)) {
    const log = await gitOutput(['log', '--format=%H%x00%B%x00', revision])
    const fields = log.split('\0')
    for (let index = 0; index + 1 < fields.length; index += 2) {
      const sha = fields[index].trim()
      if (!sha) continue
      assertNoCoauthorTrailers(fields[index + 1], `Commit ${sha}`)
    }
  }
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
    await assertPrePushCommitsHaveNoCoauthors(updates)
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
