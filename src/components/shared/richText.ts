import {
  sanitizeRichHtml,
} from '../../../server/richText.js'
import { safeMarkdownHref } from '../../safeLinks'

export {
  detectRichTextFormat,
  markdownToSafeHtml,
  plainTextToSafeHtml,
  renderRichTextEmail,
  renderSafeRichTextEmailHtml,
  richTextNeedsFidelityPreview,
  richTextToPlainText,
  richTextToSafeHtml,
  sanitizeRichHtml,
} from '../../../server/richText.js'
export type { RichTextFormat } from '../../../server/richText.js'

export { normalizeEscapedMultiline } from '../../textNormalize'

export function escapeRichTextHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function serializeChildren(node: Node): string {
  return Array.from(node.childNodes).map(serializeNode).join('')
}

function serializeListItem(node: Element): string {
  return Array.from(node.childNodes)
    .filter((child) => !(child instanceof Element && (child.tagName === 'UL' || child.tagName === 'OL')))
    .map(serializeNode)
    .join('')
    .replace(/\n{2,}/g, ' ')
    .trim()
}

function serializeList(node: Element, ordered: boolean): string {
  const start = ordered ? Number(node.getAttribute('start') || 1) : 1
  const items = Array.from(node.children).filter((child) => child.tagName === 'LI')
  return items.map((item, index) => {
    const marker = ordered ? `${start + index}.` : '-'
    const nested = Array.from(item.children)
      .filter((child) => child.tagName === 'UL' || child.tagName === 'OL')
      .map((child) => (
        serializeList(child, child.tagName === 'OL')
          .trim()
          .split('\n')
          .map((line: string) => `  ${line}`)
          .join('\n')
      ))
      .filter(Boolean)
      .join('\n')
    return `${marker} ${serializeListItem(item)}${nested ? `\n${nested}` : ''}`
  }).join('\n') + '\n\n'
}

function escapeTableCell(value: string) {
  return value.replace(/\|/g, '\\|').replace(/\n+/g, '<br>').trim()
}

function serializeTable(node: Element): string {
  const caption = node.querySelector(':scope > caption')
  const rows = Array.from(
    node.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr, :scope > tr'),
  )
  if (!rows.length) return ''

  const serializedRows = rows.map((row) => (
    Array.from(row.children)
      .filter((cell) => cell.tagName === 'TH' || cell.tagName === 'TD')
      .map((cell) => escapeTableCell(serializeChildren(cell)))
  ))
  const columnCount = Math.max(1, ...serializedRows.map((row) => row.length))
  const normalizeRow = (row: string[]) => (
    `| ${Array.from({ length: columnCount }, (_, index) => row[index] ?? '').join(' | ')} |`
  )
  const captionMarkdown = caption ? `*${serializeChildren(caption).trim()}*\n\n` : ''
  return `${captionMarkdown}${normalizeRow(serializedRows[0])}\n${normalizeRow(
    Array.from({ length: columnCount }, () => '---'),
  )}\n${serializedRows.slice(1).map(normalizeRow).join('\n')}\n\n`
}

function serializeHtmlElement(node: Element) {
  const tagName = node.tagName.toLowerCase()
  const attributes = Array.from(node.attributes)
    .filter((attribute) => !['target', 'rel', 'loading', 'decoding', 'referrerpolicy'].includes(attribute.name))
    .map((attribute) => ` ${attribute.name}="${escapeRichTextHtml(attribute.value)}"`)
    .join('')
  return `<${tagName}${attributes}>${serializeChildren(node)}</${tagName}>`
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.replace(/\u00a0/g, ' ') ?? ''
  if (!(node instanceof Element)) return ''

  const content = () => serializeChildren(node)
  switch (node.tagName) {
    case 'BR': return '\\\n'
    case 'STRONG':
    case 'B': return `**${content()}**`
    case 'EM':
    case 'I': return `*${content()}*`
    case 'U': return `++${content()}++`
    case 'S':
    case 'STRIKE':
    case 'DEL': return `~~${content()}~~`
    case 'MARK': return `<mark>${content()}</mark>`
    case 'SUP': return `<sup>${content()}</sup>`
    case 'SUB': return `<sub>${content()}</sub>`
    case 'KBD': return `<kbd>${content()}</kbd>`
    case 'ABBR':
    case 'TIME': return serializeHtmlElement(node)
    case 'CODE':
      return node.parentElement?.tagName === 'PRE' ? node.textContent ?? '' : `\`${node.textContent ?? ''}\``
    case 'A': {
      const href = safeMarkdownHref(node.getAttribute('href') ?? '')
      return href ? `[${content()}](${href})` : content()
    }
    case 'IMG': {
      const src = safeMarkdownHref(node.getAttribute('src') ?? '')
      const alt = (node.getAttribute('alt') ?? '').replace(/[[\]]/g, '')
      const title = node.getAttribute('title')
      return src ? `![${alt}](${src}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})` : alt
    }
    case 'INPUT':
      return node.getAttribute('type') === 'checkbox'
        ? `${node.hasAttribute('checked') ? '[x]' : '[ ]'} `
        : ''
    case 'P':
    case 'DIV':
    case 'SECTION':
    case 'MAIN':
    case 'ADDRESS':
    case 'FIGCAPTION': return `${content().trim()}\n\n`
    case 'FIGURE': return `${content().trim()}\n\n`
    case 'DETAILS': return `${serializeHtmlElement(node)}\n\n`
    case 'SUMMARY': return content()
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6': {
      // Lexical deliberately uses h3-h6 for the compact in-app visual scale.
      const level = Math.max(1, Number(node.tagName.slice(1)) - 2)
      return `${'#'.repeat(level)} ${content().trim()}\n\n`
    }
    case 'BLOCKQUOTE': {
      const quote = content().trim().split('\n').map((line) => `> ${line}`).join('\n')
      return `${quote}\n\n`
    }
    case 'PRE': {
      const language = node.querySelector('code')?.className.match(/(?:^|\s)language-([a-z0-9_-]+)/i)?.[1] ?? ''
      return `\`\`\`${language}\n${node.textContent ?? ''}\n\`\`\`\n\n`
    }
    case 'UL': return serializeList(node, false)
    case 'OL': return serializeList(node, true)
    case 'TABLE': return serializeTable(node)
    case 'HR': return '---\n\n'
    case 'LI':
    case 'CAPTION':
    case 'THEAD':
    case 'TBODY':
    case 'TFOOT':
    case 'TR':
    case 'TH':
    case 'TD':
    case 'DL':
    case 'DT':
    case 'DD': return content()
    default: return content()
  }
}

export function htmlToMarkdown(value: string) {
  if (!value.trim()) return ''
  if (typeof document === 'undefined') return value
  const template = document.createElement('template')
  template.innerHTML = sanitizeRichHtml(value)
  return serializeChildren(template.content)
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
