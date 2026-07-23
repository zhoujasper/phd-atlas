import fallbackEnglish from './i18n/en/core.json'
import fallbackEnglishShared from './i18n/en/shared.json'
import fallbackChinese from './i18n/zh/core.json'
import fallbackChineseShared from './i18n/zh/shared.json'

export type Language = string
export type I18nNamespace = string
export type LangDict = Record<string, unknown>

type LanguageState = {
  dictionaries: Map<I18nNamespace, LangDict>
  merged: LangDict
  scopedMerged: Map<string, LangDict>
  loadedNamespaces: Set<I18nNamespace>
}

const defaultLanguage: Language = 'en'
const defaultNamespace: I18nNamespace = 'core'
/** Preferred display order for built-in packs (others sort alphabetically after). */
const builtInLanguageOrder = ['en', 'zh', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'vi', 'th']
const builtInLanguageNames: Record<string, string> = {
  en: 'English',
  zh: '中文',
  ja: '日本語',
  ko: '한국어',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  pt: 'Português',
  it: 'Italiano',
  ru: 'Русский',
  vi: 'Tiếng Việt',
  th: 'ไทย',
}

/** BCP 47 locales used for dates, numbers, and relative time. */
const languageLocales: Record<string, string> = {
  en: 'en-US',
  zh: 'zh-CN',
  ja: 'ja-JP',
  ko: 'ko-KR',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  pt: 'pt-BR',
  it: 'it-IT',
  ru: 'ru-RU',
  vi: 'vi-VN',
  th: 'th-TH',
}

const registry = new Map<Language, LanguageState>()
const languageFileModules = import.meta.glob('./i18n/*.json')
const namespaceFileModules = import.meta.glob('./i18n/*/*.json')
const knownLanguages = new Set<Language>([defaultLanguage])
const inFlightNamespaceLoads = new Map<string, Promise<LangDict>>()

function normalizeLanguageCode(lang: unknown): Language | null {
  if (typeof lang !== 'string') return null
  const normalized = lang.trim().toLowerCase()
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/.test(normalized) ? normalized : null
}

function normalizeNamespace(namespace: unknown): I18nNamespace {
  return typeof namespace === 'string' && namespace.trim() ? namespace.trim() : defaultNamespace
}

function readJsonModule(module: unknown): LangDict {
  return (((module as { default?: unknown })?.default ?? module) ?? {}) as LangDict
}

function mergeDeep(base: LangDict, patch: LangDict): LangDict {
  const next: LangDict = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    const current = next[key]
    if (
      current &&
      value &&
      typeof current === 'object' &&
      typeof value === 'object' &&
      !Array.isArray(current) &&
      !Array.isArray(value)
    ) {
      next[key] = mergeDeep(current as LangDict, value as LangDict)
    } else {
      next[key] = value
    }
  }
  return next
}

function languageState(lang: Language): LanguageState {
  const current = registry.get(lang)
  if (current) return current
  const next = {
    dictionaries: new Map<I18nNamespace, LangDict>(),
    merged: {},
    scopedMerged: new Map<string, LangDict>(),
    loadedNamespaces: new Set<I18nNamespace>(),
  }
  registry.set(lang, next)
  knownLanguages.add(lang)
  return next
}

function rebuildLanguage(lang: Language) {
  const state = languageState(lang)
  const namespaces = [
    defaultNamespace,
    ...Array.from(state.dictionaries.keys()).filter((namespace) => namespace !== defaultNamespace).sort(),
  ]
  state.merged = namespaces.reduce<LangDict>((merged, namespace) => (
    mergeDeep(merged, state.dictionaries.get(namespace) ?? {})
  ), {})
}

function collectKnownLanguages() {
  for (const path of Object.keys(languageFileModules)) {
    const match = path.match(/\.\/i18n\/(.+)\.json$/)
    if (match?.[1]) knownLanguages.add(match[1])
  }
  for (const path of Object.keys(namespaceFileModules)) {
    const match = path.match(/\.\/i18n\/([^/]+)\/[^/]+\.json$/)
    if (match?.[1]) knownLanguages.add(match[1])
  }
}

function rootLanguageModule(lang: Language) {
  return languageFileModules[`./i18n/${lang}.json`] as (() => Promise<unknown>) | undefined
}

function namespaceModule(lang: Language, namespace: I18nNamespace) {
  return namespaceFileModules[`./i18n/${lang}/${namespace}.json`] as (() => Promise<unknown>) | undefined
}

