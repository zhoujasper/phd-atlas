import { safeMarkdownHref } from '../../safeLinks'

export type RichTextFormat = 'plain' | 'markdown' | 'html'

export { normalizeEscapedMultiline } from '../../textNormalize'

const markdownSignalPattern = /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|>\s?|```|~~~|---\s*$)|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\+\+[^+\n]+\+\+|`[^`\n]+`|\[[^\]\n]+\]\([^)\n]+\)/m
const htmlSignalPattern = /<\/?(?:p|div|br|strong|b|em|i|u|s|strike|del|ul|ol|li|blockquote|pre|code|a|h[1-6]|hr|table|thead|tbody|tfoot|tr|th|td|caption|sup|sub|kbd)\b[^>]*>/i

const allowedTags = new Set([
  'A', 'B', 'BLOCKQUOTE', 'BR', 'CAPTION', 'CODE', 'DEL', 'DIV', 'EM', 'H1', 'H2', 'H3',
  'H4', 'H5', 'H6', 'HR', 'I', 'KBD', 'LI', 'OL', 'P', 'PRE', 'S', 'STRIKE', 'STRONG',
  'SUB', 'SUP', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'U', 'UL',
])

const blockedTags = 'script,style,iframe,object,embed,template,svg,math,form,input,button,textarea,select,option,link,meta'

export function detectRichTextFormat(value: string): RichTextFormat {
  const trimmed = value.trim()
  if (!trimmed) return 'plain'
  if (markdownSignalPattern.test(trimmed)) return 'markdown'
  if (htmlSignalPattern.test(trimmed)) return 'html'
  return 'plain'
}

export function escapeRichTextHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderMarkdownInline(value: string): string {
  let html = ''
  let index = 0

  const renderWrapped = (marker: string, tag: string) => {
    if (!value.startsWith(marker, index)) return false
    const end = value.indexOf(marker, index + marker.length)
    if (end <= index + marker.length) return false
    const inner = value.slice(index + marker.length, end)
    html += `<${tag}>${renderMarkdownInline(inner)}</${tag}>`
    index = end + marker.length
    return true
  }

  while (index < value.length) {
    if (value[index] === '\\' && index + 1 < value.length) {
      html += escapeRichTextHtml(value[index + 1])
      index += 2
      continue
    }

    if (value[index] === '`') {
      const end = value.indexOf('`', index + 1)
      if (end > index + 1) {
        html += `<code>${escapeRichTextHtml(value.slice(index + 1, end))}</code>`
        index = end + 1
        continue
      }
    }

    if (value[index] === '[') {
      const rest = value.slice(index)
      const link = rest.match(/^\[([^\]\n]+)\]\(([^)\n]+)\)/)
      if (link) {
        const href = safeMarkdownHref(link[2])
        if (href) {
          html += `<a href="${escapeRichTextHtml(href)}" target="_blank" rel="noopener noreferrer">${renderMarkdownInline(link[1])}</a>`
        } else {
          html += escapeRichTextHtml(link[0])
        }
        index += link[0].length
        continue
      }
    }

    if (
      renderWrapped('**', 'strong') ||
      renderWrapped('__', 'strong') ||
      renderWrapped('~~', 'del') ||
      renderWrapped('++', 'u') ||
      renderWrapped('*', 'em') ||
      renderWrapped('_', 'em')
    ) {
      continue
    }

    html += escapeRichTextHtml(value[index])
    index += 1
  }

  return html
}

