import { existsSync } from 'node:fs'
import path from 'node:path'
import PDFDocument from 'pdfkit'
import { collectReadableToBoundedBuffer } from './boundedBufferCollector.js'
import { SUPPORTED_EXPORT_LANGUAGES as SUPPORTED_LANGUAGES } from './sharedConstants.js'


const WORD_LANGUAGE_TAGS = {
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

const COLORS = {
  ink: '#1d1d1f',
  muted: '#85868c',
  line: '#e1e3e7',
  accent: '#0071e3',
}

const NULL_CHARACTER = String.fromCharCode(0)

export const PROFILE_ASSET_EXPORT_LIMITS = Object.freeze({
  sourceBytes: 4 * 1024 * 1024,
  outputBytes: 12 * 1024 * 1024,
  lines: 20_000,
  blocks: 5_000,
  listItems: 10_000,
  customFields: 256,
  customFieldCandidates: 512,
  pages: 500,
  workUnits: 50_000,
  nameBytes: 4 * 1024,
  kindBytes: 1024,
  blockBytes: 64 * 1024,
  listItemBytes: 16 * 1024,
  customFieldBytes: 64 * 1024,
})

export class ProfileAssetExportLimitError extends Error {
  constructor(reason = 'output') {
    super('This profile document is too large or complex to export safely as one file.')
    this.name = 'ProfileAssetExportLimitError'
    this.code = 'PROFILE_ASSET_EXPORT_TOO_LARGE'
    this.status = 413
    this.reason = reason
  }
}

function exportLimit(reason) {
  return new ProfileAssetExportLimitError(reason)
}

function createExportBudget() {
  return {
    sourceBytes: 0,
    blocks: 0,
    listItems: 0,
    pages: 1,
    workUnits: 0,
    addSource(value, reason = 'source', fieldLimit = PROFILE_ASSET_EXPORT_LIMITS.sourceBytes) {
      const bytes = Buffer.byteLength(String(value ?? ''), 'utf8')
      if (bytes > fieldLimit) throw exportLimit(reason)
      this.sourceBytes += bytes
      if (this.sourceBytes > PROFILE_ASSET_EXPORT_LIMITS.sourceBytes) throw exportLimit('source')
    },
    consumeWork(units = 1) {
      this.workUnits += Math.max(1, Math.ceil(Number(units) || 1))
      if (this.workUnits > PROFILE_ASSET_EXPORT_LIMITS.workUnits) throw exportLimit('work')
    },
    addBlock() {
      this.blocks += 1
      if (this.blocks > PROFILE_ASSET_EXPORT_LIMITS.blocks) throw exportLimit('blocks')
      this.consumeWork()
    },
    assertText(value, reason, maxBytes) {
      const bytes = Buffer.byteLength(String(value ?? ''), 'utf8')
      if (bytes > maxBytes) throw exportLimit(reason)
      this.consumeWork(Math.ceil(bytes / 256))
    },
    addListItem() {
      this.listItems += 1
      if (this.listItems > PROFILE_ASSET_EXPORT_LIMITS.listItems) throw exportLimit('listItems')
      this.consumeWork()
    },
    addPage() {
      this.pages += 1
      if (this.pages > PROFILE_ASSET_EXPORT_LIMITS.pages) throw exportLimit('pages')
      this.consumeWork(4)
    },
  }
}

function normalizeLanguage(language) {
  const normalized = String(language ?? '')
    .trim()
    .toLowerCase()
  if (SUPPORTED_LANGUAGES.has(normalized)) return normalized
  const base = normalized.split('-')[0]
  return SUPPORTED_LANGUAGES.has(base) ? base : 'en'
}

function textValue(value) {
  if (typeof value === 'string') return value.replaceAll(NULL_CHARACTER, '').trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function stripInlineMarkdown(value) {
  return textValue(value)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1')
    .replace(/(?<!_)_([^_]+)_(?!_)/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\\([\\`*_{}[\]()#+\-.!>])/g, '$1')
    .trim()
}

function parseMarkdown(value, budget) {
  const source = textValue(value).replace(/\r\n?/g, '\n')
  let lineCount = 1
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) lineCount += 1
    if (lineCount > PROFILE_ASSET_EXPORT_LIMITS.lines) throw exportLimit('lines')
  }
  budget.consumeWork(lineCount + Math.ceil(source.length / 512))
  const lines = source.split('\n')
  const blocks = []
  let paragraph = []
  let paragraphBytes = 0
  let list = null
  let inFence = false

  const pushParagraphLine = (value) => {
    const text = String(value ?? '')
    const bytes = Buffer.byteLength(text, 'utf8') + (paragraph.length ? 1 : 0)
    if (paragraphBytes + bytes > PROFILE_ASSET_EXPORT_LIMITS.blockBytes) throw exportLimit('block')
    paragraph.push(text)
    paragraphBytes += bytes
  }

  const flushParagraph = () => {
    const text = stripInlineMarkdown(paragraph.join(' '))
    if (text) {
      budget.assertText(text, 'block', PROFILE_ASSET_EXPORT_LIMITS.blockBytes)
      budget.addBlock()
      blocks.push({ type: 'paragraph', text })
    }
    paragraph = []
    paragraphBytes = 0
  }

  const flushList = () => {
    if (list?.items.length) {
      budget.addBlock()
      blocks.push(list)
    }
    list = null
  }

  for (const sourceLine of lines) {
    const line = sourceLine.trimEnd()
    if (/^\s*```/.test(line)) {
      flushParagraph()
      flushList()
      inFence = !inFence
      continue
    }
    if (inFence) {
      pushParagraphLine(line.trim())
      continue
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.+)$/)
    if (heading) {
      flushParagraph()
      flushList()
      if (Buffer.byteLength(heading[2], 'utf8') > PROFILE_ASSET_EXPORT_LIMITS.blockBytes) {
        throw exportLimit('block')
      }
      const text = stripInlineMarkdown(heading[2])
      if (text) {
        budget.assertText(text, 'block', PROFILE_ASSET_EXPORT_LIMITS.blockBytes)
        budget.addBlock()
        blocks.push({ type: 'heading', level: heading[1].length, text })
      }
      continue
    }

    const unordered = line.match(/^\s*[-+*]\s+(.+)$/)
    const ordered = line.match(/^\s*(\d+)[.)]\s+(.+)$/)
    if (unordered || ordered) {
      flushParagraph()
      const orderedList = Boolean(ordered)
      if (list && list.ordered !== orderedList) flushList()
      list ??= { type: 'list', ordered: orderedList, items: [] }
      const rawItem = (ordered ?? unordered)[orderedList ? 2 : 1]
      if (Buffer.byteLength(rawItem, 'utf8') > PROFILE_ASSET_EXPORT_LIMITS.listItemBytes) {
        throw exportLimit('listItem')
      }
      const item = stripInlineMarkdown(rawItem)
      if (item) {
        budget.assertText(item, 'listItem', PROFILE_ASSET_EXPORT_LIMITS.listItemBytes)
        budget.addListItem()
        list.items.push(item)
      }
      continue
    }

    if (!line.trim()) {
      flushParagraph()
      flushList()
      continue
    }

    flushList()
    pushParagraphLine(line.replace(/^\s*>\s?/, '').trim())
  }

  flushParagraph()
  flushList()
  return blocks
}

function exportableCustomFields(asset, budget) {
  const fields = asset?.writingBrief?.customFields
  if (!Array.isArray(fields)) return []
  if (fields.length > PROFILE_ASSET_EXPORT_LIMITS.customFieldCandidates) throw exportLimit('customFields')
  const exported = []
  for (const field of fields) {
    budget.consumeWork()
    if (!field || field.includeInExport !== true) continue
    if (exported.length >= PROFILE_ASSET_EXPORT_LIMITS.customFields) throw exportLimit('customFields')
    budget.addSource(field.label, 'customField', PROFILE_ASSET_EXPORT_LIMITS.customFieldBytes)
    budget.addSource(field.value, 'customField', PROFILE_ASSET_EXPORT_LIMITS.customFieldBytes)
    const label = textValue(field.label)
    const value = textValue(field.value)
    if (label && value) {
      exported.push({
        label,
        value,
        placement: field.placement === 'afterBody' ? 'afterBody' : 'beforeBody',
      })
    }
  }
  return exported
}

function firstExisting(candidates) {
  return candidates.find((candidate) => candidate?.file && existsSync(candidate.file)) ?? null
}

function registerFont(doc, name, candidates) {
  for (const candidate of candidates) {
    if (!candidate?.file || !existsSync(candidate.file)) continue
    try {
      doc.registerFont(name, candidate.file, candidate.family)
      doc.font(name)
      return name
    } catch {
      // Installed variable fonts and TTC family names differ across platforms.
    }
  }
  return null
}

function createFontResolver(doc, language) {
  const windowsFonts = process.env.WINDIR ? path.join(process.env.WINDIR, 'Fonts') : 'C:\\Windows\\Fonts'
  const customRegular = process.env.PHD_ATLAS_PDF_FONT
  const customBold = process.env.PHD_ATLAS_PDF_FONT_BOLD
  const normalizedLanguage = normalizeLanguage(language)
  let latinRegular
  let latinBold
  let cjkRegular
  let cjkBold
  let koreanRegular
  let koreanBold
  let thaiRegular
  let thaiBold

  const resolveLatin = (isBold) => {
    if (latinRegular === undefined) {
      const regularCandidate = firstExisting([
        customRegular ? { file: customRegular } : null,
        { file: path.join(windowsFonts, 'NotoSans-Regular.ttf') },
        { file: '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf' },
      ])
      latinRegular = registerFont(doc, 'ProfileRegular', [regularCandidate]) ?? null
    }
    if (isBold && latinBold === undefined) {
      const boldCandidate = firstExisting([
        customBold ? { file: customBold } : null,
        { file: path.join(windowsFonts, 'NotoSans-Bold.ttf') },
        { file: '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf' },
      ])
      latinBold = registerFont(doc, 'ProfileBold', [boldCandidate]) ?? latinRegular
    }
    return isBold
      ? (latinBold ?? (latinRegular ? latinRegular : 'Helvetica-Bold'))
      : (latinRegular ?? 'Helvetica')
  }

  const resolveCjk = (isBold) => {
    if (cjkRegular === undefined) {
      cjkRegular = registerFont(doc, 'ProfileCjkRegular', [
        { file: path.join(windowsFonts, 'NotoSansSC-VF.ttf') },
        { file: path.join(windowsFonts, 'msyh.ttc'), family: 'Microsoft YaHei' },
        { file: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', family: 'Noto Sans CJK SC' },
      ]) ?? null
    }
    if (isBold && cjkBold === undefined) {
      cjkBold = registerFont(doc, 'ProfileCjkBold', [
        { file: path.join(windowsFonts, 'msyhbd.ttc'), family: 'MicrosoftYaHei-Bold' },
        { file: '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc', family: 'Noto Sans CJK SC' },
      ]) ?? cjkRegular
    }
    return isBold ? (cjkBold ?? cjkRegular ?? resolveLatin(true)) : (cjkRegular ?? resolveLatin(false))
  }

  const resolveKorean = (isBold) => {
    if (koreanRegular === undefined) {
      koreanRegular = registerFont(doc, 'ProfileKoreanRegular', [
        { file: path.join(windowsFonts, 'malgun.ttf') },
        { file: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', family: 'Noto Sans CJK KR' },
      ]) ?? null
    }
    if (isBold && koreanBold === undefined) {
      koreanBold = registerFont(doc, 'ProfileKoreanBold', [
        { file: path.join(windowsFonts, 'malgunbd.ttf') },
        { file: '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc', family: 'Noto Sans CJK KR' },
      ]) ?? koreanRegular
    }
    return isBold
      ? (koreanBold ?? koreanRegular ?? resolveLatin(true))
      : (koreanRegular ?? resolveLatin(false))
  }

  const resolveThai = (isBold) => {
    if (thaiRegular === undefined) {
      thaiRegular = registerFont(doc, 'ProfileThaiRegular', [
        { file: path.join(windowsFonts, 'LeelawUI.ttf') },
        { file: '/usr/share/fonts/truetype/noto/NotoSansThai-Regular.ttf' },
      ]) ?? null
    }
    if (isBold && thaiBold === undefined) {
      thaiBold = registerFont(doc, 'ProfileThaiBold', [
        { file: path.join(windowsFonts, 'LEELAWDB.TTF') },
        { file: '/usr/share/fonts/truetype/noto/NotoSansThai-Bold.ttf' },
      ]) ?? thaiRegular
    }
    return isBold ? (thaiBold ?? thaiRegular ?? resolveLatin(true)) : (thaiRegular ?? resolveLatin(false))
  }

  return {
    forText(value, isBold = false) {
      const text = String(value ?? '')
      if (normalizedLanguage === 'zh' || normalizedLanguage === 'ja' || /[぀-ヿ㐀-鿿豈-﫿]/u.test(text)) {
        return resolveCjk(isBold)
      }
      if (/[฀-๿]/u.test(text)) return resolveThai(isBold)
      if (/[가-힯ᄀ-ᇿ]/u.test(text)) return resolveKorean(isBold)
      if (customRegular || /[Ā-ԯ]/u.test(text)) return resolveLatin(isBold)
      return isBold ? 'Helvetica-Bold' : 'Helvetica'
    },
  }
}

function normalizedAsset(asset) {
  const budget = createExportBudget()
  budget.addSource(asset?.name, 'name', PROFILE_ASSET_EXPORT_LIMITS.nameBytes)
  budget.addSource(asset?.kind, 'kind', PROFILE_ASSET_EXPORT_LIMITS.kindBytes)
  budget.addSource(asset?.description, 'source')
  return {
    name: textValue(asset?.name) || 'Untitled material',
    kind: textValue(asset?.kind) || 'Document',
    blocks: parseMarkdown(asset?.description, budget),
    customFields: exportableCustomFields(asset, budget),
    budget,
  }
}

export function toProfileAssetPdfBuffer(asset, {
  language = 'en',
  maxOutputBytes = PROFILE_ASSET_EXPORT_LIMITS.outputBytes,
} = {}) {
  return new Promise((resolve, reject) => {
    const material = normalizedAsset(asset)
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 66, right: 56, bottom: 62, left: 56 },
      info: {
        Title: material.name,
        Author: 'PhD Atlas',
        Subject: material.kind,
      },
    })
    const outputLimit = Math.min(
      PROFILE_ASSET_EXPORT_LIMITS.outputBytes,
      Math.max(1024, Number(maxOutputBytes) || PROFILE_ASSET_EXPORT_LIMITS.outputBytes),
    )
    collectReadableToBoundedBuffer(doc, {
      maxBytes: outputLimit,
      createOverflowError: () => exportLimit('output'),
    }).then(resolve, reject)
    try {
    const fonts = createFontResolver(doc, language)
    const margin = doc.page.margins.left
    const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right
    const contentBottom = () => doc.page.height - doc.page.margins.bottom
    let pageNumber = 1

    const setFont = (value, size, color = COLORS.ink, bold = false) => {
      doc.font(fonts.forText(value, bold)).fontSize(size).fillColor(color)
      return doc
    }

    const drawPageFurniture = () => {
      const previousX = doc.x
      const previousY = doc.y
      const previousBottomMargin = doc.page.margins.bottom
      doc.page.margins.bottom = 0
      setFont('PHD ATLAS', 7.4, COLORS.muted, true).text('PHD ATLAS', margin, 29, {
        width: contentWidth / 2,
        characterSpacing: 0.8,
        lineBreak: false,
      })
      setFont(material.kind, 7.4, COLORS.muted).text(material.kind, margin + contentWidth / 2, 29, {
        width: contentWidth / 2,
        align: 'right',
        ellipsis: true,
        lineBreak: false,
      })
      doc
        .save()
        .moveTo(margin, 45)
        .lineTo(margin + contentWidth, 45)
        .lineWidth(0.45)
        .strokeColor(COLORS.line)
        .stroke()
        .restore()
      setFont('PHD ATLAS', 7.2, COLORS.muted).text('PHD ATLAS', margin, doc.page.height - 33, {
        width: contentWidth / 2,
        lineBreak: false,
      })
      setFont(String(pageNumber).padStart(2, '0'), 7.2, COLORS.muted, true).text(
        String(pageNumber).padStart(2, '0'),
        margin + contentWidth / 2,
        doc.page.height - 33,
        { width: contentWidth / 2, align: 'right', lineBreak: false },
      )
      doc.page.margins.bottom = previousBottomMargin
      doc.x = previousX
      doc.y = previousY
    }

    const ensureSpace = (height) => {
      if (doc.y + height <= contentBottom()) return
      doc.addPage()
    }

    const renderCustomFields = (fields) => {
      if (!fields.length) return
      ensureSpace(36)
      const gap = 22
      const columnWidth = (contentWidth - gap) / 2
      for (let index = 0; index < fields.length; index += 2) {
        material.budget.consumeWork(2)
        const pair = fields.slice(index, index + 2)
        const cellHeights = pair.map(({ value }) =>
          setFont(value, 9.2).heightOfString(value, {
            width: columnWidth,
            lineGap: 2,
          }),
        )
        const rowHeight = Math.max(42, ...cellHeights.map((height) => height + 24))
        ensureSpace(rowHeight + 8)
        const y = doc.y
        pair.forEach(({ label, value }, pairIndex) => {
          const x = margin + pairIndex * (columnWidth + gap)
          setFont(label.toUpperCase(), 7, COLORS.muted, true).text(label.toUpperCase(), x, y, {
            width: columnWidth,
            characterSpacing: 0.3,
            lineBreak: false,
            ellipsis: true,
          })
          setFont(value, 9.2, COLORS.ink).text(value, x, y + 15, {
            width: columnWidth,
            lineGap: 2,
          })
        })
        doc
          .save()
          .moveTo(margin, y + rowHeight)
          .lineTo(margin + contentWidth, y + rowHeight)
          .lineWidth(0.45)
          .strokeColor(COLORS.line)
          .stroke()
          .restore()
        doc.y = y + rowHeight + 10
      }
      doc.y += 4
    }

    drawPageFurniture()
    doc.on('pageAdded', () => {
      try {
        material.budget.addPage()
      } catch (error) {
        doc.destroy(error)
        throw error
      }
      pageNumber += 1
      drawPageFurniture()
      doc.y = doc.page.margins.top
    })

    doc.y = 72
    setFont(material.kind.toUpperCase(), 8.2, COLORS.accent, true).text(material.kind.toUpperCase(), margin, doc.y, {
      width: contentWidth,
      characterSpacing: 0.75,
    })
    doc.y += 13
    setFont(material.name, 25, COLORS.ink, true).text(material.name, margin, doc.y, {
      width: contentWidth,
      lineGap: 1.5,
    })
    doc.y += 9
    doc
      .save()
      .moveTo(margin, doc.y)
      .lineTo(margin + contentWidth, doc.y)
      .lineWidth(1.25)
      .strokeColor(COLORS.accent)
      .stroke()
      .restore()
    doc.y += 18

    renderCustomFields(material.customFields.filter(({ placement }) => placement === 'beforeBody'))

    for (const block of material.blocks) {
      material.budget.consumeWork()
      if (block.type === 'heading') {
        const sizes = [16, 13, 11]
        const size = sizes[Math.min(2, Math.max(0, block.level - 1))]
        ensureSpace(size + 30)
        doc.y += block.level === 1 ? 12 : 8
        setFont(block.text, size, COLORS.ink, true).text(block.text, margin, doc.y, {
          width: contentWidth,
          lineGap: 1.5,
        })
        doc.y += 5
        continue
      }
      if (block.type === 'list') {
        for (const [index, item] of block.items.entries()) {
          material.budget.consumeWork()
          const marker = block.ordered ? `${index + 1}.` : '-'
          const textHeight = setFont(item, 10.1).heightOfString(item, {
            width: contentWidth - 24,
            lineGap: 3,
          })
          ensureSpace(textHeight + 10)
          const y = doc.y
          setFont(marker, 9.5, COLORS.accent, true).text(marker, margin + 2, y + 1, {
            width: 17,
            align: 'right',
            lineBreak: false,
          })
          setFont(item, 10.1, COLORS.ink).text(item, margin + 28, y, {
            width: contentWidth - 28,
            lineGap: 3,
          })
          doc.y = Math.max(doc.y, y + textHeight + 7)
        }
        doc.y += 3
        continue
      }
      const textHeight = setFont(block.text, 10.25).heightOfString(block.text, {
        width: contentWidth,
        lineGap: 4,
      })
      ensureSpace(Math.min(textHeight, 90) + 9)
      setFont(block.text, 10.25, COLORS.ink).text(block.text, margin, doc.y, {
        width: contentWidth,
        lineGap: 4,
        align: 'left',
      })
      doc.y += 9
    }

    renderCustomFields(material.customFields.filter(({ placement }) => placement === 'afterBody'))

    doc.end()
    } catch (error) {
      if (!doc.destroyed) doc.destroy(error)
      reject(error)
    }
  })
}