export function registerLanguage(
  lang: Language,
  dict: LangDict,
  namespace: I18nNamespace = defaultNamespace,
) {
  const normalized = normalizeLanguageCode(lang)
  if (!normalized) return
  const normalizedNamespace = normalizeNamespace(namespace)
  const state = languageState(normalized)
  state.dictionaries.set(normalizedNamespace, dict)
  state.loadedNamespaces.add(normalizedNamespace)
  if (normalizedNamespace === defaultNamespace) {
    state.scopedMerged.clear()
  } else {
    for (const key of state.scopedMerged.keys()) {
      if (key.split('|').includes(normalizedNamespace)) state.scopedMerged.delete(key)
    }
  }
  rebuildLanguage(normalized)
}

export function getDict(lang: Language): LangDict {
  return registry.get(lang)?.merged ?? registry.get(defaultLanguage)?.merged ?? {}
}

/**
 * Return a stable merged dictionary for one rendered surface.
 *
 * Loading an unrelated lazy namespace used to replace the root merged object,
 * invalidating the app-wide i18n context on the next overlay state change. Keep
 * namespace-scoped snapshots cached so opening a Share/Tour/Profile dialog does
 * not force every screen beneath it to render again.
 */
export function getDictForNamespaces(
  lang: Language,
  namespaces: I18nNamespace[] = [defaultNamespace],
): LangDict {
  const normalizedLanguage = resolveLanguage(lang)
  const state = registry.get(normalizedLanguage) ?? registry.get(defaultLanguage)
  if (!state) return {}

  const normalizedNamespaces = Array.from(new Set([
    defaultNamespace,
    ...namespaces.map(normalizeNamespace),
  ]))
  const key = normalizedNamespaces.sort().join('|')
  const cached = state.scopedMerged.get(key)
  if (cached) return cached

  const merged = normalizedNamespaces.reduce<LangDict>((result, namespace) => (
    mergeDeep(result, state.dictionaries.get(namespace) ?? {})
  ), {})
  state.scopedMerged.set(key, merged)
  return merged
}

export function hasLanguageNamespaces(
  lang: Language,
  namespaces: I18nNamespace[] = [defaultNamespace],
): boolean {
  const normalized = resolveLanguage(lang)
  const state = registry.get(normalized)
  if (!state) return false
  return Array.from(new Set([defaultNamespace, ...namespaces.map(normalizeNamespace)]))
    .every((namespace) => state.loadedNamespaces.has(namespace))
}

export function availableLanguages(): Language[] {
  return Array.from(knownLanguages).sort((a, b) => {
    const ai = builtInLanguageOrder.indexOf(a)
    const bi = builtInLanguageOrder.indexOf(b)
    if (ai >= 0 || bi >= 0) return (ai >= 0 ? ai : Number.MAX_SAFE_INTEGER) - (bi >= 0 ? bi : Number.MAX_SAFE_INTEGER)
    return a.localeCompare(b)
  })
}

export function resolveLanguage(lang: unknown, fallback: Language = defaultLanguage): Language {
  const normalized = normalizeLanguageCode(lang)
  if (normalized && knownLanguages.has(normalized)) return normalized
  const base = normalized?.split('-')[0]
  if (base && knownLanguages.has(base)) return base
  return knownLanguages.has(fallback) ? fallback : (availableLanguages()[0] ?? defaultLanguage)
}

export function browserDefaultLanguage(language = navigator.language): Language {
  const candidates = [language, ...navigator.languages]
  for (const candidate of candidates) {
    const normalized = normalizeLanguageCode(candidate)
    if (!normalized) continue
    if (knownLanguages.has(normalized)) return normalized
    const base = normalized.split('-')[0]
    if (base && knownLanguages.has(base)) return base
  }
  return resolveLanguage(defaultLanguage)
}

export function nextLanguage(lang: Language): Language {
  const languages = availableLanguages()
  if (languages.length <= 1) return resolveLanguage(lang)
  const current = resolveLanguage(lang)
  const index = languages.indexOf(current)
  return languages[(index + 1) % languages.length] ?? languages[0]
}