function isMarkdownBlockStart(line: string) {
  return /^\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|>\s?|```|~~~|(?:---|___|\*\*\*)\s*$)/.test(line)
}

export function markdownToSafeHtml(value: string) {
  const lines = value.replace(/\r\n/g, '\n').split('\n')
  const blocks: string[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }

    const fence = line.match(/^\s{0,3}(```|~~~)/)
    if (fence) {
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !lines[index].trim().startsWith(fence[1])) {
        codeLines.push(lines[index])
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push(`<pre><code>${escapeRichTextHtml(codeLines.join('\n'))}</code></pre>`)
      continue
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/)
    if (heading) {
      const visualLevel = Math.min(heading[1].length + 2, 6)
      blocks.push(`<h${visualLevel}>${renderMarkdownInline(heading[2].trim())}</h${visualLevel}>`)
      index += 1
      continue
    }

    if (/^\s{0,3}(?:---|___|\*\*\*)\s*$/.test(line)) {
      blocks.push('<hr>')
      index += 1
      continue
    }

    if (/^\s{0,3}>/.test(line)) {
      const quoteLines: string[] = []
      while (index < lines.length) {
        const quote = lines[index].match(/^\s{0,3}>\s?(.*)$/)
        if (!quote) break
        quoteLines.push(quote[1])
        index += 1
      }
      blocks.push(`<blockquote>${quoteLines.map((quoteLine) => `<p>${renderMarkdownInline(quoteLine)}</p>`).join('')}</blockquote>`)
      continue
    }

    if (/^\s{0,3}[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length) {
        const item = lines[index].match(/^\s{0,3}[-*+]\s+(.+)$/)
        if (!item) break
        items.push(`<li>${renderMarkdownInline(item[1].trim())}</li>`)
        index += 1
      }
      blocks.push(`<ul>${items.join('')}</ul>`)
      continue
    }

    if (/^\s{0,3}\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length) {
        const item = lines[index].match(/^\s{0,3}\d+\.\s+(.+)$/)
        if (!item) break
        items.push(`<li>${renderMarkdownInline(item[1].trim())}</li>`)
        index += 1
      }
      blocks.push(`<ol>${items.join('')}</ol>`)
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length && lines[index].trim()) {
      if (paragraph.length > 0 && isMarkdownBlockStart(lines[index])) break
      paragraph.push(lines[index].trimStart())
      index += 1
    }
    const paragraphHtml = paragraph.map((paragraphLine, lineIndex) => {
      const hardBreak = /(?: {2,}|\\)$/.test(paragraphLine)
      const content = paragraphLine.replace(/(?: {2,}|\\)$/, '').trimEnd()
      const separator = lineIndex === paragraph.length - 1 ? '' : hardBreak ? '<br>' : ' '
      return `${renderMarkdownInline(content)}${separator}`
    }).join('')
    blocks.push(`<p>${paragraphHtml}</p>`)
  }

  return sanitizeRichHtml(blocks.join(''))
}

