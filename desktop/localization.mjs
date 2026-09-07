import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const desktopLanguages = Object.freeze(['en', 'zh', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'vi', 'th'])
const localeRoot = join(dirname(fileURLToPath(import.meta.url)), 'locales')
const dictionaries = new Map()

export function resolveDesktopLanguage(value) {
  const language = String(value ?? '').toLowerCase().replaceAll('_', '-').split('-')[0]
  return desktopLanguages.includes(language) ? language : 'en'
}

export function readDesktopLanguage(file, systemLanguage) {
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')).language
    if (desktopLanguages.includes(saved)) return saved
  } catch { /* A new or read-only cache uses the system language. */ }
  return resolveDesktopLanguage(systemLanguage)
}

export function saveDesktopLanguage(file, language) {
  if (!desktopLanguages.includes(language)) return false
  try {
    writeFileSync(`${file}.tmp`, JSON.stringify({ language }), { mode: 0o600 })
    renameSync(`${file}.tmp`, file)
    return true
  } catch { return false }
}

export function desktopTranslator(language) {
  const resolved = resolveDesktopLanguage(language)
  if (!dictionaries.has(resolved)) dictionaries.set(resolved, JSON.parse(readFileSync(join(localeRoot, `${resolved}.json`), 'utf8')))
  const dictionary = dictionaries.get(resolved)
  return (key, values = {}) => {
    if (typeof dictionary[key] !== 'string') throw new Error(`Missing desktop translation: ${resolved}.${key}`)
    return dictionary[key].replace(/\{(\w+)\}/g, (match, name) => String(values[name] ?? match))
  }
}

export function desktopMenuTemplate(t, { isDev = false } = {}) {
  const role = (name) => ({ role: name, label: t(name) })
  const separator = { type: 'separator' }
  return [
    { label: 'PhD Atlas', submenu: [role('about'), separator, role('services'), separator, role('hide'), role('hideOthers'), role('unhide'), separator, role('quit')] },
    { label: t('edit'), submenu: [
      role('undo'), role('redo'), separator, role('cut'), role('copy'), role('paste'), role('pasteAndMatchStyle'), role('delete'), role('selectAll'), separator,
      { label: t('substitutions'), submenu: [role('showSubstitutions'), separator, role('toggleSmartQuotes'), role('toggleSmartDashes'), role('toggleTextReplacement')] },
      { label: t('speech'), submenu: [role('startSpeaking'), role('stopSpeaking')] },
    ] },
    { label: t('view'), submenu: [role('reload'), role('forceReload'), ...(isDev ? [role('toggleDevTools')] : []), separator, role('resetZoom'), role('zoomIn'), role('zoomOut'), separator, role('togglefullscreen')] },
    { role: 'windowMenu', label: t('window'), submenu: [role('minimize'), role('zoom'), role('close'), separator, role('front')] },
  ]
}

export function desktopContextMenuTemplate(t, params, actions) {
  const items = []
  const role = (name, allowed) => ({ role: name, label: t(name), enabled: allowed === true })
  const flags = params.editFlags ?? {}
  if (params.isEditable) {
    items.push(role('undo', flags.canUndo), role('redo', flags.canRedo), { type: 'separator' },
      role('cut', flags.canCut), role('copy', flags.canCopy), role('paste', flags.canPaste),
      role('pasteAndMatchStyle', flags.canPaste), role('delete', flags.canDelete), role('selectAll', flags.canSelectAll))
  } else if (params.selectionText) items.push(role('copy', flags.canCopy))
  if (params.linkURL && actions.allowLink(params.linkURL)) {
    if (items.length) items.push({ type: 'separator' })
    items.push({ label: t('openLink'), click: () => actions.openLink(params.linkURL) },
      { label: t('copyLink'), click: () => actions.copyLink(params.linkURL) })
  }
  return items
}
