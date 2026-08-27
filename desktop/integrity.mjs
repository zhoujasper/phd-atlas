import { createHash, timingSafeEqual } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = dirname(fileURLToPath(import.meta.url))
const projectRoot = dirname(desktopRoot)

export const INTEGRITY_MANIFEST_NAME = 'integrity-manifest.json'

export const INTEGRITY_PATHS = Object.freeze([
  'desktop/main.mjs',
  'desktop/preload.cjs',
  'desktop/launch-runtime.mjs',
  'desktop/portablePaths.mjs',
  'desktop/resolve-runtime-node.mjs',
  'server/desktopRuntime.js',
  'server/desktopRoutes.js',
  'server/desktopCompleteExport.js',
  'server/desktopRemoteSync.js',
  'server/index.js',
])

export function integrityManifestPath(root = projectRoot) {
  return join(root, 'desktop', INTEGRITY_MANIFEST_NAME)
}

export function hashFile(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

export function buildIntegrityManifest(root = projectRoot) {
  const files = {}
  for (const relative of INTEGRITY_PATHS) {
    const absolute = join(root, relative)
    if (!existsSync(absolute)) {
      throw new Error(`Integrity input missing: ${relative}`)
    }
    files[relative] = hashFile(absolute)
  }
  return {
    version: 1,
    algorithm: 'sha256',
    files,
  }
}

export function verifyIntegrityManifest(root = projectRoot, manifest = null) {
  const expected = manifest ?? JSON.parse(readFileSync(integrityManifestPath(root), 'utf8'))
  const actual = buildIntegrityManifest(root)
  const mismatches = []
  for (const relative of INTEGRITY_PATHS) {
    const left = String(expected.files?.[relative] ?? '')
    const right = String(actual.files[relative] ?? '')
    if (!left || !right || left.length !== right.length) {
      mismatches.push(relative)
      continue
    }
    const leftBuf = Buffer.from(left)
    const rightBuf = Buffer.from(right)
    if (leftBuf.length !== rightBuf.length || !timingSafeEqual(leftBuf, rightBuf)) {
      mismatches.push(relative)
    }
  }
  return {
    ok: mismatches.length === 0,
    mismatches,
  }
}

export function assertDesktopIntegrity(root = projectRoot, options = {}) {
  if (options.dev) return { ok: true, skipped: true, mismatches: [] }
  const verified = verifyIntegrityManifest(root)
  if (!verified.ok) {
    const error = new Error(`Desktop integrity check failed: ${verified.mismatches.join(', ')}`)
    error.code = 'DESKTOP_INTEGRITY_FAILED'
    throw error
  }
  return verified
}