function createBoundedUtf8Builder(maxBytes) {
  const capacity = Math.min(
    PROFILE_ASSET_EXPORT_LIMITS.outputBytes,
    Math.max(1024, Number(maxBytes) || PROFILE_ASSET_EXPORT_LIMITS.outputBytes),
  )
  if (!Number.isSafeInteger(capacity)) throw exportLimit('output')
  let allocation = Buffer.allocUnsafe(capacity)
  let written = 0
  return {
    append(value) {
      const text = String(value ?? '')
      const bytes = Buffer.byteLength(text, 'utf8')
      if (bytes > capacity - written) throw exportLimit('output')
      allocation.write(text, written, bytes, 'utf8')
      written += bytes
    },
    finish() {
      const output = written === 0 ? Buffer.alloc(0) : allocation.subarray(0, written)
      allocation = null
      return output
    },
  }
}

export function toProfileAssetWordBuffer(asset, {
  language = 'en',
  maxOutputBytes = PROFILE_ASSET_EXPORT_LIMITS.outputBytes,
} = {}) {
  const material = normalizedAsset(asset)
  const lang = WORD_LANGUAGE_TAGS[normalizeLanguage(language)] ?? WORD_LANGUAGE_TAGS.en
  const output = createBoundedUtf8Builder(maxOutputBytes)
  const appendCustomFields = (fields) => {
    if (!fields.length) return
    output.append('<dl class="details">')
    for (const { label, value } of fields) {
      material.budget.consumeWork()
      output.append(`<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    }
    output.append('</dl>')
  }
  const appendBlocks = () => {
    for (const block of material.blocks) {
      material.budget.consumeWork()
      if (block.type === 'heading') {
        const level = Math.min(3, Math.max(1, block.level))
        output.append(`<h${level}>${escapeHtml(block.text)}</h${level}>\n`)
        continue
      }
      if (block.type === 'list') {
        const tag = block.ordered ? 'ol' : 'ul'
        output.append(`<${tag}>`)
        for (const item of block.items) {
          material.budget.consumeWork()
          output.append(`<li>${escapeHtml(item)}</li>`)
        }
        output.append(`</${tag}>\n`)
        continue
      }
      output.append(`<p>${escapeHtml(block.text)}</p>\n`)
    }
  }

  output.append(`\ufeff<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40" lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="ProgId" content="Word.Document">
<title>${escapeHtml(material.name)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->
<style>
@page WordSection { size: 595.3pt 841.9pt; margin: 58pt 56pt 60pt; mso-header-margin: 24pt; mso-footer-margin: 24pt; mso-header: h1; mso-footer: f1; }
body { color: #1d1d1f; font-family: Aptos, "Noto Sans CJK SC", "Microsoft YaHei", "Yu Gothic", Arial, sans-serif; font-size: 10.5pt; line-height: 1.62; }
.WordSection { page: WordSection; }
.header, .footer { color: #85868c; font-size: 7.5pt; letter-spacing: .08em; }
.header { mso-element: header; border-bottom: .5pt solid #e1e3e7; padding-bottom: 7pt; }
.footer { mso-element: footer; }
.footer .number { float: right; }
.eyebrow { color: #0071e3; font-size: 8pt; font-weight: 700; letter-spacing: .09em; margin-bottom: 8pt; text-transform: uppercase; }
.title { border-bottom: 1.25pt solid #0071e3; font-size: 25pt; line-height: 1.16; margin: 0 0 18pt; padding-bottom: 12pt; }
.details { border-bottom: .5pt solid #e1e3e7; display: table; margin: 0 0 20pt; padding: 0 0 10pt; width: 100%; }
.details > div { display: inline-block; margin: 0 4% 10pt 0; vertical-align: top; width: 45%; }
dt { color: #85868c; font-size: 7pt; font-weight: 700; letter-spacing: .05em; margin: 0 0 3pt; text-transform: uppercase; }
dd { margin: 0; }
h1, h2, h3 { color: #1d1d1f; page-break-after: avoid; }
h1 { font-size: 16pt; margin: 18pt 0 7pt; }
h2 { font-size: 13pt; margin: 15pt 0 6pt; }
h3 { font-size: 11pt; margin: 12pt 0 5pt; }
p { margin: 0 0 9pt; orphans: 3; widows: 3; }
ul, ol { margin: 0 0 10pt 20pt; padding: 0; }
li { margin: 0 0 4pt; }
</style>
</head>
<body>
<div class="header" id="h1">PHD ATLAS</div>
<div class="footer" id="f1">PHD ATLAS <span class="number"><span style="mso-field-code: 'page'"></span></span></div>
<main class="WordSection">
<div class="eyebrow">${escapeHtml(material.kind)}</div>
<h1 class="title">${escapeHtml(material.name)}</h1>
`)
  appendCustomFields(material.customFields.filter(({ placement }) => placement === 'beforeBody'))
  appendBlocks()
  appendCustomFields(material.customFields.filter(({ placement }) => placement === 'afterBody'))
  output.append(`</main>
</body>
</html>`
  )
  return output.finish()
}
