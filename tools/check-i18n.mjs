import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const i18nRoot = path.join(process.cwd(), 'src', 'i18n')
const requiredLanguages = ['en', 'zh', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'vi', 'th']
// Translation providers may transliterate I18N/PH marker text while keeping the
// surrounding double underscores, so reject the transport envelope itself.
const markerPattern = /__/

function flatten(value, prefix = '', output = new Map()) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, `${prefix}[${index}]`, output))
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) flatten(item, prefix ? `${prefix}.${key}` : key, output)
  } else {
    output.set(prefix, value)
  }
  return output
}

function placeholders(value) {
  if (typeof value !== 'string') return []
  return Array.from(value.matchAll(/\{(\w+)\}/g), (match) => match[1]).sort()
}

function readJson(filePath, errors) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    errors.push(`${path.relative(process.cwd(), filePath)}: invalid JSON (${error.message})`)
    return null
  }
}

const errors = []
const warnings = []
const englishDir = path.join(i18nRoot, 'en')
const englishFiles = fs.readdirSync(englishDir).filter((file) => file.endsWith('.json')).sort()
const english = new Map(englishFiles.map((file) => [file, flatten(readJson(path.join(englishDir, file), errors) ?? {})]))

for (const language of requiredLanguages) {
  const languageDir = path.join(i18nRoot, language)
  const manifestPath = path.join(i18nRoot, `${language}.json`)
  if (!fs.existsSync(languageDir)) {
    errors.push(`${language}: missing language directory`)
    continue
  }
  if (!fs.existsSync(manifestPath)) {
    errors.push(`${language}: missing root manifest`)
    continue
  }

  const manifest = readJson(manifestPath, errors)
  const files = fs.readdirSync(languageDir).filter((file) => file.endsWith('.json')).sort()
  const declaredNamespaces = Array.isArray(manifest?.namespaces)
    ? manifest.namespaces.map((namespace) => `${namespace}.json`).sort()
    : []
  if (files.join('\n') !== englishFiles.join('\n')) {
    errors.push(`${language}: namespace files differ from English (${files.length}/${englishFiles.length})`)
  }
  if (declaredNamespaces.join('\n') !== englishFiles.join('\n')) {
    errors.push(`${language}: manifest namespace list differs from language files`)
  }
  if (typeof manifest?._meta?.nativeName !== 'string' || !manifest._meta.nativeName.trim()) {
    errors.push(`${language}: manifest is missing _meta.nativeName`)
  }

  let identical = 0
  for (const file of englishFiles) {
    const baseline = english.get(file)
    const localized = flatten(readJson(path.join(languageDir, file), errors) ?? {})
    for (const [key, source] of baseline) {
      if (!localized.has(key)) {
        errors.push(`${language}/${file}: missing ${key}`)
        continue
      }
      const target = localized.get(key)
      if (typeof source !== typeof target) {
        errors.push(`${language}/${file}:${key}: type differs from English`)
        continue
      }
      if (typeof target === 'string') {
        if (source && !target.trim()) errors.push(`${language}/${file}:${key}: empty translation`)
        if (markerPattern.test(target)) errors.push(`${language}/${file}:${key}: contains an internal translation marker`)
        if (placeholders(source).join(',') !== placeholders(target).join(',')) {
          errors.push(`${language}/${file}:${key}: placeholders differ (${placeholders(source).join(',')} -> ${placeholders(target).join(',')})`)
        }
        if (language !== 'en' && !key.startsWith('_staticText.') && target === source && /[A-Za-z]{3}/.test(source)) identical += 1
      }
    }
    for (const key of localized.keys()) {
      if (!baseline.has(key)) errors.push(`${language}/${file}: unexpected ${key}`)
    }
  }
  if (language !== 'en' && identical > 0) warnings.push(`${language}: ${identical} English-identical strings (brands and technical labels included)`)
}

if (warnings.length) {
  console.log('i18n review notes:')
  warnings.forEach((warning) => console.log(`  - ${warning}`))
}

if (errors.length) {
  console.error(`\ni18n validation failed with ${errors.length} issue(s):`)
  errors.forEach((error) => console.error(`  - ${error}`))
  process.exit(1)
}

console.log(`\ni18n validation passed: ${requiredLanguages.length} languages × ${englishFiles.length} namespaces.`)
