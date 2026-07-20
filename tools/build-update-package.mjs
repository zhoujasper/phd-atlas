import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const projectRoot = resolve(dirname(__filename), '..')
const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
const outRoot = join(projectRoot, 'storage', 'update-packages')
const stageRoot = join(projectRoot, 'storage', 'update-package-stage')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const packageName = `phd-atlas-update-${packageJson.version}-${stamp}.tar.gz`
const packagePath = join(outRoot, packageName)
const buildCommand = process.platform === 'win32' ? 'cmd.exe' : 'npm'
const buildArgs = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run build'] : ['run', 'build']

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    ...options,
  })
  if (result.error) {
    console.error(result.error.message)
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

mkdirSync(outRoot, { recursive: true })
rmSync(stageRoot, { recursive: true, force: true })
mkdirSync(stageRoot, { recursive: true })

run(buildCommand, buildArgs)

for (const entry of ['dist', 'server', 'tools', 'package.json', 'package-lock.json']) {
  const source = join(projectRoot, entry)
  if (existsSync(source)) {
    cpSync(source, join(stageRoot, entry), { recursive: true })
  }
}

rmSync(join(stageRoot, 'tools', 'export-public.mjs'), { force: true })

function listFiles(root, current = root) {
  const result = []
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const fullPath = join(current, entry.name)
    if (entry.isDirectory()) result.push(...listFiles(root, fullPath))
    else if (entry.isFile()) result.push(fullPath)
  }
  return result
}

const files = listFiles(stageRoot)
  .filter((filePath) => !filePath.endsWith('UPDATE_PACKAGE_README.txt'))
  .map((filePath) => {
    const contents = readFileSync(filePath)
    return {
      path: relative(stageRoot, filePath).split(sep).join('/'),
      size: statSync(filePath).size,
      sha256: createHash('sha256').update(contents).digest('hex'),
    }
  })
  .sort((left, right) => left.path.localeCompare(right.path))

const contentHash = createHash('sha256')
for (const file of files) {
  contentHash.update(`${file.path}\0${file.sha256}\0${file.size}\n`)
}
writeFileSync(
  join(stageRoot, 'update-manifest.json'),
  JSON.stringify({
    formatVersion: 1,
    appId: 'phd-atlas',
    version: packageJson.version,
    createdAt: new Date().toISOString(),
    contentSha256: contentHash.digest('hex'),
    files,
  }, null, 2),
  'utf8',
)

writeFileSync(
  join(stageRoot, 'UPDATE_PACKAGE_README.txt'),
  [
    'PhD Atlas update package',
    `version=${packageJson.version}`,
    `createdAt=${new Date().toISOString()}`,
    '',
    'Upload this .tar.gz file from the admin System Update card.',
    'The server validates and stores the package for controlled maintenance.',
  ].join('\n'),
  'utf8',
)

run('tar', ['-czf', packagePath, '-C', stageRoot, '.'])
rmSync(stageRoot, { recursive: true, force: true })

console.log(`Update package written to ${packagePath}`)
