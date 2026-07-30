import rehypeParse from 'rehype-parse'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'

const markdownSignalPattern = /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s|>\s?|```|~~~|(?:---|___|\*\*\*)\s*$)|\|[^\n]+\|\s*\n\s*\|?\s*:?-{3,}|(?:^|[^\\])(?:\*\*|__|~~|\+\+)[^\n]+(?:\*\*|__|~~|\+\+)|`[^`\n]+`|!?\[[^\]\n]+\]\([^)\n]+\)|\[\^[^\]\n]+\]|(?:https?:\/\/|www\.)\S+|[\w.+-]+@[\w.-]+\.[a-z]{2,}/im
const htmlSignalPattern = /<!doctype\s+html\b|<\/?(?:html|head|body|main|article|aside|nav|section|header|footer|p|div|span|br|strong|b|em|i|u|s|strike|del|ins|mark|small|ul|ol|li|dl|dt|dd|blockquote|pre|code|samp|var|a|q|cite|h[1-6]|hr|table|thead|tbody|tfoot|tr|th|td|caption|figure|figcaption|img|input|details|summary|sup|sub|kbd|abbr|time|address|bdi|bdo|wbr)\b[^>]*>/i
const htmlFirstPattern = /^\s*(?:<!doctype\s+html\b|<\/?(?:html|head|body|main|article|aside|nav|section|header|footer|p|div|span|br|strong|b|em|i|u|s|strike|del|ins|mark|small|ul|ol|li|dl|dt|dd|blockquote|pre|code|samp|var|a|q|cite|h[1-6]|hr|table|thead|tbody|tfoot|tr|th|td|caption|figure|figcaption|img|input|details|summary|sup|sub|kbd|abbr|time|address|bdi|bdo|wbr)\b)/i

const addedSafeTags = [
  'abbr',
  'address',
  'article',
  'aside',
  'bdi',
  'bdo',
  'cite',
  'details',
  'figcaption',
  'figure',
  'footer',
  'header',
  'ins',
  'kbd',
  'main',
  'mark',
  'nav',
  'q',
  'samp',
  'section',
  'small',
  'summary',
  'time',
  'u',
  'var',
  'wbr',
]

function unique(values) {
  return Array.from(new Set(values))
}

function attributesFor(tagName, additions) {
  return unique([...(defaultSchema.attributes?.[tagName] ?? []), ...additions])
}

