import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = resolve(projectRoot, 'dist', 'asset-manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

const MAX_INITIAL_JS_FILES = 12
const MAX_INITIAL_JS_RAW_BYTES = 900 * 1024
const MAX_INITIAL_JS_GZIP_BYTES = 300 * 1024
const MAX_INITIAL_CSS_FILES = 2
const MAX_INITIAL_CSS_RAW_BYTES = 950 * 1024
const MAX_INITIAL_CSS_GZIP_BYTES = 140 * 1024
const MAX_MOBILE_CSS_RAW_BYTES = 70 * 1024
const MAX_MOBILE_CSS_GZIP_BYTES = 14 * 1024
const MAX_AUTHENTICATED_APP_JS_FILES = 22
const MAX_AUTHENTICATED_APP_JS_RAW_BYTES = 1_200 * 1024
const MAX_AUTHENTICATED_APP_JS_GZIP_BYTES = 360 * 1024
const MOBILE_CSS_SOURCE_SUFFIX = '/src/styles/mobile.css'
const AUTHENTICATED_APP_ENTRY = 'src/App.tsx'
const AUTH_SCREEN_ENTRY = 'src/components/screens/AuthScreen.tsx'
const FORBIDDEN_INITIAL_CHUNK_PREFIXES = [
  'dnd-vendor',
  'markdown-vendor',
  'shared-components',
]

function collectStaticImportClosure(entryKey) {
  const visited = new Set()
  const pending = [entryKey]

  while (pending.length > 0) {
    const key = pending.pop()
    if (!key || visited.has(key)) continue
    const entry = manifest[key]
    if (!entry) throw new Error(`Build manifest is missing static import ${key}`)
    visited.add(key)
    for (const importedKey of entry.imports ?? []) pending.push(importedKey)
  }

  return [...visited]
}

const initialKeys = collectStaticImportClosure('index.html')
const initialJavaScript = initialKeys
  .map((key) => ({ key, entry: manifest[key] }))
  .filter(({ entry }) => typeof entry.file === 'string' && entry.file.endsWith('.js'))
const initialCss = [...new Set(initialKeys.flatMap((key) => manifest[key].css ?? []))]

let rawBytes = 0
let gzipBytes = 0
for (const { key, entry } of initialJavaScript) {
  const source = readFileSync(resolve(projectRoot, 'dist', entry.file))
  rawBytes += source.byteLength
  gzipBytes += gzipSync(source, { level: 9 }).byteLength

  const chunkIdentity = String(entry.name ?? key)
  const forbiddenPrefix = FORBIDDEN_INITIAL_CHUNK_PREFIXES.find((prefix) => chunkIdentity.startsWith(prefix))
  if (forbiddenPrefix) {
    throw new Error(`Feature-only chunk ${chunkIdentity} leaked into the initial static import graph`)
  }
}

if (initialJavaScript.length > MAX_INITIAL_JS_FILES) {
  throw new Error(
    `Initial JavaScript graph has ${initialJavaScript.length} files; budget is ${MAX_INITIAL_JS_FILES}`,
  )
}
if (rawBytes > MAX_INITIAL_JS_RAW_BYTES) {
  throw new Error(
    `Initial JavaScript graph is ${(rawBytes / 1024).toFixed(1)} KiB raw; budget is ${MAX_INITIAL_JS_RAW_BYTES / 1024} KiB`,
  )
}
if (gzipBytes > MAX_INITIAL_JS_GZIP_BYTES) {
  throw new Error(
    `Initial JavaScript graph is ${(gzipBytes / 1024).toFixed(1)} KiB gzip; budget is ${MAX_INITIAL_JS_GZIP_BYTES / 1024} KiB`,
  )
}

let cssRawBytes = 0
let cssGzipBytes = 0
for (const asset of initialCss) {
  const source = readFileSync(resolve(projectRoot, 'dist', asset))
  cssRawBytes += source.byteLength
  cssGzipBytes += gzipSync(source, { level: 9 }).byteLength
}

if (initialCss.length > MAX_INITIAL_CSS_FILES) {
  throw new Error(
    `Initial CSS graph has ${initialCss.length} files; budget is ${MAX_INITIAL_CSS_FILES}`,
  )
}
if (cssRawBytes > MAX_INITIAL_CSS_RAW_BYTES) {
  throw new Error(
    `Initial CSS graph is ${(cssRawBytes / 1024).toFixed(1)} KiB raw; budget is ${MAX_INITIAL_CSS_RAW_BYTES / 1024} KiB`,
  )
}
if (cssGzipBytes > MAX_INITIAL_CSS_GZIP_BYTES) {
  throw new Error(
    `Initial CSS graph is ${(cssGzipBytes / 1024).toFixed(1)} KiB gzip; budget is ${MAX_INITIAL_CSS_GZIP_BYTES / 1024} KiB`,
  )
}

const mobileCssManifestEntry = Object.entries(manifest).find(([key]) =>
  key.replaceAll('\\', '/').endsWith(MOBILE_CSS_SOURCE_SUFFIX),
)?.[1]
if (!mobileCssManifestEntry?.file?.endsWith('.css')) {
  throw new Error('Build manifest is missing the conditional mobile stylesheet asset')
}
if (initialCss.includes(mobileCssManifestEntry.file)) {
  throw new Error('Conditional mobile stylesheet leaked back into the initial CSS graph')
}
const mobileCssSource = readFileSync(resolve(projectRoot, 'dist', mobileCssManifestEntry.file))
const mobileCssRawBytes = mobileCssSource.byteLength
const mobileCssGzipBytes = gzipSync(mobileCssSource, { level: 9 }).byteLength
if (mobileCssRawBytes > MAX_MOBILE_CSS_RAW_BYTES) {
  throw new Error(
    `Mobile CSS asset is ${(mobileCssRawBytes / 1024).toFixed(1)} KiB raw; budget is ${MAX_MOBILE_CSS_RAW_BYTES / 1024} KiB`,
  )
}

const authenticatedAppKeys = collectStaticImportClosure(AUTHENTICATED_APP_ENTRY)
if (authenticatedAppKeys.includes(AUTH_SCREEN_ENTRY)) {
  throw new Error('Signed-out AuthScreen leaked into the authenticated App static graph')
}
if (!(manifest[AUTHENTICATED_APP_ENTRY]?.dynamicImports ?? []).includes(AUTH_SCREEN_ENTRY)) {
  throw new Error('Authenticated App no longer owns AuthScreen as a dynamic import')
}
const authenticatedAppJavaScript = authenticatedAppKeys
  .map((key) => ({ key, entry: manifest[key] }))
  .filter(({ entry }) => typeof entry.file === 'string' && entry.file.endsWith('.js'))
let authenticatedAppRawBytes = 0
let authenticatedAppGzipBytes = 0
for (const { key, entry } of authenticatedAppJavaScript) {
  const source = readFileSync(resolve(projectRoot, 'dist', entry.file))
  authenticatedAppRawBytes += source.byteLength
  authenticatedAppGzipBytes += gzipSync(source, { level: 9 }).byteLength
  if (String(entry.name ?? key).includes('useMarketingMotion')) {
    throw new Error('Signed-out marketing runtime leaked into the authenticated App static graph')
  }
}
if (authenticatedAppJavaScript.length > MAX_AUTHENTICATED_APP_JS_FILES) {
  throw new Error(
    `Authenticated App graph has ${authenticatedAppJavaScript.length} JavaScript files; budget is ${MAX_AUTHENTICATED_APP_JS_FILES}`,
  )
}
if (authenticatedAppRawBytes > MAX_AUTHENTICATED_APP_JS_RAW_BYTES) {
  throw new Error(
    `Authenticated App graph is ${(authenticatedAppRawBytes / 1024).toFixed(1)} KiB raw; budget is ${MAX_AUTHENTICATED_APP_JS_RAW_BYTES / 1024} KiB`,
  )
}
if (authenticatedAppGzipBytes > MAX_AUTHENTICATED_APP_JS_GZIP_BYTES) {
  throw new Error(
    `Authenticated App graph is ${(authenticatedAppGzipBytes / 1024).toFixed(1)} KiB gzip; budget is ${MAX_AUTHENTICATED_APP_JS_GZIP_BYTES / 1024} KiB`,
  )
}
if (mobileCssGzipBytes > MAX_MOBILE_CSS_GZIP_BYTES) {
  throw new Error(
    `Mobile CSS asset is ${(mobileCssGzipBytes / 1024).toFixed(1)} KiB gzip; budget is ${MAX_MOBILE_CSS_GZIP_BYTES / 1024} KiB`,
  )
}

console.log(
  `Initial JavaScript budget passed: ${initialJavaScript.length} files, ${(rawBytes / 1024).toFixed(1)} KiB raw, ${(gzipBytes / 1024).toFixed(1)} KiB gzip.`,
)
console.log(
  `Initial CSS budget passed: ${initialCss.length} files, ${(cssRawBytes / 1024).toFixed(1)} KiB raw, ${(cssGzipBytes / 1024).toFixed(1)} KiB gzip.`,
)
console.log(
  `Conditional mobile CSS budget passed: 1 file, ${(mobileCssRawBytes / 1024).toFixed(1)} KiB raw, ${(mobileCssGzipBytes / 1024).toFixed(1)} KiB gzip.`,
)
console.log(
  `Authenticated App budget passed: ${authenticatedAppJavaScript.length} JavaScript files, ${(authenticatedAppRawBytes / 1024).toFixed(1)} KiB raw, ${(authenticatedAppGzipBytes / 1024).toFixed(1)} KiB gzip; signed-out Auth/marketing remains dynamic.`,
)