export function languageLabel(lang: Language): string {
  const normalized = normalizeLanguageCode(lang) ?? String(lang ?? '').trim().toLowerCase()
  // Only read pack meta from the language that is actually registered.
  // getDict(lang) falls through to English when a pack is not loaded yet, which
  // made every option in the language picker show "English".
  const registered = registry.get(normalized)?.merged
  const meta = registered?._meta
  if (meta && typeof meta === 'object') {
    const nativeName = (meta as LangDict).nativeName
    const name = (meta as LangDict).name
    if (typeof nativeName === 'string' && nativeName.trim()) return nativeName
    if (typeof name === 'string' && name.trim()) return name
  }
  const base = normalized.split('-')[0]
  return builtInLanguageNames[normalized]
    ?? (base ? builtInLanguageNames[base] : undefined)
    ?? (normalized ? normalized.toUpperCase() : String(lang ?? '').toUpperCase())
}

export function languageOptions(): Array<{ value: Language; label: string }> {
  return availableLanguages().map((lang) => ({ value: lang, label: languageLabel(lang) }))
}

export function localeForLanguage(lang: string): string {
  const normalized = normalizeLanguageCode(lang)
  if (!normalized) return languageLocales[defaultLanguage] ?? defaultLanguage
  if (languageLocales[normalized]) return languageLocales[normalized]
  const base = normalized.split('-')[0]
  if (base && languageLocales[base]) return languageLocales[base]
  if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh-CN'
  return normalized
}

/** Prefer the document language for a11y and browser features (spellcheck, etc.). */
export function applyDocumentLanguage(lang: string) {
  if (typeof document === 'undefined') return
  const locale = localeForLanguage(lang)
  document.documentElement.lang = locale
  document.documentElement.dataset.lang = resolveLanguage(lang)
}

export async function loadLanguageNamespace(
  lang: string,
  namespace: I18nNamespace = defaultNamespace,
): Promise<LangDict> {
  const normalized = resolveLanguage(lang)
  const normalizedNamespace = normalizeNamespace(namespace)
  const state = languageState(normalized)
  if (state.loadedNamespaces.has(normalizedNamespace)) {
    return state.merged
  }

  const loadKey = `${normalized}:${normalizedNamespace}`
  const inFlight = inFlightNamespaceLoads.get(loadKey)
  if (inFlight) return inFlight

  const load = (async () => {
    const moduleLoader = namespaceModule(normalized, normalizedNamespace)
    if (moduleLoader) {
      const module = await moduleLoader()
      registerLanguage(normalized, readJsonModule(module), normalizedNamespace)
      return getDict(normalized)
    }

    if (normalizedNamespace === defaultNamespace) {
      const rootLoader = rootLanguageModule(normalized)
      if (rootLoader) {
        const module = await rootLoader()
        registerLanguage(normalized, readJsonModule(module), defaultNamespace)
        return getDict(normalized)
      }
    }

    state.loadedNamespaces.add(normalizedNamespace)
    return state.merged
  })()

  inFlightNamespaceLoads.set(loadKey, load)
  void load.finally(() => {
    if (inFlightNamespaceLoads.get(loadKey) === load) inFlightNamespaceLoads.delete(loadKey)
  })
  return load
}

export async function loadLanguage(
  lang: string,
  namespaces: I18nNamespace[] = [defaultNamespace],
): Promise<LangDict> {
  const normalized = resolveLanguage(lang)
  const uniqueNamespaces = Array.from(new Set([defaultNamespace, ...namespaces.map(normalizeNamespace)]))
  await Promise.all(uniqueNamespaces.map((namespace) => loadLanguageNamespace(normalized, namespace)))
  return getDict(normalized)
}

export async function loadLanguageFile(lang: string): Promise<LangDict> {
  return loadLanguage(lang, [defaultNamespace])
}

export async function preloadLanguage(lang: string, namespaces: I18nNamespace[] = [defaultNamespace]): Promise<void> {
  await loadLanguage(lang, namespaces)
}

export function tpl(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? `{${key}}`))
}

