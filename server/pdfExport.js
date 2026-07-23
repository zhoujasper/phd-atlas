import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import PDFDocument from 'pdfkit'

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(SERVER_DIR, '..')
const UI_I18N_ROOT = path.join(PROJECT_ROOT, 'src', 'i18n')
const SUPPORTED_LANGUAGES = new Set(['en', 'zh', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'vi', 'th'])
const LANGUAGE_LOCALES = {
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

const bundleCache = new Map()

function normalizeLanguage(language) {
  const normalized = String(language ?? '').trim().toLowerCase()
  if (SUPPORTED_LANGUAGES.has(normalized)) return normalized
  const base = normalized.split('-')[0]
  return SUPPORTED_LANGUAGES.has(base) ? base : 'en'
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

function loadBundle(language) {
  const lang = normalizeLanguage(language)
  if (bundleCache.has(lang)) return bundleCache.get(lang)
  const bundle = {}
  for (const namespace of ['core', 'shared', 'dashboard', 'workspace', 'dossier', 'settings', 'pdfExport']) {
    const filePath = path.join(UI_I18N_ROOT, lang, `${namespace}.json`)
    if (existsSync(filePath)) Object.assign(bundle, readJson(filePath))
  }
  bundleCache.set(lang, bundle)
  return bundle
}

function valueAt(source, key) {
  return key.split('.').reduce((value, part) => value && typeof value === 'object' ? value[part] : undefined, source)
}

function translator(language) {
  const lang = normalizeLanguage(language)
  const bundle = loadBundle(lang)
  const fallback = lang === 'en' ? bundle : loadBundle('en')
  const copy = valueAt(bundle, 'pdfExport') ?? valueAt(fallback, 'pdfExport') ?? {}
  return {
    lang,
    locale: LANGUAGE_LOCALES[lang] ?? lang,
    copy,
    t(key) {
      const value = valueAt(bundle, key) ?? valueAt(fallback, key)
      return typeof value === 'string' && value.trim() ? value : key
    },
  }
}

function firstExisting(paths) {
  return paths.find((candidate) => candidate && existsSync(candidate)) ?? null
}

function fontPair(language) {
  const lang = normalizeLanguage(language)
  const windowsFonts = process.env.WINDIR ? path.join(process.env.WINDIR, 'Fonts') : 'C:\\Windows\\Fonts'
  const customRegular = process.env.PHD_ATLAS_PDF_FONT
  const customBold = process.env.PHD_ATLAS_PDF_FONT_BOLD
  if (lang === 'ko') {
    const regular = firstExisting([customRegular, path.join(windowsFonts, 'malgun.ttf'), '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc'])
    const bold = firstExisting([customBold, path.join(windowsFonts, 'malgunbd.ttf'), regular])
    return { regular, bold }
  }
  if (lang === 'th') {
    const regular = firstExisting([customRegular, path.join(windowsFonts, 'LeelawUI.ttf'), path.join(windowsFonts, 'LEELAWAD.TTF'), '/usr/share/fonts/truetype/noto/NotoSansThai-Regular.ttf'])
    const bold = firstExisting([customBold, path.join(windowsFonts, 'LEELAWDB.TTF'), '/usr/share/fonts/truetype/noto/NotoSansThai-Bold.ttf', regular])
    return { regular, bold }
  }
  if (lang === 'zh' || lang === 'ja') {
    const regular = firstExisting([customRegular, path.join(windowsFonts, 'NotoSansSC-VF.ttf'), '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'])
    return { regular, bold: firstExisting([customBold, regular]) }
  }
  const regular = firstExisting([customRegular, path.join(windowsFonts, 'NotoSans-Regular.ttf'), '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf'])
  const bold = firstExisting([customBold, path.join(windowsFonts, 'NotoSans-Bold.ttf'), '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf', regular])
  return { regular, bold }
}

function registerFonts(doc, language) {
  const normalizedLanguage = normalizeLanguage(language)
  const pair = fontPair(language)
  const windowsFonts = process.env.WINDIR ? path.join(process.env.WINDIR, 'Fonts') : 'C:\\Windows\\Fonts'
  const registerOptional = (name, candidates) => {
    for (const candidate of candidates) {
      if (!candidate) continue
      const source = typeof candidate === 'string' ? { file: candidate } : candidate
      if (!source.file || !existsSync(source.file)) continue
      try {
        doc.registerFont(name, source.file, source.family)
        // PDFKit resolves registered fonts lazily. Opening it here prevents an
        // installed-but-unsupported variable font from failing halfway through
        // a download and lets us continue through the fallback candidates.
        doc.font(name)
        return name
      } catch {
        // Try the next installed font. TTC files can differ by platform/family name.
      }
    }
    return null
  }
  const pairRegular = registerOptional('AtlasRegular', [pair.regular])
  const pairBold = pair.bold === pair.regular
    ? pairRegular
    : registerOptional('AtlasBold', [pair.bold, pair.regular])
  const cjkRegular = (normalizedLanguage === 'zh' || normalizedLanguage === 'ja') && pairRegular
    ? pairRegular
    : registerOptional('AtlasCjkRegular', [
        path.join(windowsFonts, 'NotoSansSC-VF.ttf'),
        { file: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', family: 'Noto Sans CJK SC' },
      ])
  const cjkBold = registerOptional('AtlasCjkBold', [
    { file: path.join(windowsFonts, 'msyhbd.ttc'), family: 'MicrosoftYaHei-Bold' },
    { file: '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc', family: 'Noto Sans CJK SC' },
  ]) ?? cjkRegular
  const koRegular = registerOptional('AtlasKoRegular', [path.join(windowsFonts, 'malgun.ttf')])
  const koBold = registerOptional('AtlasKoBold', [path.join(windowsFonts, 'malgunbd.ttf')]) ?? koRegular
  const thaiRegular = registerOptional('AtlasThaiRegular', [
    path.join(windowsFonts, 'LeelawUI.ttf'),
    '/usr/share/fonts/truetype/noto/NotoSansThai-Regular.ttf',
  ])
  const thaiBold = registerOptional('AtlasThaiBold', [
    path.join(windowsFonts, 'LEELAWDB.TTF'),
    '/usr/share/fonts/truetype/noto/NotoSansThai-Bold.ttf',
  ]) ?? thaiRegular
  const regular = pairRegular ?? 'Helvetica'
  const bold = pairBold ?? pairRegular ?? 'Helvetica-Bold'
  return {
    regular,
    bold,
    forText(text, isBold = false) {
      const value = String(text ?? '')
      // A Chinese/Japanese report commonly contains Latin user data between
      // localized labels. Keeping the whole document on one regular/bold pair
      // avoids repeatedly shaping and subsetting the same CJK font under
      // multiple aliases during large portfolio exports.
      if (normalizedLanguage === 'zh' || normalizedLanguage === 'ja') {
        return isBold ? (cjkBold ?? bold) : (cjkRegular ?? regular)
      }
      if (/[\u0E00-\u0E7F]/u.test(value) && thaiRegular) return isBold ? thaiBold : thaiRegular
      if (/[\uAC00-\uD7AF\u1100-\u11FF]/u.test(value) && koRegular) return isBold ? koBold : koRegular
      if (/[\u3040-\u30FF\u3400-\u9FFF\uF900-\uFAFF]/u.test(value) && cjkRegular) return isBold ? cjkBold : cjkRegular
      return isBold ? bold : regular
    },
  }
}

function exportText(value, yes, no) {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'boolean') return value ? yes : no
  if (Array.isArray(value)) return value.map((item) => exportText(item, yes, no)).filter(Boolean).join('; ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function fileSizeLabel(size, locale) {
  const bytes = Number(size)
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
  if (bytes < 1024) return `${number.format(bytes)} B`
  if (bytes < 1024 * 1024) return `${number.format(bytes / 1024)} KB`
  return `${number.format(bytes / 1024 / 1024)} MB`
}

function isDateLike(value) {
  return /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(String(value ?? ''))
}

function formatDate(value, locale, withTime = false) {
  if (!value || !isDateLike(value)) return exportText(value, '', '')
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat(locale, withTime || String(value).includes('T')
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' }).format(date)
}

function formatStatus(status, tr) {
  return tr.t(`status.${status}`)
}

function nonEmptyRows(rows, tr) {
  return rows
    .map(([label, value, options]) => [label, exportText(value, tr.copy.yes, tr.copy.no), options])
    .filter(([, value]) => value !== '')
}

function countUpcomingDeadlines(applications, days = 30) {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start.getTime() + days * 86400000)
  return applications.reduce((count, application) => {
    const values = [
      application.deadline,
      application.nextReminder,
      ...(application.materials ?? []).map((item) => item.reminderDate),
      ...(application.tasks ?? []).map((item) => item.due),
      ...(application.scholarships ?? []).flatMap((item) => [item.startDate, item.endDate]),
    ]
    return count + values.filter((value) => {
      if (!value) return false
      const date = new Date(value)
      return !Number.isNaN(date.getTime()) && date >= start && date <= end
    }).length
  }, 0)
}

export function resolvePdfLanguage(language) {
  return normalizeLanguage(language)
}

export function pdfCopyForLanguage(language) {
  const tr = translator(language)
  return { language: tr.lang, locale: tr.locale, ...tr.copy }
}

export function toPdfBuffer(applications, { scope = 'all', language = 'en' } = {}) {
  return new Promise((resolve, reject) => {
    const tr = translator(language)
    const docTitle = scope === 'current' ? tr.copy.currentTitle : tr.copy.portfolioTitle
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 58, right: 52, bottom: 58, left: 52 },
      info: { Title: `PhD Atlas - ${docTitle}`, Author: 'PhD Atlas', Subject: tr.copy.snapshot },
    })
    const chunks = []
    const fonts = registerFonts(doc, tr.lang)
    const colors = {
      ink: '#1d1d1f', secondary: '#5f6066', muted: '#8a8b91', line: '#e4e5e9',
      soft: '#f5f6f8', accent: '#0071e3', accentSoft: '#eaf4ff', success: '#197a45',
    }
    const pageWidth = doc.page.width
    const pageHeight = doc.page.height
    const margin = doc.page.margins.left
    const contentWidth = pageWidth - doc.page.margins.left - doc.page.margins.right
    const contentBottom = () => doc.page.height - doc.page.margins.bottom

    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    function regular(size = 9, color = colors.ink, text = '') {
      doc.font(fonts.forText(text, false)).fontSize(size).fillColor(color)
      return doc
    }

    function bold(size = 9, color = colors.ink, text = '') {
      doc.font(fonts.forText(text, true)).fontSize(size).fillColor(color)
      return doc
    }

    let pageNumber = 1

    function drawPageFurniture(number, isCover = false) {
      const previousX = doc.x
      const previousY = doc.y
      if (!isCover) {
        bold(7.5, colors.muted, 'PHD ATLAS').text('PHD ATLAS', margin, 28, { width: contentWidth / 2, characterSpacing: 0.75, lineBreak: false })
        regular(7.5, colors.muted, docTitle).text(docTitle, margin + contentWidth / 2, 28, { width: contentWidth / 2, align: 'right', lineBreak: false, ellipsis: true })
        doc.save().moveTo(margin, 44).lineTo(margin + contentWidth, 44).lineWidth(0.45).strokeColor(colors.line).stroke().restore()
      }
      const footerY = pageHeight - 34
      const previousBottomMargin = doc.page.margins.bottom
      doc.page.margins.bottom = 0
      regular(7.3, colors.muted, tr.copy.snapshot).text(tr.copy.snapshot, margin, footerY, { width: contentWidth * 0.65, lineBreak: false, ellipsis: true })
      const footerLabel = tr.copy.pageNumber.replace('{page}', String(number))
      regular(7.3, colors.muted, footerLabel).text(footerLabel, margin + contentWidth * 0.65, footerY, { width: contentWidth * 0.35, align: 'right', lineBreak: false })
      doc.page.margins.bottom = previousBottomMargin
      doc.x = previousX
      doc.y = previousY
    }

    drawPageFurniture(pageNumber, true)
    doc.on('pageAdded', () => {
      pageNumber += 1
      drawPageFurniture(pageNumber)
      doc.y = doc.page.margins.top
    })

    function addPage() {
      doc.addPage()
      doc.y = doc.page.margins.top
    }

    function ensureSpace(height, afterPage = 0) {
      if (doc.y + height <= contentBottom()) return false
      addPage()
      if (afterPage) doc.y += afterPage
      return true
    }

    function rule(y = doc.y, color = colors.line, width = 0.7) {
      doc.save().moveTo(margin, y).lineTo(margin + contentWidth, y).lineWidth(width).strokeColor(color).stroke().restore()
    }

    function drawSectionTitle(title, count = null) {
      ensureSpace(64)
      const y = doc.y
      bold(10.5, colors.ink, title).text(String(title), margin, y, { width: contentWidth - 80, lineBreak: false })
      if (count !== null) {
        const countLabel = new Intl.NumberFormat(tr.locale).format(count)
        bold(8, colors.accent, countLabel).text(countLabel, margin + contentWidth - 60, y + 1, { width: 60, align: 'right', lineBreak: false })
      }
      rule(y + 20)
      doc.y = y + 30
    }

    function drawDefinitionGrid(title, rows) {
      const visibleRows = nonEmptyRows(rows, tr)
      if (!visibleRows.length) return
      drawSectionTitle(title)
      const gap = 24
      const cellWidth = (contentWidth - gap) / 2
      for (let index = 0; index < visibleRows.length; index += 2) {
        const pair = visibleRows.slice(index, index + 2)
        const heights = pair.map(([_label, value, options]) => {
          const valueHeight = regular(9.3, colors.ink, value).heightOfString(value, { width: options?.wide ? contentWidth : cellWidth, lineGap: 2 })
          return 16 + valueHeight
        })
        const rowHeight = Math.max(34, ...heights) + 10
        const continuedOnNewPage = ensureSpace(rowHeight)
        if (continuedOnNewPage) drawSectionTitle(title)
        const y = doc.y
        pair.forEach(([label, value], pairIndex) => {
          const x = margin + pairIndex * (cellWidth + gap)
          bold(7.1, colors.muted, label).text(String(label).toUpperCase(), x, y, { width: cellWidth, characterSpacing: 0.35, lineBreak: false })
          regular(9.3, colors.ink, value).text(value, x, y + 14, { width: cellWidth, lineGap: 2 })
        })
        if (pair.length === 2) {
          doc.save().moveTo(margin + cellWidth + gap / 2, y).lineTo(margin + cellWidth + gap / 2, y + rowHeight - 10).lineWidth(0.5).strokeColor(colors.line).stroke().restore()
        }
        rule(y + rowHeight - 2, colors.line, 0.45)
        doc.y = y + rowHeight + 4
      }
      doc.y += 8
    }

    function drawNarrativeRow(label, value) {
      const text = exportText(value, tr.copy.yes, tr.copy.no)
      if (!text) return
      const textHeight = regular(9.4, colors.ink, text).heightOfString(text, { width: contentWidth, lineGap: 3 })
      ensureSpace(textHeight + 32)
      const y = doc.y
      bold(7.1, colors.muted, label).text(String(label).toUpperCase(), margin, y, { width: contentWidth, characterSpacing: 0.35, lineBreak: false })
      regular(9.4, colors.ink, text).text(text, margin, y + 14, { width: contentWidth, lineGap: 3 })
      doc.y += 8
      rule(doc.y, colors.line, 0.45)
      doc.y += 10
    }

    function collectionHeading(item, fallback, keys) {
      for (const key of keys) {
        const value = exportText(item?.[key], tr.copy.yes, tr.copy.no)
        if (value) return value
      }
      return fallback
    }

    function drawCollection(title, items, rowBuilder, emptyLabel, headingKeys = ['name', 'title', 'subject']) {
      drawSectionTitle(title, items.length)
      if (!items.length) {
        const emptyText = emptyLabel || tr.copy.noRecords
        regular(9, colors.muted, emptyText).text(emptyText, margin, doc.y, { width: contentWidth })
        doc.y += 28
        return
      }
      items.forEach((item, index) => {
        const rows = nonEmptyRows(rowBuilder(item, index), tr)
        ensureSpace(46)
        const itemHeading = collectionHeading(item, `${title} ${index + 1}`, headingKeys)
        const itemIndex = String(index + 1).padStart(2, '0')
        const drawItemHeading = () => {
          const headingY = doc.y
          bold(10.2, colors.ink, itemHeading).text(itemHeading, margin, headingY, { width: contentWidth - 56 })
          bold(7.4, colors.muted, itemIndex).text(itemIndex, margin + contentWidth - 42, headingY + 1, { width: 42, align: 'right', lineBreak: false })
          doc.y = Math.max(doc.y, headingY + 23)
        }
        drawItemHeading()
        for (const [label, value] of rows) {
          const labelWidth = 116
          const valueWidth = contentWidth - labelWidth
          const height = Math.max(21, regular(8.9, colors.ink, value).heightOfString(value, { width: valueWidth, lineGap: 2 }) + 7)
          if (ensureSpace(height + 30)) drawItemHeading()
          const rowY = doc.y
          bold(7, colors.muted, label).text(String(label).toUpperCase(), margin, rowY + 1, { width: labelWidth - 12, characterSpacing: 0.25 })
          regular(8.9, colors.ink, value).text(value, margin + labelWidth, rowY, { width: valueWidth, lineGap: 2 })
          doc.y = Math.max(doc.y, rowY + height)
        }
        rule(doc.y + 4, colors.line, 0.55)
        doc.y += 16
      })
      doc.y += 4
    }

    function drawStatusPill(label, y) {
      bold(8, colors.accent, label)
      const width = Math.min(124, Math.max(52, doc.widthOfString(label) + 20))
      const x = margin + contentWidth - width
      doc.save().roundedRect(x, y, width, 22, 11).fill(colors.accentSoft).restore()
      bold(8, colors.accent, label).text(label, x + 10, y + 6, { width: width - 20, align: 'center', lineBreak: false, ellipsis: true })
    }

    function drawApplicationHero(application, index) {
      ensureSpace(126)
      if (index > 0) {
        doc.y += 4
        rule(doc.y, colors.ink, 1.1)
        doc.y += 24
      }
      const y = doc.y
      const chapterIndex = String(index + 1).padStart(2, '0')
      bold(34, colors.line, chapterIndex).text(chapterIndex, margin, y - 5, { width: 62, lineBreak: false })
      const titleX = margin + 72
      const schoolName = exportText(application.school?.name, tr.copy.yes, tr.copy.no) || tr.copy.noRecords
      const programName = exportText(application.program, tr.copy.yes, tr.copy.no)
      const titleWidth = contentWidth - 210
      const titleHeight = bold(17, colors.ink, schoolName).heightOfString(schoolName, { width: titleWidth, lineGap: 1 })
      bold(17, colors.ink, schoolName).text(schoolName, titleX, y, { width: titleWidth, lineGap: 1 })
      const programY = y + titleHeight + 5
      const programHeight = regular(9.4, colors.secondary, programName).heightOfString(programName, { width: contentWidth - 96, lineGap: 1 })
      regular(9.4, colors.secondary, programName).text(programName, titleX, programY, { width: contentWidth - 96, lineGap: 1 })
      drawStatusPill(formatStatus(application.status, tr), y)
      const metaY = Math.max(programY + programHeight + 18, y + 67)
      const meta = [
        [tr.t('dossier.deadline'), formatDate(application.deadline, tr.locale)],
        [tr.t('dossier.professor'), application.professor?.english || application.professor?.chinese],
        [tr.t('dossier.country'), application.school?.country],
      ]
      const metaWidth = (contentWidth - 32) / 3
      meta.forEach(([label, value], metaIndex) => {
        const x = margin + metaIndex * (metaWidth + 16)
        const metaValue = exportText(value, tr.copy.yes, tr.copy.no) || '-'
        bold(7, colors.muted, label).text(String(label).toUpperCase(), x, metaY, { width: metaWidth, characterSpacing: 0.3, lineBreak: false })
        regular(9.1, colors.ink, metaValue).text(metaValue, x, metaY + 14, { width: metaWidth, ellipsis: true, lineBreak: false })
      })
      const progressY = metaY + 39
      doc.save().roundedRect(margin, progressY, contentWidth - 52, 5, 2.5).fill(colors.line).restore()
      const progressWidth = Math.max(4, Math.min(contentWidth - 52, (contentWidth - 52) * Number(application.progress ?? 0) / 100))
      doc.save().roundedRect(margin, progressY, progressWidth, 5, 2.5).fill(colors.accent).restore()
      const progressLabel = `${new Intl.NumberFormat(tr.locale).format(Number(application.progress ?? 0))}%`
      bold(8.5, colors.ink, progressLabel).text(progressLabel, margin + contentWidth - 44, progressY - 3, { width: 44, align: 'right', lineBreak: false })
      doc.y = progressY + 28
    }

    function drawCover() {
      const generatedAt = new Intl.DateTimeFormat(tr.locale, { dateStyle: 'long', timeStyle: 'short' }).format(new Date())
      bold(9, colors.accent, 'PHD ATLAS').text('PHD ATLAS', margin, doc.y, { characterSpacing: 1.35, lineBreak: false })
      doc.y += 27
      bold(28, colors.ink, docTitle).text(docTitle, margin, doc.y, { width: contentWidth, lineGap: 2 })
      doc.y += 7
      regular(10, colors.secondary, tr.copy.snapshot).text(tr.copy.snapshot, margin, doc.y, { width: contentWidth })
      doc.y += 20
      rule(doc.y, colors.accent, 1.6)
      doc.y += 12
      const generatedLabel = `${tr.copy.generated}: ${generatedAt}`
      regular(8.2, colors.muted, generatedLabel).text(generatedLabel, margin, doc.y, { width: contentWidth })
      doc.y += 27

      const finalStatuses = new Set(['Accepted', 'Rejected'])
      const activeApplications = applications.filter((application) => !finalStatuses.has(application.status))
      const openTasks = applications.reduce((sum, application) => sum + (application.tasks ?? []).filter((task) => !task.done).length, 0)
      const checklistTotal = applications.reduce((sum, application) => sum + (application.materials ?? []).length, 0)
      const checklistDone = applications.reduce((sum, application) => sum + (application.materials ?? []).filter((item) => item.status === 'Submitted' || item.status === 'Ready' || item.done).length, 0)
      const upcoming = countUpcomingDeadlines(applications)
      const metrics = scope === 'current' && applications[0]
        ? [
            [applications[0].progress ?? 0, tr.t('dossier.progress'), '%'],
            [`${checklistDone}/${checklistTotal}`, tr.t('dossier.tabs.materials'), ''],
            [openTasks, tr.t('dashboard.openTasks'), ''],
            [upcoming, tr.t('dashboard.ddlApproaching'), ''],
          ]
        : [
            [applications.length, tr.t('dashboard.totalApps'), ''],
            [openTasks, tr.t('dashboard.openTasks'), ''],
            [upcoming, tr.t('dashboard.ddlApproaching'), ''],
            [activeApplications.length, tr.copy.active, ''],
          ]
      const bandY = doc.y
      const metricWidth = contentWidth / metrics.length
      doc.save().roundedRect(margin, bandY, contentWidth, 68, 10).fill(colors.soft).restore()
      metrics.forEach(([value, label, suffix], index) => {
        const x = margin + index * metricWidth
        if (index > 0) {
          doc.save().moveTo(x, bandY + 14).lineTo(x, bandY + 54).lineWidth(0.55).strokeColor(colors.line).stroke().restore()
        }
        const formattedValue = typeof value === 'number' ? new Intl.NumberFormat(tr.locale).format(value) : String(value)
        const metricValue = `${formattedValue}${suffix}`
        bold(17, colors.ink, metricValue).text(metricValue, x + 14, bandY + 13, { width: metricWidth - 28, align: 'left', lineBreak: false })
        regular(7.4, colors.muted, label).text(String(label).toUpperCase(), x + 14, bandY + 42, { width: metricWidth - 28, characterSpacing: 0.25, lineBreak: false, ellipsis: true })
      })
      doc.y = bandY + 96
    }

    drawCover()
    if (!applications.length) {
      drawSectionTitle(tr.t('workspace.title'), 0)
      regular(10, colors.muted, tr.copy.noRecords).text(tr.copy.noRecords, margin, doc.y, { width: contentWidth })
    }

    for (const [index, application] of applications.entries()) {
      drawApplicationHero(application, index)
      drawDefinitionGrid(tr.t('dossier.tabs.dossier'), [
        [tr.copy.applicationId, application.id],
        [tr.t('dossier.schoolName'), application.school?.name],
        [tr.t('dossier.country'), application.school?.country],
        [tr.t('dossier.schoolWebsite'), application.school?.website],
        [tr.t('dossier.program'), application.program],
        [tr.t('dossier.deadline'), formatDate(application.deadline, tr.locale)],
        [tr.t('dossier.status'), formatStatus(application.status, tr)],
        [tr.t('dossier.progress'), `${application.progress}%`],
        [tr.t('dossier.priority'), application.priority],
        [tr.t('dossier.tags'), application.tags],
        [tr.t('dossier.nextReminder'), formatDate(application.nextReminder, tr.locale)],
        [tr.copy.createdAt, formatDate(application.createdAt, tr.locale, true)],
        [tr.copy.updatedAt, formatDate(application.updatedAt, tr.locale, true)],
      ])
      drawNarrativeRow(tr.copy.result, application.result)
      drawDefinitionGrid(tr.t('dossier.professor'), [
        [tr.t('dossier.englishName'), application.professor?.english],
        [tr.t('dossier.chineseName'), application.professor?.chinese],
        [tr.t('dossier.email'), application.professor?.email],
        [tr.t('dossier.phone'), application.professor?.phone],
        [tr.t('dossier.social'), application.professor?.social],
        [tr.t('dossier.homepage'), application.professor?.homepage],
        [tr.t('dossier.lab'), application.professor?.lab],
      ])
      drawNarrativeRow(tr.t('dossier.researchDirection'), application.professor?.research)
      drawDefinitionGrid(tr.copy.backup, [
        [tr.t('settings.autoBackup'), application.backupSettings?.autoBackup ? tr.copy.yes : tr.copy.no],
        [tr.t('settings.backupFrequency'), application.backupSettings?.frequency],
        [tr.copy.maxBackups, application.backupSettings?.maxBackups],
        [tr.copy.lastBackup, formatDate(application.backupSettings?.lastAutoBackupAt, tr.locale, true)],
      ])
      drawCollection(tr.t('dossier.tabs.materials'), application.materials ?? [], (material) => [
        [tr.t('dossier.materialType'), material.type],
        [tr.t('dossier.status'), formatStatus(material.status, tr)],
        [tr.t('dossier.group'), material.group],
        [tr.t('dossier.details'), material.details],
        [tr.t('dossier.reminder'), material.reminderEnabled ? formatDate(material.reminderDate, tr.locale) || tr.copy.noDate : tr.copy.no],
        [tr.copy.requiredCount, material.requiredCount],
        [tr.copy.currentFile, [material.fileName, fileSizeLabel(material.fileSize, tr.locale)].filter(Boolean).join(' | ')],
        [tr.copy.versionHistory, (material.versions ?? []).map((version) => `${version.file} - ${version.author} - ${formatDate(version.createdAt, tr.locale, true)}`).join('; ')],
        [tr.t('dossier.recommenders'), (material.recommenders ?? []).map((item) => `${item.name} <${item.contact}>`).join('; ')],
      ], tr.t('dossier.noMaterials'), ['name'])
      drawCollection(tr.t('dossier.tabs.mail'), application.communications ?? [], (communication) => [
        [tr.t('dossier.status'), communication.messageType || communication.channel],
        [tr.t('dossier.eventDate'), [formatDate(communication.date, tr.locale), communication.time].filter(Boolean).join(' ')],
        [tr.copy.direction, communication.direction ? tr.t(`dossier.direction.${communication.direction}`) : ''],
        [tr.copy.fromTo, [communication.from, communication.to].filter(Boolean).join(' -> ')],
        [tr.copy.summary, communication.summary],
      ], tr.t('dossier.noCommunications'), ['subject', 'summary'])
      drawCollection(tr.t('dossier.tabs.funding'), application.scholarships ?? [], (scholarship) => [
        [tr.t('fees.amount'), scholarship.amount],
        [tr.copy.startDate, formatDate(scholarship.startDate, tr.locale)],
        [tr.copy.endDate, formatDate(scholarship.endDate, tr.locale)],
      ], tr.t('dossier.noScholarships'), ['name'])
      drawCollection(tr.t('dossier.tasks'), application.tasks ?? [], (task) => [
        [tr.copy.due, formatDate(task.due, tr.locale)],
        [tr.t('dossier.done'), task.done ? tr.copy.yes : tr.copy.no],
        [tr.t('dossier.details'), task.details],
      ], tr.t('dossier.noTasksHint'), ['title'])
      drawCollection(tr.t('dossier.timeline'), application.timeline ?? [], (event) => [
        [tr.t('dossier.eventDate'), formatDate(event.date, tr.locale)],
        [tr.t('dossier.eventNote'), event.note],
      ], tr.t('dossier.noTimeline'), ['title'])
      drawCollection(tr.t('settings.sharedLinks'), application.shares ?? [], (share) => [
        [tr.copy.applicationId, share.id],
        [tr.copy.token, share.token],
        [tr.copy.url, share.url],
        [tr.copy.createdExpires, `${formatDate(share.createdAt, tr.locale, true)} / ${share.expiresAt ? formatDate(share.expiresAt, tr.locale, true) : tr.copy.never}`],
      ], tr.t('settings.noSharedLinks'), ['url', 'id'])
    }

    doc.end()
  })
}
