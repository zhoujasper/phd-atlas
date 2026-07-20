/**
 * Generate modular i18n language packs from the English source.
 *
 * Usage:
 *   node tools/generate-language-packs.mjs
 *   node tools/generate-language-packs.mjs --langs=ja,ko,es,fr,de
 *   node tools/generate-language-packs.mjs --langs=ja,ko,es,fr,de --missing-only
 *   node tools/generate-language-packs.mjs --langs=ja,ko,es,fr,de --untranslated-only --concurrency=16
 *   node tools/generate-language-packs.mjs --force
 *
 * Uses the public Google Translate endpoint (client=gtx). Results are cached
 * under tools/.i18n-translate-cache.json so re-runs only fill missing strings.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const enDir = path.join(root, 'src', 'i18n', 'en')
const cachePath = path.join(__dirname, '.i18n-translate-cache.json')

const LANGUAGE_META = {
  ja: { nativeName: '日本語', name: 'Japanese', locale: 'ja-JP' },
  ko: { nativeName: '한국어', name: 'Korean', locale: 'ko-KR' },
  es: { nativeName: 'Español', name: 'Spanish', locale: 'es-ES' },
  fr: { nativeName: 'Français', name: 'French', locale: 'fr-FR' },
  de: { nativeName: 'Deutsch', name: 'German', locale: 'de-DE' },
  pt: { nativeName: 'Português', name: 'Portuguese', locale: 'pt-BR' },
  it: { nativeName: 'Italiano', name: 'Italian', locale: 'it-IT' },
  ru: { nativeName: 'Русский', name: 'Russian', locale: 'ru-RU' },
  vi: { nativeName: 'Tiếng Việt', name: 'Vietnamese', locale: 'vi-VN' },
  th: { nativeName: 'ไทย', name: 'Thai', locale: 'th-TH' },
}

const DEFAULT_LANGS = ['ja', 'ko', 'es', 'fr', 'de']
const NAMESPACES = [
  'core',
  'shared',
  'dashboard',
  'discover',
  'workspace',
  'dossier',
  'profile',
  'settings',
  'team',
  'share',
  'shareViewer',
  'assetUpload',
  'upgrade',
  'resetPassword',
  'admin',
  'tour',
  'pdfExport',
]

const args = process.argv.slice(2)
const force = args.includes('--force')
const missingOnly = args.includes('--missing-only')
const untranslatedOnly = args.includes('--untranslated-only')
const langsArg = args.find((arg) => arg.startsWith('--langs='))
const concurrencyArg = args.find((arg) => arg.startsWith('--concurrency='))
const targetLangs = (langsArg ? langsArg.slice('--langs='.length).split(',') : DEFAULT_LANGS)
  .map((lang) => lang.trim().toLowerCase())
  .filter(Boolean)

const CONCURRENCY = Math.max(1, Number.parseInt(concurrencyArg?.slice('--concurrency='.length) ?? '6', 10) || 6)
const RETRIES = 4
const REQUEST_GAP_MS = 35

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function protectPlaceholders(text) {
  const placeholders = []
  const protectedText = text.replace(/\{[a-zA-Z0-9_]+\}/g, (match) => {
    const token = `⟦PH${placeholders.length}⟧`
    placeholders.push(match)
    return token
  })
  return { protectedText, placeholders }
}

function restorePlaceholders(text, placeholders) {
  let restored = text
  placeholders.forEach((placeholder, index) => {
    const token = new RegExp(`⟦\\s*PH\\s*${index}\\s*⟧|\\[\\s*PH\\s*${index}\\s*\\]|PH${index}`, 'gi')
    restored = restored.replace(token, placeholder)
  })
  // If the model dropped a placeholder entirely, append missing ones.
  for (const placeholder of placeholders) {
    if (!restored.includes(placeholder)) restored = `${restored} ${placeholder}`.trim()
  }
  return restored
}

async function translateText(text, targetLang, cache) {
  if (!text || !text.trim()) return text
  // Keep pure placeholders / punctuation / numbers as-is.
  if (/^[\s{}.0-9_\-–—:/\\|+*=#%&<>[\]()"'`,;!?]+$/.test(text)) return text
  if (text === 'PhD Atlas' || text === 'Markdown' || text === 'PDF / DOCX') return text

  const cacheKey = `${targetLang}::${text}`
  if (!force && cache[cacheKey]) return cache[cacheKey]

  const { protectedText, placeholders } = protectPlaceholders(text)
  let lastError

  for (let attempt = 0; attempt < RETRIES; attempt += 1) {
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(protectedText)}`
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'PhD-Atlas-i18n-generator/1.0',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json()
      const translated = Array.isArray(payload?.[0])
        ? payload[0].map((part) => part?.[0] ?? '').join('')
        : ''
      if (!translated) throw new Error('Empty translation')
      const restored = restorePlaceholders(translated, placeholders)
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .trim()
      cache[cacheKey] = restored || text
      return cache[cacheKey]
    } catch (error) {
      lastError = error
      await sleep(200 * (attempt + 1) + Math.random() * 120)
    }
  }

  console.warn(`  ! keep EN for "${text.slice(0, 48)}…" (${lastError?.message ?? 'translate failed'})`)
  cache[cacheKey] = text
  return text
}

async function mapPool(items, limit, worker) {
  const results = new Array(items.length)
  let nextIndex = 0

  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await worker(items[index], index)
      if (REQUEST_GAP_MS > 0) await sleep(REQUEST_GAP_MS)
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, () => run())
  await Promise.all(runners)
  return results
}

function collectStringPaths(value, pathParts = [], out = []) {
  if (typeof value === 'string') {
    out.push({ path: pathParts, value })
    return out
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const [key, child] of Object.entries(value)) {
    collectStringPaths(child, [...pathParts, key], out)
  }
  return out
}

function setPath(target, pathParts, value) {
  let cursor = target
  for (let i = 0; i < pathParts.length - 1; i += 1) {
    const key = pathParts[i]
    if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {}
    cursor = cursor[key]
  }
  cursor[pathParts[pathParts.length - 1]] = value
}

function getPath(target, pathParts) {
  let cursor = target
  for (const key of pathParts) {
    if (!cursor || typeof cursor !== 'object' || !(key in cursor)) return undefined
    cursor = cursor[key]
  }
  return cursor
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

async function loadJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

async function loadCache() {
  try {
    return JSON.parse(await fs.readFile(cachePath, 'utf8'))
  } catch {
    return {}
  }
}

async function saveCache(cache) {
  await fs.writeFile(cachePath, `${JSON.stringify(cache)}\n`, 'utf8')
}

async function translateObject(source, targetLang, cache, label, existing = null) {
  const incremental = missingOnly || untranslatedOnly
  const output = incremental && existing ? cloneJson(existing) : cloneJson(source)
  const entries = collectStringPaths(source).filter((entry) => (
    !incremental
    || getPath(output, entry.path) === undefined
    || (untranslatedOnly && getPath(output, entry.path) === entry.value)
  ))
  let done = 0
  await mapPool(entries, CONCURRENCY, async (entry) => {
    // Never machine-translate language meta names; we set them explicitly.
    if (entry.path[0] === '_meta') {
      if (getPath(output, entry.path) === undefined) setPath(output, entry.path, entry.value)
      return
    }
    const translated = await translateText(entry.value, targetLang, cache)
    setPath(output, entry.path, translated)
    done += 1
    if (done % 80 === 0 || done === entries.length) {
      process.stdout.write(`\r  ${label}: ${done}/${entries.length}`)
    }
  })
  process.stdout.write(`\r  ${label}: ${entries.length}/${entries.length}\n`)
  return output
}

async function ensureLanguagePack(lang, cache) {
  const meta = LANGUAGE_META[lang]
  if (!meta) throw new Error(`Unknown language "${lang}". Add it to LANGUAGE_META.`)

  console.log(`\n→ Building ${lang} (${meta.nativeName})`)

  const manifest = {
    _meta: {
      nativeName: meta.nativeName,
      name: meta.name,
    },
    appTitle: 'PhD Atlas',
    appDesc: await translateText(
      'A private workspace for applications, checklists, emails, and decisions.',
      lang,
      cache,
    ),
    languagePack: 'modular',
    namespaces: [...NAMESPACES],
  }
  await writeJson(path.join(root, 'src', 'i18n', `${lang}.json`), manifest)

  for (const namespace of NAMESPACES) {
    const sourcePath = path.join(enDir, `${namespace}.json`)
    const targetPath = path.join(root, 'src', 'i18n', lang, `${namespace}.json`)
    const source = await loadJson(sourcePath)
    let existing = null
    if (missingOnly || untranslatedOnly) {
      try {
        existing = await loadJson(targetPath)
      } catch {
        // A missing target namespace is equivalent to an empty language pack.
      }
    }
    const translated = await translateObject(source, lang, cache, `${lang}/${namespace}.json`, existing)
    if (namespace === 'core') {
      translated._meta = {
        nativeName: meta.nativeName,
        name: meta.name,
      }
      if (typeof translated.appTitle === 'string') translated.appTitle = 'PhD Atlas'
    }
    await writeJson(targetPath, translated)
    // Persist cache between namespaces so interrupted runs keep progress.
    await saveCache(cache)
  }
}

async function main() {
  const unknown = targetLangs.filter((lang) => !LANGUAGE_META[lang])
  if (unknown.length) {
    throw new Error(`Unsupported language codes: ${unknown.join(', ')}`)
  }

  console.log(`Generating language packs: ${targetLangs.join(', ')}`)
  const cache = await loadCache()
  const started = Date.now()

  for (const lang of targetLangs) {
    await ensureLanguagePack(lang, cache)
  }

  await saveCache(cache)
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`\nDone in ${seconds}s. Cache entries: ${Object.keys(cache).length}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
