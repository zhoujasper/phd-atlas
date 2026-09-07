import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { desktopContextMenuTemplate, desktopLanguages, desktopMenuTemplate, desktopTranslator, readDesktopLanguage, saveDesktopLanguage } from '../desktop/localization.mjs'
import { containsTranslationMarker, isReviewedLiteral, looksLikeSharedEnglish } from '../tools/i18n-literal-policy.mjs'

describe('desktop localization', () => {
  it('remembers the chosen language and safely handles a missing or corrupt cache', () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-language-'))
    try {
      const file = join(root, 'language.json')
      expect(readDesktopLanguage(file, 'pt_BR')).toBe('pt')
      expect(saveDesktopLanguage(file, 'ja')).toBe(true)
      expect(readDesktopLanguage(file, 'zh-CN')).toBe('ja')
      expect(saveDesktopLanguage(file, '../en')).toBe(false)
      expect(readDesktopLanguage(file, 'zh-CN')).toBe('ja')
      writeFileSync(file, 'invalid')
      expect(readDesktopLanguage(file, 'zh-Hans-CN')).toBe('zh')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('keeps native command roles and labels in every language without exposing production developer tools', () => {
    for (const language of desktopLanguages) {
      const t = desktopTranslator(language)
      const menu = desktopMenuTemplate(t)
      const commands = menu.flatMap((item) => item.submenu).flatMap((item) => item.submenu ?? item)
      expect(commands.find((item) => item.role === 'pasteAndMatchStyle')).toMatchObject({ label: t('pasteAndMatchStyle') })
      expect(commands.some((item) => item.role === 'toggleDevTools')).toBe(false)
      expect(menu[1].label).toBe(t('edit'))
      expect(t('startupExited', { code: 12 })).toContain('12')
      expect(t('startupExited', { code: 12 })).not.toContain('{code}')
    }
    expect(() => desktopTranslator('zh')('missing-key')).toThrow('Missing desktop translation')
  })

  it('disables unavailable edit actions and permits only validated external links', () => {
    const actions = { allowLink: (url) => url.startsWith('https:'), openLink: vi.fn(), copyLink: vi.fn() }
    const menu = desktopContextMenuTemplate(desktopTranslator('zh'), {
      isEditable: true, editFlags: { canUndo: false, canCopy: true, canPaste: false }, linkURL: 'https://example.org',
    }, actions)
    expect(menu.find((item) => item.role === 'undo').enabled).toBe(false)
    expect(menu.find((item) => item.role === 'paste').enabled).toBe(false)
    menu.find((item) => item.label === '复制链接地址').click()
    expect(actions.copyLink).toHaveBeenCalledWith('https://example.org')
    expect(desktopContextMenuTemplate(desktopTranslator('zh'), { linkURL: 'javascript:alert(1)' }, actions)).toEqual([])
  })

  it('exposes only a language-specific IPC method and localizes the splash through the sandboxed preload', () => {
    const send = vi.fn(); const listeners = new Map(); let bridge
    const loading = { setAttribute: vi.fn() }; const document = { documentElement: {}, getElementById: () => loading }
    runInNewContext(readFileSync(join(process.cwd(), 'desktop/preload.cjs'), 'utf8'), {
      require: () => ({ contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value } }, ipcRenderer: { send, on: (name, callback) => listeners.set(name, callback) } }),
      process: { platform: 'darwin', argv: ['--phd-atlas-language=ja'] }, document, window: { location: { protocol: 'file:' } },
    })
    expect(bridge.language).toBe('ja')
    bridge.setLanguage('zh')
    expect(send).toHaveBeenCalledWith('desktop:set-language', 'zh')
    expect(bridge.send).toBeUndefined()
    listeners.get('desktop:locale')({}, { language: 'zh', loading: '正在载入…' })
    expect(document.documentElement.lang).toBe('zh-CN')
    expect(loading.setAttribute).toHaveBeenCalledWith('aria-label', '正在载入…')
  })

  it('rejects short English fallbacks and transport markers without rejecting native cognates or interpolation', () => {
    expect(isReviewedLiteral('fr', '_staticText.Date', 'Date')).toBe(true)
    expect(isReviewedLiteral('ja', 'discover.unwatch', 'Unwatch')).toBe(false)
    expect(isReviewedLiteral('fr', '_staticText.Unwatch', 'Unwatch')).toBe(false)
    expect(containsTranslationMarker('vi', 'amount', 'Amount TBD', 'Số tiền TBD')).toBe(true)
    expect(containsTranslationMarker('es', 'settings.completeArchiveExt', 'ALL', 'TODO')).toBe(false)
    expect(containsTranslationMarker('ja', 'title', 'Title', '__PH_0__')).toBe(true)
    expect(looksLikeSharedEnglish('Add AI synthesis')).toBe(true)
    expect(looksLikeSharedEnglish('Catalog match confidence: {score}%. AI suggestions are labeled separately.')).toBe(true)
  })
})
