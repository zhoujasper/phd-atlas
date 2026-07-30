import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectSchoolLogoGeometry, detectSchoolLogoMime } from './schoolLogoResolver.js'

const CATALOG_ROOT = dirname(fileURLToPath(import.meta.url))
const CATALOG_PATH = resolve(CATALOG_ROOT, 'school-logo-catalog', 'catalog.json')
const ASSET_ROOT = resolve(CATALOG_ROOT, 'school-logo-catalog', 'assets')
const MAX_CATALOG_ENTRIES = 1_000
const MAX_ASSET_BYTES = 600_000
const MAX_CACHED_ASSETS = 64
const GENERIC_ALIASES = new Set([
  'academy',
  'college',
  'institute',
  'school',
  'the university',
  'university',
])

function normalizeCatalogText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{Mark}+/gu, '')
    .toLowerCase()
    .replace(/&/gu, ' and ')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ')
}

function containsNonLatinText(value) {
  return /[^\p{Script=Latin}\p{Number}\s]/u.test(value)
}

function safeCatalogEntry(entry) {
  if (
    !entry
    || typeof entry !== 'object'
    || !/^[a-z0-9-]{4,100}$/u.test(String(entry.id || ''))
    || !/^[a-z0-9-]{4,100}\.png$/u.test(String(entry.asset || ''))
    || !String(entry.name || '').trim()
    || !String(entry.officialWebsite || '').startsWith('https://')
    || !Array.isArray(entry.aliases)
  ) return null
  return Object.freeze({
    ...entry,
    aliases: Object.freeze(entry.aliases
      .map((alias) => String(alias || '').normalize('NFKC').trim())
      .filter(Boolean)
      .slice(0, 128)),
  })
}

function loadCatalog() {
  try {
    const parsed = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'))
    const entries = Array.isArray(parsed.entries)
      ? parsed.entries.slice(0, MAX_CATALOG_ENTRIES).map(safeCatalogEntry).filter(Boolean)
      : []
    return Object.freeze({
      version: String(parsed.version || ''),
      generatedAt: String(parsed.generatedAt || ''),
      entries: Object.freeze(entries),
    })
  } catch {
    return Object.freeze({ version: '', generatedAt: '', entries: Object.freeze([]) })
  }
}

const catalog = loadCatalog()
const searchableAliases = []

for (const [entryIndex, entry] of catalog.entries.entries()) {
  const canonical = normalizeCatalogText(entry.name)
  const seen = new Set()
  for (const alias of [entry.name, ...entry.aliases]) {
    const normalized = normalizeCatalogText(alias)
    if (
      !normalized
      || seen.has(normalized)
      || GENERIC_ALIASES.has(normalized)
      || normalized.length < (containsNonLatinText(normalized) ? 2 : 3)
    ) continue
    seen.add(normalized)
    searchableAliases.push(Object.freeze({
      entry,
      entryIndex,
      alias: normalized,
      canonical: normalized === canonical,
      acronym: /^[A-Z0-9]{2,10}$/u.test(String(alias).trim()),
      compactScript: containsNonLatinText(normalized) && !normalized.includes(' '),
    }))
  }
}

searchableAliases.sort((left, right) => (
  right.alias.length - left.alias.length
  || Number(right.canonical) - Number(left.canonical)
  || left.entryIndex - right.entryIndex
))

const assetCache = new Map()

function boundedAssetCacheSet(asset, dataUrl) {
  assetCache.delete(asset)
  assetCache.set(asset, dataUrl)
  while (assetCache.size > MAX_CACHED_ASSETS) {
    assetCache.delete(assetCache.keys().next().value)
  }
}

function aliasMatchScore(schoolName, candidate) {
  if (schoolName === candidate.alias) {
    return 100_000 + candidate.alias.length * 10 + (candidate.canonical ? 5 : 0)
  }
  if (
    !candidate.compactScript
    && !candidate.acronym
    && !candidate.alias.includes(' ')
    && !/\b(?:academy|college|institute|school|university)\b/u.test(schoolName)
  ) return 0
  if (candidate.compactScript) {
    const index = schoolName.indexOf(candidate.alias)
    return index < 0 ? 0 : 50_000 + candidate.alias.length * 10 - index
  }
  const paddedName = ` ${schoolName} `
  const paddedAlias = ` ${candidate.alias} `
  const index = paddedName.indexOf(paddedAlias)
  return index < 0 ? 0 : 50_000 + candidate.alias.length * 10 - index
}

export function schoolLogoCatalogInfo() {
  return {
    version: catalog.version,
    generatedAt: catalog.generatedAt,
    entryCount: catalog.entries.length,
  }
}

export function matchSchoolLogoCatalog(schoolName) {
  const normalizedName = normalizeCatalogText(schoolName)
  if (!normalizedName) return null
  let best = null
  let bestScore = 0
  let tiedWithDifferentAsset = false
  for (const candidate of searchableAliases) {
    const score = aliasMatchScore(normalizedName, candidate)
    if (score < bestScore) continue
    if (score > bestScore) {
      best = candidate.entry
      bestScore = score
      tiedWithDifferentAsset = false
      continue
    }
    if (score > 0 && best && candidate.entry.asset !== best.asset) {
      tiedWithDifferentAsset = true
    }
  }
  return bestScore > 0 && !tiedWithDifferentAsset ? best : null
}

export async function resolveSchoolLogoCatalogAsset(schoolName) {
  const entry = matchSchoolLogoCatalog(schoolName)
  if (!entry) return { found: false, reason: 'not-found', catalogHit: false }
  let dataUrl = assetCache.get(entry.asset)
  if (dataUrl) {
    assetCache.delete(entry.asset)
    assetCache.set(entry.asset, dataUrl)
  } else {
    const assetPath = resolve(ASSET_ROOT, entry.asset)
    if (dirname(assetPath) !== ASSET_ROOT) {
      return { found: false, reason: 'not-found', catalogHit: false }
    }
    const bytes = await readFile(assetPath).catch(() => null)
    if (!bytes || bytes.length > MAX_ASSET_BYTES) {
      return { found: false, reason: 'not-found', catalogHit: false }
    }
    const mime = detectSchoolLogoMime(bytes, 'image/png')
    const geometry = detectSchoolLogoGeometry(bytes, mime)
    if (
      mime !== 'image/png'
      || !geometry
      || geometry.width < 64
      || geometry.height < 64
      || geometry.width > 1_024
      || geometry.height > 1_024
      || geometry.width * geometry.height > 1_048_576
    ) {
      return { found: false, reason: 'not-found', catalogHit: false }
    }
    dataUrl = `data:image/png;base64,${bytes.toString('base64')}`
    boundedAssetCacheSet(entry.asset, dataUrl)
  }
  return {
    found: true,
    dataUrl,
    sourceUrl: entry.sourceUrl || entry.officialWebsite,
    websiteUrl: entry.officialWebsite,
    candidateKind: entry.candidateKind || 'builtin-logo-catalog-v1',
    catalogId: entry.id,
    catalogHit: true,
  }
}