const richTextSanitizeSchema = {
  ...defaultSchema,
  tagNames: unique([...(defaultSchema.tagNames ?? []), ...addedSafeTags]),
  attributes: {
    ...defaultSchema.attributes,
    a: attributesFor('a', [
      'title',
      'target',
      'rel',
      'dataFootnoteRef',
      'dataFootnoteBackref',
      'ariaDescribedBy',
      'ariaLabel',
    ]),
    abbr: attributesFor('abbr', ['title']),
    code: attributesFor('code', [['className', /^language-[a-z0-9_-]+$/i]]),
    details: attributesFor('details', ['open']),
    h2: attributesFor('h2', [['className', 'sr-only']]),
    img: attributesFor('img', ['src', 'alt', 'title', 'width', 'height', 'loading', 'decoding', 'referrerPolicy']),
    input: attributesFor('input', [['type', 'checkbox'], 'checked', 'disabled']),
    li: attributesFor('li', [['className', 'task-list-item']]),
    ol: attributesFor('ol', ['start', 'reversed', 'type']),
    section: attributesFor('section', [['className', 'footnotes'], 'dataFootnotes']),
    td: attributesFor('td', ['align', 'colSpan', 'rowSpan']),
    th: attributesFor('th', ['align', 'colSpan', 'rowSpan']),
    time: attributesFor('time', ['dateTime']),
    ul: attributesFor('ul', [['className', 'contains-task-list']]),
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto'],
    src: ['http', 'https'],
  },
  clobberPrefix: 'atlas-content-',
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function safeLinkHref(value) {
  const href = String(value ?? '').trim()
  if (!href) return ''
  if (/^#[a-z0-9._:-]+$/i.test(href)) return href
  if (/^mailto:[^?\s@]+@[^?\s@]+\.[^?\s@]+$/i.test(href)) return href
  try {
    const parsed = new URL(href)
    if (parsed.username || parsed.password) return ''
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? href : ''
  } catch {
    return ''
  }
}

function safeImageSrc(value) {
  const src = String(value ?? '').trim()
  if (!src) return ''
  try {
    const parsed = new URL(src)
    if (parsed.username || parsed.password) return ''
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? src : ''
  } catch {
    return ''
  }
}

function normalizeSafeContentTree() {
  return (tree) => {
    const visit = (node, parent = null, index = -1) => {
      if (!node || typeof node !== 'object') return
      if (node.type === 'element') {
        node.properties ??= {}
        if (node.tagName === 'a') {
          const href = safeLinkHref(node.properties.href)
          if (!href) {
            if (parent && index >= 0) parent.children.splice(index, 1, ...(node.children ?? []))
            return
          }
          node.properties.href = href
          if (!href.startsWith('#')) {
            node.properties.target = '_blank'
            node.properties.rel = ['noopener', 'noreferrer']
          } else {
            delete node.properties.target
            delete node.properties.rel
          }
        } else if (node.tagName === 'img') {
          const src = safeImageSrc(node.properties.src)
          if (!src) {
            const alt = String(node.properties.alt ?? '').trim()
            if (parent && index >= 0) {
              parent.children.splice(index, 1, ...(alt ? [{ type: 'text', value: alt }] : []))
            }
            return
          }
          node.properties.src = src
          node.properties.loading = 'lazy'
          node.properties.decoding = 'async'
          node.properties.referrerPolicy = 'no-referrer'
        } else if (node.tagName === 'input') {
          node.properties.type = 'checkbox'
          node.properties.disabled = true
        }
      }

      if (!Array.isArray(node.children)) return
      for (let childIndex = node.children.length - 1; childIndex >= 0; childIndex -= 1) {
        visit(node.children[childIndex], node, childIndex)
      }
    }
    visit(tree)
  }
}

function remarkUnderline() {
  return (tree) => {
    const visit = (node) => {
      if (!node || !Array.isArray(node.children)) return
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        const child = node.children[index]
        if (child?.type === 'text' && child.value.includes('++')) {
          const replacement = []
          const pattern = /\+\+([^+\n]+?)\+\+/g
          let cursor = 0
          let match
          while ((match = pattern.exec(child.value))) {
            if (match.index > cursor) {
              replacement.push({ type: 'text', value: child.value.slice(cursor, match.index) })
            }
            replacement.push(
              { type: 'html', value: '<u>' },
              { type: 'text', value: match[1] },
              { type: 'html', value: '</u>' },
            )
            cursor = match.index + match[0].length
          }
          if (replacement.length > 0) {
            if (cursor < child.value.length) {
              replacement.push({ type: 'text', value: child.value.slice(cursor) })
            }
            node.children.splice(index, 1, ...replacement)
            continue
          }
        }
        if (!['code', 'inlineCode', 'html'].includes(child?.type)) visit(child)
      }
    }
    visit(tree)
  }
}

const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm, { singleTilde: false })
  .use(remarkUnderline)
  .use(remarkRehype, {
    allowDangerousHtml: true,
    footnoteLabel: 'Footnotes',
    footnoteBackLabel: 'Back to content',
  })
  .use(rehypeRaw)
  .use(rehypeSanitize, richTextSanitizeSchema)
  .use(normalizeSafeContentTree)
  .use(rehypeStringify)

const htmlProcessor = unified()
  .use(rehypeParse, { fragment: true })
  .use(rehypeSanitize, richTextSanitizeSchema)
  .use(normalizeSafeContentTree)
  .use(rehypeStringify)

function processTree(processor, value) {
  return processor.runSync(processor.parse(String(value ?? '')))
}

function stringifyTree(processor, tree) {
  return String(processor.stringify(tree))
}

