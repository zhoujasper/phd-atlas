import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('..', import.meta.url))
const stage = join(root, 'dist-desktop', 'nsis-stage')
const payload = join(stage, 'payload')
const nsisScript = join(root, 'desktop', 'nsis', 'phd-atlas.nsi')
const nodeSrc = join(root, 'desktop', 'resources', 'runtime', 'node.exe')
const makensis = join(
  process.env.LOCALAPPDATA,
  'electron-builder',
  'Cache',
  'nsis-3.0.4.1',
  'nsis-3.0.4.1-1mx3n',
  'makensis.exe',
)

if (!existsSync(nodeSrc)) {
  throw new Error('Missing desktop/resources/runtime/node.exe. Run node desktop/prepare-runtime-node.mjs first.')
}
if (!existsSync(join(root, 'dist', 'index.html'))) {
  throw new Error('Missing dist/index.html. Run vite build first.')
}
if (!existsSync(makensis)) {
  throw new Error(`NSIS compiler not found: ${makensis}`)
}

rmSync(stage, { recursive: true, force: true })
mkdirSync(payload, { recursive: true })
mkdirSync(join(root, 'dist-desktop'), { recursive: true })

const copyDir = (from, to) => {
  cpSync(from, to, {
    recursive: true,
    filter: (source) => {
      const rel = relative(root, source).replaceAll('\\', '/')
      if (rel.includes('/.git/') || rel.endsWith('.test.js') || rel.endsWith('.test.ts')) return false
      if (rel.startsWith('desktop/vendor')) return false
      if (rel.startsWith('desktop/resources/runtime')) return false
      if (rel.startsWith('desktop/nsis')) return false
      return true
    },
  })
}

copyDir(join(root, 'dist'), join(payload, 'dist'))
copyDir(join(root, 'server'), join(payload, 'server'))
copyDir(join(root, 'shared'), join(payload, 'shared'))
copyDir(join(root, 'src', 'i18n'), join(payload, 'src', 'i18n'))
copyDir(join(root, 'desktop'), join(payload, 'desktop'))
mkdirSync(join(payload, 'tools'), { recursive: true })
cpSync(join(root, 'tools', 'start-server.mjs'), join(payload, 'tools', 'start-server.mjs'))
cpSync(join(root, 'package.json'), join(payload, 'package.json'))
if (existsSync(join(root, 'LICENSE'))) cpSync(join(root, 'LICENSE'), join(payload, 'LICENSE'))

mkdirSync(join(payload, 'runtime'), { recursive: true })
cpSync(nodeSrc, join(payload, 'runtime', 'node.exe'))

const parseable = execFileSync('npm', ['ls', '--omit=dev', '--all', '--parseable'], {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
  shell: true,
}).trim().split(/\r?\n/).filter(Boolean)

for (const abs of parseable) {
  if (abs === root) continue
  const rel = relative(join(root, 'node_modules'), abs)
  if (!rel || rel.startsWith('..')) continue
  const dest = join(payload, 'node_modules', rel)
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(abs, dest, { recursive: true })
}

writeFileSync(join(payload, 'PhD Atlas.bat'), `@echo off
cd /d "%~dp0"
set "PHD_ATLAS_DESKTOP=1"
set "HOST=127.0.0.1"
if not defined PORT set "PORT=4318"
start "" "http://127.0.0.1:%PORT%"
"runtime\\node.exe" "desktop\\launch-runtime.mjs"
`)

const compiled = spawnSync(makensis, [nsisScript], {
  cwd: join(root, 'desktop', 'nsis'),
  stdio: 'inherit',
  windowsHide: true,
})
if (compiled.status !== 0) {
  throw new Error(`makensis failed with status ${compiled.status}`)
}
console.log('Wrote dist-desktop/PhDAtlas-0.1.1-win-x64-setup.exe')
