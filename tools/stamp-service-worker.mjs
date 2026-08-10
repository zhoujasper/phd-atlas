import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

export const BUILD_ID_TOKEN = '__PHD_ATLAS_BUILD_ID__'
const PRECOMPRESS_MIN_BYTES = 1024
const PRECOMPRESSIBLE_EXTENSION = /\.(?:css|html|js|json|svg|txt|webmanifest|xml)$/i

function collectFiles(root, directory = root) {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const filePath = join(directory, entry.name)
      if (entry.isDirectory()) return collectFiles(root, filePath)
      if (!entry.isFile()) return []
      return [filePath]
    })
    .sort((left, right) => relative(root, left).localeCompare(relative(root, right)))
}

function normalizedRelativePath(root, filePath) {
  return relative(root, filePath).replaceAll('\\', '/')
}

export function createBuildId(outputRoot) {
  const root = resolve(outputRoot)
  const serviceWorkerPath = join(root, 'sw.js')
  const serviceWorkerSource = readFileSync(serviceWorkerPath, 'utf8')
  if (!serviceWorkerSource.includes(BUILD_ID_TOKEN)) {
    throw new Error(`Expected ${BUILD_ID_TOKEN} in ${serviceWorkerPath}.`)
  }

  const hash = createHash('sha256')
  for (const filePath of collectFiles(root)) {
    if (filePath.endsWith('.gz')) continue
    const fileName = normalizedRelativePath(root, filePath)
    const contents = filePath === serviceWorkerPath
      ? Buffer.from(serviceWorkerSource)
      : readFileSync(filePath)
    hash.update(fileName)
    hash.update('\0')
    hash.update(contents)
    hash.update('\0')
  }
  return hash.digest('hex').slice(0, 16)
}

export function stampServiceWorker(outputRoot) {
  const root = resolve(outputRoot)
  const serviceWorkerPath = join(root, 'sw.js')
  const source = readFileSync(serviceWorkerPath, 'utf8')
  const buildId = createBuildId(root)
  const stamped = source.replaceAll(BUILD_ID_TOKEN, buildId)

  if (stamped.includes(BUILD_ID_TOKEN)) {
    throw new Error(`Could not stamp ${serviceWorkerPath}.`)
  }

  writeFileSync(serviceWorkerPath, stamped, 'utf8')
  return buildId
}

export function precompressStaticAssets(outputRoot, {
  minimumBytes = PRECOMPRESS_MIN_BYTES,
} = {}) {
  const root = resolve(outputRoot)
  const threshold = Math.max(0, Number(minimumBytes) || 0)
  let compressedBytes = 0
  let originalBytes = 0
  let files = 0

  for (const filePath of collectFiles(root)) {
    if (filePath.endsWith('.gz') || !PRECOMPRESSIBLE_EXTENSION.test(filePath)) continue
    const gzipPath = `${filePath}.gz`
    const contents = readFileSync(filePath)
    if (contents.byteLength < threshold) {
      rmSync(gzipPath, { force: true })
      continue
    }
    const compressed = gzipSync(contents, { level: 9 })
    if (compressed.byteLength >= contents.byteLength) {
      rmSync(gzipPath, { force: true })
      continue
    }
    writeFileSync(gzipPath, compressed)
    files += 1
    originalBytes += contents.byteLength
    compressedBytes += compressed.byteLength
  }

  return { files, originalBytes, compressedBytes }
}

const currentFile = fileURLToPath(import.meta.url)
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : null

if (invokedFile === currentFile) {
  const outputRoot = resolve(process.cwd(), process.argv[2] ?? 'dist')
  const buildId = stampServiceWorker(outputRoot)
  const precompressed = precompressStaticAssets(outputRoot)
  console.log(
    `Stamped service worker cache version ${buildId}; precompressed ${precompressed.files} static assets.`,
  )
}