function plainTextHtml(value) {
  const normalized = String(value ?? '').replace(/\r\n?/g, '\n')
  if (!normalized.trim()) return ''
  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.split('\n').map(escapeHtml).join('<br>')}</p>`)
    .join('')
}

function treeForValue(value, format) {
  if (format === 'markdown') return processTree(markdownProcessor, value)
  if (format === 'html') return processTree(htmlProcessor, value)
  return processTree(htmlProcessor, plainTextHtml(value))
}

function textForNode(node, parentTag = '', index = 0) {
  if (!node || typeof node !== 'object') return ''
  if (node.type === 'text') return String(node.value ?? '')
  if (!Array.isArray(node.children) && node.type !== 'element') return ''

  const tagName = node.type === 'element' ? node.tagName : ''
  if (tagName === 'br') return '\n'
  if (tagName === 'hr') return '\n—\n'
  if (tagName === 'img') return String(node.properties?.alt ?? '')
  if (tagName === 'input' && node.properties?.type === 'checkbox') {
    return node.properties?.checked ? '☑ ' : '☐ '
  }

  const content = (node.children ?? [])
    .map((child, childIndex) => textForNode(child, tagName, childIndex))
    .join('')

  if (tagName === 'a') {
    const href = safeLinkHref(node.properties?.href)
    const cleanContent = content.trim()
    if (!href || href.startsWith('#') || cleanContent === href || href === `mailto:${cleanContent}`) {
      return content
    }
    return `${content} (${href})`
  }
  if (tagName === 'li') {
    const ordered = parentTag === 'ol'
    return `${ordered ? `${index + 1}.` : '-'} ${content.trim()}\n`
  }
  if (tagName === 'tr') {
    return `${(node.children ?? []).map((child, childIndex) => textForNode(child, tagName, childIndex).trim()).join(' | ')}\n`
  }
  if (tagName === 'th' || tagName === 'td') return content
  if (tagName === 'pre') return `\n${content.trimEnd()}\n\n`
  if (['p', 'div', 'main', 'section', 'article', 'address', 'figure', 'figcaption', 'details', 'summary'].includes(tagName)) {
    return `${content.trim()}\n\n`
  }
  if (/^h[1-6]$/.test(tagName)) return `${content.trim()}\n\n`
  if (['blockquote', 'ul', 'ol', 'dl', 'table', 'thead', 'tbody', 'tfoot'].includes(tagName)) {
    return `${content.trimEnd()}\n\n`
  }
  return content
}

function treeToPlainText(tree) {
  return textForNode(tree)
    .replace(/\u00a0/g, ' ')
    .replace(/([☑☐])\s+/g, '$1 ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const emailStyles = {
  a: 'color:#0066cc;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:2px;',
  abbr: 'text-decoration:underline dotted;text-underline-offset:2px;',
  address: 'margin:0 0 9px;font-style:normal;color:#515154;',
  blockquote: 'margin:9px 0;padding:3px 0 3px 12px;border-left:2px solid #c7c7cc;color:#515154;',
  caption: 'padding:0 0 7px;color:#6e6e73;font-size:11px;text-align:left;',
  code: 'font-family:SFMono-Regular,Consolas,"Liberation Mono",monospace;font-size:12px;',
  dd: 'margin:3px 0 9px 18px;color:#515154;',
  del: 'text-decoration:line-through;',
  div: 'margin:0;',
  dl: 'margin:9px 0;',
  dt: 'margin:0;color:#1d1d1f;font-weight:650;',
  figcaption: 'margin-top:6px;color:#6e6e73;font-size:11px;line-height:1.45;text-align:center;',
  figure: 'margin:9px 0;',
  h1: 'margin:17px 0 9px;color:#1d1d1f;font-size:20px;line-height:1.3;font-weight:700;letter-spacing:-0.018em;',
  h2: 'margin:17px 0 9px;color:#1d1d1f;font-size:18px;line-height:1.3;font-weight:680;letter-spacing:-0.012em;',
  h3: 'margin:17px 0 9px;color:#1d1d1f;font-size:16px;line-height:1.3;font-weight:670;',
  h4: 'margin:17px 0 9px;color:#1d1d1f;font-size:14px;line-height:1.3;font-weight:660;',
  h5: 'margin:17px 0 9px;color:#1d1d1f;font-size:13px;line-height:1.3;font-weight:650;',
  h6: 'margin:17px 0 9px;color:#515154;font-size:12px;line-height:1.3;font-weight:650;letter-spacing:0.025em;text-transform:uppercase;',
  hr: 'height:1px;margin:16px 0;border:0;background:#e5e5e7;',
  img: 'display:block;max-width:100%;height:auto;margin:9px auto;border:0;border-radius:4px;',
  kbd: 'display:inline-block;padding:1px 5px;border:1px solid #d2d2d7;border-radius:4px;background:#f5f5f7;color:#1d1d1f;font-family:SFMono-Regular,Consolas,monospace;font-size:11px;',
  li: 'margin:4px 0;padding-left:2px;',
  mark: 'padding:0 2px;background:#fff0a6;color:#1d1d1f;',
  ol: 'margin:9px 0;padding-left:21px;',
  p: 'margin:0 0 9px;',
  pre: 'margin:9px 0;padding:11px 12px;overflow:auto;border:1px solid #e5e5e7;border-radius:6px;background:#f5f5f7;color:#1d1d1f;font-family:SFMono-Regular,Consolas,"Liberation Mono",monospace;font-size:12px;line-height:1.58;white-space:pre-wrap;word-break:break-word;',
  small: 'font-size:11px;color:#6e6e73;',
  strong: 'font-weight:700;color:#1d1d1f;',
  summary: 'margin:0 0 8px;color:#1d1d1f;font-weight:650;',
  table: 'width:100%;margin:9px 0;border-collapse:collapse;border-spacing:0;font-size:12px;line-height:1.5;',
  td: 'padding:7px 9px;border:1px solid #d2d2d7;color:#515154;text-align:left;vertical-align:top;word-break:break-word;',
  th: 'padding:7px 9px;border:1px solid #d2d2d7;background:#f5f5f7;color:#1d1d1f;font-weight:650;text-align:left;vertical-align:top;word-break:break-word;',
  ul: 'margin:9px 0;padding-left:21px;',
}

function prepareEmailTree(tree) {
  const clone = JSON.parse(JSON.stringify(tree))
  const visit = (node, parent = null, index = -1) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'element') {
      node.properties ??= {}
      if (node.tagName === 'input' && node.properties.type === 'checkbox') {
        if (parent && index >= 0) {
          parent.children.splice(index, 1, {
            type: 'text',
            value: node.properties.checked ? '☑ ' : '☐ ',
          })
        }
        return
      }
      if (node.tagName === 'details') {
        node.tagName = 'div'
        delete node.properties.open
      } else if (node.tagName === 'summary') {
        node.tagName = 'p'
      }
      const style = emailStyles[node.tagName]
      if (style) node.properties.style = style
      if (node.tagName === 'table') {
        node.properties.cellPadding = '0'
        node.properties.cellSpacing = '0'
      }
    }
    if (!Array.isArray(node.children)) return
    for (let childIndex = node.children.length - 1; childIndex >= 0; childIndex -= 1) {
      visit(node.children[childIndex], node, childIndex)
    }
  }
  visit(clone)
  return clone
}

export function detectRichTextFormat(value) {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return 'plain'
  if (htmlFirstPattern.test(trimmed) && htmlSignalPattern.test(trimmed)) return 'html'
  if (markdownSignalPattern.test(trimmed)) return 'markdown'
  if (htmlSignalPattern.test(trimmed)) return 'html'
  return 'plain'
}

export function plainTextToSafeHtml(value) {
  return plainTextHtml(value)
}

export function markdownToSafeHtml(value) {
  if (!String(value ?? '').trim()) return ''
  const tree = treeForValue(value, 'markdown')
  return stringifyTree(markdownProcessor, tree)
}

export function sanitizeRichHtml(value) {
  if (!String(value ?? '').trim()) return ''
  const tree = treeForValue(value, 'html')
  return stringifyTree(htmlProcessor, tree)
}

export function richTextToSafeHtml(value, format = detectRichTextFormat(value)) {
  if (!String(value ?? '').trim()) return ''
  const tree = treeForValue(value, format)
  return stringifyTree(format === 'markdown' ? markdownProcessor : htmlProcessor, tree)
}

export function richTextToPlainText(value, format = detectRichTextFormat(value)) {
  if (!String(value ?? '').trim()) return ''
  return treeToPlainText(treeForValue(value, format))
}

export function richTextNeedsFidelityPreview(value, format = detectRichTextFormat(value)) {
  const source = String(value ?? '')
  if (!source.trim()) return false
  if (format === 'markdown') {
    return /(^|\n)\s{0,3}(?:[-*+]\s+\[[ xX]\]\s+|\|[^\n]+\|\s*$)|!\[[^\]\n]*\]\([^)\n]+\)|\[\^[^\]\n]+\]|<(?:article|aside|nav|main|section|header|footer|table|thead|tbody|tfoot|tr|th|td|caption|img|figure|figcaption|details|summary|dl|dt|dd|address|hr|mark|ins|small|kbd|samp|var|sub|sup|abbr|time|cite|q|bdi|bdo|wbr|input)\b/i.test(source)
  }
  if (format === 'html') {
    return /<(?:article|aside|nav|main|section|header|footer|table|thead|tbody|tfoot|tr|th|td|caption|img|figure|figcaption|details|summary|dl|dt|dd|address|hr|mark|ins|small|kbd|samp|var|sub|sup|abbr|time|cite|q|bdi|bdo|wbr|input)\b/i.test(source)
  }
  return false
}

export function renderSafeRichTextEmailHtml(contentHtml) {
  const safeTree = treeForValue(contentHtml, 'html')
  const emailTree = prepareEmailTree(safeTree)
  const fragment = stringifyTree(htmlProcessor, emailTree)
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:0;background:#ffffff;color:#515154;">
  <div style="max-width:680px;margin:0 auto;padding:18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:13px;line-height:1.62;color:#515154;word-break:break-word;">
    ${fragment}
  </div>
</body>
</html>`
}

export function renderRichTextEmail(value, format = detectRichTextFormat(value)) {
  const tree = treeForValue(value, format)
  const contentHtml = stringifyTree(format === 'markdown' ? markdownProcessor : htmlProcessor, tree)
  return {
    format,
    contentHtml,
    text: treeToPlainText(tree),
    html: renderSafeRichTextEmailHtml(contentHtml),
  }
}

export function renderStoredRichTextEmail(communication) {
  const rendered = renderRichTextEmail(
    communication?.summary ?? '',
    communication?.bodyFormat,
  )
  const contentHtml = communication?.bodyHtml || rendered.contentHtml
  return {
    format: communication?.bodyFormat || rendered.format,
    contentHtml,
    text: communication?.bodyText || rendered.text,
    html: renderSafeRichTextEmailHtml(contentHtml),
  }
}