/** Locale-aware conjunction lists (e.g. "A, B, and C" / "A、B、C"). */
export function formatList(lang: string, items: string[], style: Intl.ListFormatStyle = 'long'): string {
  const cleaned = items.map((item) => item.trim()).filter(Boolean)
  if (cleaned.length === 0) return ''
  if (cleaned.length === 1) return cleaned[0]
  try {
    return new Intl.ListFormat(localeForLanguage(lang), { style, type: 'conjunction' }).format(cleaned)
  } catch {
    const base = resolveLanguage(lang).split('-')[0]
    if (base === 'zh' || base === 'ja' || base === 'ko') {
      if (cleaned.length === 2) return `${cleaned[0]}${base === 'ko' ? ' 및 ' : '和'}${cleaned[1]}`
      return `${cleaned.slice(0, -1).join(base === 'ko' ? ', ' : '、')}${base === 'ko' ? ' 및 ' : '和'}${cleaned[cleaned.length - 1]}`
    }
    if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`
    return `${cleaned.slice(0, -1).join(', ')}, and ${cleaned[cleaned.length - 1]}`
  }
}

/** Locale-aware integer/count formatting for UI chips and badges. */
export function formatCount(lang: string, value: number): string {
  try {
    return new Intl.NumberFormat(localeForLanguage(lang)).format(value)
  } catch {
    return String(value)
  }
}

/** Scripts that typically need denser UI chrome and different wrapping. */
export function isCjkUiLanguage(lang: string): boolean {
  const base = resolveLanguage(lang).split('-')[0]
  return base === 'zh' || base === 'ja' || base === 'ko'
}

function resolveDictValue(dict: LangDict, path: string): string | null {
  const keys = path.split('.')
  let value: unknown = dict
  for (const key of keys) {
    if (value && typeof value === 'object') {
      value = (value as LangDict)[key]
    } else {
      return null
    }
  }
  return typeof value === 'string' && value ? value : null
}

export function t(lang: Language, path: string, fallback?: string): string {
  const dict = getDict(lang)
  const fallbackDict = getDict(defaultLanguage)
  return (
    resolveDictValue(dict, path) ??
    (lang !== defaultLanguage ? resolveDictValue(fallbackDict, path) : null) ??
    fallback ??
    path
  )
}

const zhStaticText: Record<string, string> = {
  'Master academic CV': '学术简历总版',
  'Canonical CV with publication, teaching, project, and award sections for quick reuse.': '包含论文、教学、项目和获奖经历的标准简历，便于快速复用。',
  'Statement paragraph bank': '个人陈述段落库',
  'Reusable research background, motivation, and professor-fit paragraphs.': '可复用的研究背景、申请动机和教授匹配段落。',
  'Recommendation letter tracker': '推荐信跟踪表',
  'Unified recommender requests with upload status and deadline reminders.': '统一管理推荐人请求、上传状态和截止提醒。',
  'Personal website and portfolio': '个人主页与作品集',
  'Public profile, project demos, papers, and selected code links.': '公开主页、项目演示、论文和精选代码链接。',
  'CV and transcript package': '简历与成绩单材料包',
  'Canonical CV, resume, transcript, and credential materials for quick reuse.': '可快速复用的简历、成绩单和申请资质材料。',
  'Personal statement paragraph bank': '个人陈述段落库',
  'Reusable background, motivation, and program-fit paragraphs.': '可复用的背景、动机和项目匹配段落。',
  'Research proposal brief': '研究计划简版',
  'Research interests, project abstract, methods, and faculty-fit notes.': '研究兴趣、项目摘要、方法和导师匹配备注。',
  'SOP draft': 'SOP 草稿',
  'Statement of purpose material and program-fit language.': '目的陈述材料和项目匹配表述。',
  'PDF / DOCX': 'PDF / DOCX',
  Markdown: 'Markdown',
  Checklist: '清单',
  URL: '链接',
  'Statement of Purpose': '个人陈述',
  'Statement of Purpose (SOP)': '目的陈述（SOP）',
  'Personal Statement (PS)': '个人陈述（PS）',
  'Recommendation Letters': '推荐信',
  'Research Proposal': '研究计划',
  'Research Proposal (RP)': '研究计划（RP）',
  'Language Scores (IELTS/TOEFL)': '语言成绩（IELTS/TOEFL）',
  'Portal Registration': '网申登记',
  'Final Submission': '最终提交',
  'Academic CV': '学术简历',
  Transcript: '成绩单',
  'Writing Sample': '写作样本',
  'Interview Notes': '面试笔记',
  'Offer Letter': '录取通知书',
  Document: '文档',
  Request: '请求',
  Essay: '文书',
  'Score report': '成绩报告',
  Portal: '门户',
  Milestone: '里程碑',
  'Uploaded files': '已上传文件',
  'Current CV with education, publications, projects, and awards.': '包含教育经历、论文、项目和奖项的当前简历。',
  'Track each recommender, contact method, and request status.': '记录每位推荐人、联系方式和请求状态。',
  'Applicant background, motivation, and fit narrative.': '申请人背景、动机和匹配叙述。',
  'Research question, method, expected contribution, and advisor fit.': '研究问题、方法、预期贡献和导师匹配。',
  'Record score report availability and portal delivery status.': '记录成绩报告是否可用以及网申投递状态。',
  'Register the application portal account and confirm login access.': '登记网申门户账号并确认可以登录。',
  'Program-specific statement of purpose.': '针对项目定制的目的陈述。',
  'Final review, payment, and submission confirmation.': '最终检查、付款和提交确认。',
  'Draft created': '草稿已创建',
  'Offer received': '收到录取',
  'Submitted portal application': '已提交网申',
  'Reply received': '收到回复',
  'Shortlisted program': '已列入候选项目',
  'Cold email sent': '已发送套磁邮件',
  'Interview invitation': '面试邀请',
  'Application confirmation': '申请确认',
  'Research fit and availability': '研究匹配与招生名额',
  'Informal lab chat': '非正式课题组沟通',
  'Drafted first outreach': '已起草首次联系邮件',
  'Admission offer': '录取通知',
  'trustworthy data systems and privacy-preserving analytics': '可信数据系统与隐私保护分析',
  'Secure Data Systems Lab': '安全数据系统实验室',
  'Submitted, waiting for committee screening': '已提交，等待委员会初筛',
  systems: '系统',
  privacy: '隐私',
  Europe: '欧洲',
  'Awaiting application submission': '等待提交申请',
  'Cold email drafted': '套磁邮件已起草',
  'Interview scheduled': '面试已安排',
  'Accepted with funding package': '已录取并获得资助方案',
  'Complete application draft': '完成申请草稿',
  'Revise SoP opening paragraph': '修改个人陈述开头段',
  'Confirm third recommender': '确认第三位推荐人',
  'Send one-page project brief': '发送一页项目简介',
  'Send cold email': '发送套磁邮件',
  'Upload robotics paper draft': '上传机器人论文草稿',
  'Follow up with coordinator': '跟进项目协调员',
  'Prepare interview slide outline': '准备面试幻灯片大纲',
  'Run mock interview': '进行模拟面试',
  'Compare funding package': '比较资助方案',
  'Professor suggested emphasizing prior user study experience and sending a shorter project summary.': '教授建议突出以往用户研究经验，并发送更短的项目摘要。',
  'Discussed research questions, methods, and possible RA funding route.': '讨论了研究问题、方法和可能的 RA 资助路径。',
  'Need to shorten paragraph about deployment and add link to simulation demo.': '需要缩短部署相关段落，并补充仿真演示链接。',
  'Department confirmed receipt and said review starts in July.': '院系确认已收到材料，并表示评审将于 7 月开始。',
  'Panel interview set for July 6, includes project discussion.': '小组面试定于 7 月 6 日，包含项目讨论。',
  'Offer includes RA funding and first-year coursework plan.': '录取包含 RA 资助和第一年课程安排。',
  'Short email with personal website and relevant paper.': '附上个人主页和相关论文的简短邮件。',
  'Positive response with advice on fit statement.': '收到积极回复，并给出匹配陈述建议。',
  'All required PDFs accepted by portal.': '门户已接受所有必需 PDF。',
  'Need to prepare methods discussion and failure analysis.': '需要准备方法讨论和失败分析。',
  'Need to reply by August 1.': '需要在 8 月 1 日前回复。',
  'Strong overlap with current embodied agent work.': '与当前具身智能体工作高度重合。',
}

export function localizeStaticText(value: string, lang: Language): string {
  const localized = getDict(resolveLanguage(lang))._staticText
  if (localized && typeof localized === 'object') {
    const candidate = (localized as LangDict)[value]
    if (typeof candidate === 'string' && candidate.trim()) return candidate
  }
  // Keep the original Chinese map as a compatibility fallback for callers that
  // render before the asynchronously loaded Chinese core pack is registered.
  if (resolveLanguage(lang) === 'zh') return zhStaticText[value] ?? value
  return value
}

collectKnownLanguages()
registerLanguage(defaultLanguage, fallbackEnglish as LangDict, defaultNamespace)
registerLanguage(defaultLanguage, fallbackEnglishShared as LangDict, 'shared')
registerLanguage('zh', fallbackChinese as LangDict, defaultNamespace)
registerLanguage('zh', fallbackChineseShared as LangDict, 'shared')

export const copy = {
  en: getDict(defaultLanguage),
  zh: getDict('zh'),
} as const
