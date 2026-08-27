import {
  chmodSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  unlinkSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { bundledDesktopNodeName } from './resolve-runtime-node.mjs'

const desktopRoot = dirname(fileURLToPath(import.meta.url))
const destDir = join(desktopRoot, 'resources', 'runtime')
mkdirSync(destDir, { recursive: true })
const dest = join(destDir, bundledDesktopNodeName())

if (process.platform === 'win32') {
  copyFileSync(process.execPath, dest)
  removeSiblingRuntimes(destDir, bundledDesktopNodeName())
  console.log(`Copied Node runtime to ${dest}`)
} else {
  await ensureOfficialUnixNode(dest)
  removeSiblingRuntimes(destDir, bundledDesktopNodeName())
}

function removeSiblingRuntimes(directory, keepName) {
  for (const name of readdirSync(directory)) {
    if (name === keepName) continue
    unlinkSync(join(directory, name))
  }
}

function nodeVersionMatches(filePath) {
  const result = spawnSync(filePath, ['-p', 'process.version'], { encoding: 'utf8' })
  return result.status === 0 && String(result.stdout).trim() === process.version
}

function isSelfContainedDarwinNode(filePath) {
  if (process.platform !== 'darwin') return true
  const result = spawnSync('otool', ['-L', filePath], { encoding: 'utf8' })
  if (result.status !== 0) return false
  const output = String(result.stdout)
  return !output.includes('/opt/homebrew/') && !output.includes('/usr/local/opt/')
}

async function ensureOfficialUnixNode(filePath) {
  if (existsSync(filePath) && nodeVersionMatches(filePath) && isSelfContainedDarwinNode(filePath)) {
    console.log(`Reusing bundled Node runtime at ${filePath}`)
    return
  }

  const version = process.version.slice(1)
  const archiveName = `node-v${version}-${process.platform}-${process.arch}.tar.gz`
  const url = `https://nodejs.org/dist/v${version}/${archiveName}`
  const vendorDir = join(desktopRoot, 'vendor')
  mkdirSync(vendorDir, { recursive: true })
  const archivePath = join(vendorDir, archiveName)

  if (!existsSync(archivePath)) {
    console.log(`Downloading official Node ${process.version} from ${url}`)
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to download ${url}: HTTP ${response.status}`)
    }
    await pipeline(response.body, createWriteStream(archivePath))
  }

  const extractDir = join(tmpdir(), `phd-atlas-node-${process.pid}`)
  rmSync(extractDir, { recursive: true, force: true })
  mkdirSync(extractDir, { recursive: true })
  try {
    const extracted = spawnSync('tar', ['-xzf', archivePath, '-C', extractDir], { stdio: 'inherit' })
    if (extracted.status !== 0) {
      throw new Error(`Failed to extract ${archivePath}`)
    }
    const extractedNode = join(extractDir, `node-v${version}-${process.platform}-${process.arch}`, 'bin', 'node')
    if (!existsSync(extractedNode)) {
      throw new Error(`Extracted Node binary missing: ${extractedNode}`)
    }
    copyFileSync(extractedNode, filePath)
    chmodSync(filePath, 0o755)
  } finally {
    rmSync(extractDir, { recursive: true, force: true })
  }

  if (!nodeVersionMatches(filePath)) {
    throw new Error(`Bundled Node at ${filePath} does not report ${process.version}`)
  }
  if (!isSelfContainedDarwinNode(filePath)) {
    throw new Error(`Bundled Node at ${filePath} still links against Homebrew libraries.`)
  }
  console.log(`Wrote official Node runtime to ${filePath}`)
}