export function plainTextToSafeHtml(value: string) {
  if (!value.trim()) return ''
  return value
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.split('\n').map(escapeRichTextHtml).join('<br>')}</p>`)
    .join('')
}

function normalizedSpan(value: string | null) {
  if (!value || !/^\d{1,2}$/.test(value)) return ''
  const span = Number(value)
  return span >= 1 && span <= 20 ? String(span) : ''
}

export function sanitizeRichHtml(value: string) {
  if (!value.trim()) return ''
  if (typeof document === 'undefined') return escapeRichTextHtml(value)

  const template = document.createElement('template')
  template.innerHTML = value
  template.content.querySelectorAll(blockedTags).forEach((node) => node.remove())

  Array.from(template.content.querySelectorAll('*')).forEach((element) => {
    const tag = element.tagName.toUpperCase()
    if (!allowedTags.has(tag)) {
      element.replaceWith(...Array.from(element.childNodes))
      return
    }

    const href = tag === 'A' ? element.getAttribute('href') : null
    const title = tag === 'A' ? element.getAttribute('title') : null
    const colSpan = tag === 'TD' || tag === 'TH' ? normalizedSpan(element.getAttribute('colspan')) : ''
    const rowSpan = tag === 'TD' || tag === 'TH' ? normalizedSpan(element.getAttribute('rowspan')) : ''
    Array.from(element.attributes).forEach((attribute) => element.removeAttribute(attribute.name))

    if (tag === 'A') {
      const safeHref = safeMarkdownHref(href ?? '')
      if (!safeHref) {
        element.replaceWith(...Array.from(element.childNodes))
        return
      }
      element.setAttribute('href', safeHref)
      element.setAttribute('target', '_blank')
      element.setAttribute('rel', 'noopener noreferrer')
      if (title) element.setAttribute('title', title.slice(0, 240))
    }

    if (colSpan) element.setAttribute('colspan', colSpan)
    if (rowSpan) element.setAttribute('rowspan', rowSpan)
  })

  const canonicalTags: Record<string, string> = { B: 'strong', I: 'em', S: 'del', STRIKE: 'del' }
  Array.from(template.content.querySelectorAll('b, i, s, strike')).forEach((element) => {
    const replacement = document.createElement(canonicalTags[element.tagName] ?? element.tagName.toLowerCase())
    replacement.append(...Array.from(element.childNodes))
    element.replaceWith(replacement)
  })
  ;['strong', 'em', 'u', 'del', 'code'].forEach((tag) => {
    let nested = template.content.querySelector(`${tag} > ${tag}:only-child`)
    while (nested) {
      nested.parentElement?.replaceWith(nested)
      nested = template.content.querySelector(`${tag} > ${tag}:only-child`)
    }
  })

  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_COMMENT)
  const comments: Comment[] = []
  while (walker.nextNode()) comments.push(walker.currentNode as Comment)
  comments.forEach((comment) => comment.remove())

  return template.innerHTML
}

export function richTextToSafeHtml(value: string, format: RichTextFormat = detectRichTextFormat(value)) {
  if (!value.trim()) return ''
  if (format === 'html') return sanitizeRichHtml(value)
  if (format === 'markdown') return markdownToSafeHtml(value)
  return plainTextToSafeHtml(value)
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
  const items = Array.from(node.children).filter((child) => child.tagName === 'LI')
  return items.map((item, index) => {
    const marker = ordered ? `${index + 1}.` : '-'
    const nested = Array.from(item.children)
      .filter((child) => child.tagName === 'UL' || child.tagName === 'OL')
      .map((child) => serializeList(child, child.tagName === 'OL').trim().split('\n').map((line: string) => `  ${line}`).join('\n'))
      .filter(Boolean)
      .join('\n')
    return `${marker} ${serializeListItem(item)}${nested ? `\n${nested}` : ''}`
  }).join('\n') + '\n\n'
}

function serializeTable(node: Element): string {
  const rows = Array.from(node.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr, :scope > tr'))
  return rows.map((row) => Array.from(row.children).map((cell) => serializeChildren(cell).trim()).join(' | ')).join('\n') + '\n\n'
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
    case 'SUP': return `<sup>${content()}</sup>`
    case 'SUB': return `<sub>${content()}</sub>`
    case 'KBD': return `<kbd>${content()}</kbd>`
    case 'CODE':
      return node.parentElement?.tagName === 'PRE' ? node.textContent ?? '' : `\`${node.textContent ?? ''}\``
    case 'A': {
      const href = safeMarkdownHref(node.getAttribute('href') ?? '')
      return href ? `[${content()}](${href})` : content()
    }
    case 'P':
    case 'DIV': return `${content().trim()}\n\n`
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6': {
      const level = Math.max(1, Number(node.tagName.slice(1)) - 2)
      return `${'#'.repeat(level)} ${content().trim()}\n\n`
    }
    case 'BLOCKQUOTE': {
      const quote = content().trim().split('\n').map((line) => `> ${line}`).join('\n')
      return `${quote}\n\n`
    }
    case 'PRE': return `\`\`\`\n${node.textContent ?? ''}\n\`\`\`\n\n`
    case 'UL': return serializeList(node, false)
    case 'OL': return serializeList(node, true)
    case 'TABLE': return serializeTable(node)
    case 'HR': return '---\n\n'
    case 'LI': return content()
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
