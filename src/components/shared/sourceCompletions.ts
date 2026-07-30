export type SourceCompletionFormat = 'html' | 'markdown'

export type SourceCompletionKind = 'element' | 'attribute' | 'snippet'

export type SourceCompletion = {
  id: string
  label: string
  detail: string
  kind: SourceCompletionKind
  from: number
  to: number
  insertText: string
  selectFrom: number
  selectTo: number
}

type HtmlElementSpec = {
  tag: string
  insertText?: string
  selectFrom?: number
  selectTo?: number
}

type HtmlAttributeSpec = {
  label: string
  insertText: string
  selectFrom?: number
  selectTo?: number
}

type MarkdownSnippetSpec = {
  id: string
  label: string
  insertText: string
  selectFrom: number
  selectTo: number
}

const HTML_VOID_ELEMENTS = new Set(['br', 'hr', 'img', 'input', 'wbr'])

const HTML_ELEMENT_SPECS: HtmlElementSpec[] = [
  { tag: 'p' },
  { tag: 'section' },
  { tag: 'article' },
  { tag: 'div' },
  { tag: 'span' },
  { tag: 'strong' },
  { tag: 'em' },
  { tag: 'a', insertText: '<a href=""></a>', selectFrom: 9, selectTo: 9 },
  { tag: 'h1' },
  { tag: 'h2' },
  { tag: 'h3' },
  { tag: 'h4' },
  { tag: 'h5' },
  { tag: 'h6' },
  { tag: 'ul', insertText: '<ul>\n  <li></li>\n</ul>', selectFrom: 11, selectTo: 11 },
  { tag: 'ol', insertText: '<ol>\n  <li></li>\n</ol>', selectFrom: 11, selectTo: 11 },
  { tag: 'li' },
  { tag: 'blockquote' },
  { tag: 'pre', insertText: '<pre><code></code></pre>', selectFrom: 11, selectTo: 11 },
  { tag: 'code' },
  {
    tag: 'table',
    insertText: '<table>\n  <thead>\n    <tr>\n      <th>Header</th>\n    </tr>\n  </thead>\n  <tbody>\n    <tr>\n      <td>Cell</td>\n    </tr>\n  </tbody>\n</table>',
    selectFrom: 37,
    selectTo: 43,
  },
  { tag: 'thead' },
  { tag: 'tbody' },
  { tag: 'tfoot' },
  { tag: 'tr' },
  { tag: 'th' },
  { tag: 'td' },
  { tag: 'caption' },
  {
    tag: 'figure',
    insertText: '<figure>\n  <img src="" alt="">\n  <figcaption>Caption</figcaption>\n</figure>',
    selectFrom: 21,
    selectTo: 21,
  },
  { tag: 'figcaption' },
  { tag: 'img', insertText: '<img src="" alt="">', selectFrom: 10, selectTo: 10 },
  {
    tag: 'details',
    insertText: '<details>\n  <summary>Summary</summary>\n  <p></p>\n</details>',
    selectFrom: 21,
    selectTo: 28,
  },
  { tag: 'summary' },
  { tag: 'dl', insertText: '<dl>\n  <dt></dt>\n  <dd></dd>\n</dl>', selectFrom: 11, selectTo: 11 },
  { tag: 'dt' },
  { tag: 'dd' },
  { tag: 'header' },
  { tag: 'footer' },
  { tag: 'main' },
  { tag: 'aside' },
  { tag: 'nav' },
  { tag: 'mark' },
  { tag: 'ins' },
  { tag: 'del' },
  { tag: 'small' },
  { tag: 'kbd' },
  { tag: 'samp' },
  { tag: 'var' },
  { tag: 'sub' },
  { tag: 'sup' },
  { tag: 'abbr', insertText: '<abbr title=""></abbr>', selectFrom: 13, selectTo: 13 },
  { tag: 'time', insertText: '<time datetime=""></time>', selectFrom: 16, selectTo: 16 },
  { tag: 'cite' },
  { tag: 'q' },
  { tag: 'address' },
  { tag: 'u' },
  { tag: 's' },
  { tag: 'br', insertText: '<br>' },
  { tag: 'hr', insertText: '<hr>' },
  { tag: 'wbr', insertText: '<wbr>' },
  { tag: 'input', insertText: '<input type="checkbox" disabled>', selectFrom: 33, selectTo: 33 },
]

const GLOBAL_HTML_ATTRIBUTES: HtmlAttributeSpec[] = [
  { label: 'id', insertText: 'id=""', selectFrom: 4, selectTo: 4 },
  { label: 'title', insertText: 'title=""', selectFrom: 7, selectTo: 7 },
  { label: 'lang', insertText: 'lang=""', selectFrom: 6, selectTo: 6 },
  { label: 'dir', insertText: 'dir=""', selectFrom: 5, selectTo: 5 },
]

const HTML_ATTRIBUTES_BY_TAG: Record<string, HtmlAttributeSpec[]> = {
  a: [
    { label: 'href', insertText: 'href=""', selectFrom: 6, selectTo: 6 },
    { label: 'target', insertText: 'target="_blank"', selectFrom: 15, selectTo: 15 },
    { label: 'rel', insertText: 'rel="noopener noreferrer"', selectFrom: 24, selectTo: 24 },
    { label: 'aria-label', insertText: 'aria-label=""', selectFrom: 12, selectTo: 12 },
  ],
  abbr: [{ label: 'title', insertText: 'title=""', selectFrom: 7, selectTo: 7 }],
  code: [{ label: 'class', insertText: 'class="language-"', selectFrom: 16, selectTo: 16 }],
  details: [{ label: 'open', insertText: 'open', selectFrom: 4, selectTo: 4 }],
  img: [
    { label: 'src', insertText: 'src=""', selectFrom: 5, selectTo: 5 },
    { label: 'alt', insertText: 'alt=""', selectFrom: 5, selectTo: 5 },
    { label: 'width', insertText: 'width=""', selectFrom: 7, selectTo: 7 },
    { label: 'height', insertText: 'height=""', selectFrom: 8, selectTo: 8 },
    { label: 'loading', insertText: 'loading="lazy"', selectFrom: 14, selectTo: 14 },
  ],
  input: [
    { label: 'type', insertText: 'type="checkbox"', selectFrom: 15, selectTo: 15 },
    { label: 'checked', insertText: 'checked', selectFrom: 7, selectTo: 7 },
    { label: 'disabled', insertText: 'disabled', selectFrom: 8, selectTo: 8 },
  ],
  ol: [
    { label: 'start', insertText: 'start=""', selectFrom: 7, selectTo: 7 },
    { label: 'reversed', insertText: 'reversed', selectFrom: 8, selectTo: 8 },
    { label: 'type', insertText: 'type=""', selectFrom: 6, selectTo: 6 },
  ],
  td: [
    { label: 'align', insertText: 'align=""', selectFrom: 7, selectTo: 7 },
    { label: 'colspan', insertText: 'colspan=""', selectFrom: 9, selectTo: 9 },
    { label: 'rowspan', insertText: 'rowspan=""', selectFrom: 9, selectTo: 9 },
  ],
  th: [
    { label: 'align', insertText: 'align=""', selectFrom: 7, selectTo: 7 },
    { label: 'colspan', insertText: 'colspan=""', selectFrom: 9, selectTo: 9 },
    { label: 'rowspan', insertText: 'rowspan=""', selectFrom: 9, selectTo: 9 },
  ],
  time: [{ label: 'datetime', insertText: 'datetime=""', selectFrom: 10, selectTo: 10 }],
}

const MARKDOWN_SNIPPETS: MarkdownSnippetSpec[] = [
  { id: 'heading-1', label: '#', insertText: '# ', selectFrom: 2, selectTo: 2 },
  { id: 'heading-2', label: '##', insertText: '## ', selectFrom: 3, selectTo: 3 },
  { id: 'heading-3', label: '###', insertText: '### ', selectFrom: 4, selectTo: 4 },
  { id: 'bullet', label: '-', insertText: '- ', selectFrom: 2, selectTo: 2 },
  { id: 'ordered', label: '1.', insertText: '1. ', selectFrom: 3, selectTo: 3 },
  { id: 'task', label: '- [ ]', insertText: '- [ ] ', selectFrom: 6, selectTo: 6 },
  { id: 'quote', label: '>', insertText: '> ', selectFrom: 2, selectTo: 2 },
  { id: 'link', label: '[]()', insertText: '[text](https://)', selectFrom: 1, selectTo: 5 },
  { id: 'image', label: '![]()', insertText: '![alt](https://)', selectFrom: 2, selectTo: 5 },
  { id: 'inline-code', label: '``', insertText: '`code`', selectFrom: 1, selectTo: 5 },
  { id: 'code-block', label: '```', insertText: '```\n\n```', selectFrom: 4, selectTo: 4 },
  {
    id: 'table',
    label: '| |',
    insertText: '| Header | Value |\n| --- | --- |\n| Cell | Value |',
    selectFrom: 2,
    selectTo: 8,
  },
  { id: 'footnote', label: '[^1]', insertText: '[^1]', selectFrom: 4, selectTo: 4 },
  { id: 'divider', label: '---', insertText: '---', selectFrom: 3, selectTo: 3 },
]

function compactDetail(value: string) {
  return value.replace(/\s*\n\s*/g, ' ↵ ').replace(/\s{2,}/g, ' ').trim()
}

function completion(
  id: string,
  label: string,
  detail: string,
  kind: SourceCompletionKind,
  from: number,
  to: number,
  insertText: string,
  selectFrom = insertText.length,
  selectTo = selectFrom,
): SourceCompletion {
  return { id, label, detail, kind, from, to, insertText, selectFrom, selectTo }
}

function htmlElementCompletion(spec: HtmlElementSpec, from: number, to: number, closing = false) {
  if (closing) {
    const insertText = `</${spec.tag}>`
    return completion(
      `html-close-${spec.tag}`,
      `/${spec.tag}`,
      insertText,
      'element',
      from,
      to,
      insertText,
    )
  }

  const open = `<${spec.tag}>`
  const insertText = spec.insertText
    ?? (HTML_VOID_ELEMENTS.has(spec.tag) ? open : `${open}</${spec.tag}>`)
  const caret = spec.selectFrom ?? open.length
  return completion(
    `html-element-${spec.tag}`,
    spec.tag,
    compactDetail(insertText),
    'element',
    from,
    to,
    insertText,
    caret,
    spec.selectTo ?? caret,
  )
}

function htmlAttributeCompletion(spec: HtmlAttributeSpec, tag: string, from: number, to: number) {
  const caret = spec.selectFrom ?? spec.insertText.length
  return completion(
    `html-attribute-${tag}-${spec.label}`,
    spec.label,
    spec.insertText,
    'attribute',
    from,
    to,
    spec.insertText,
    caret,
    spec.selectTo ?? caret,
  )
}

function unclosedQuote(value: string) {
  const doubleQuotes = (value.match(/"/g) ?? []).length
  const singleQuotes = (value.match(/'/g) ?? []).length
  return doubleQuotes % 2 !== 0 || singleQuotes % 2 !== 0
}

function matchesPrefix(label: string, prefix: string) {
  if (!prefix) return true
  const normalizedLabel = label.toLowerCase()
  const normalizedPrefix = prefix.toLowerCase()
  return normalizedLabel.startsWith(normalizedPrefix)
    || normalizedLabel.replaceAll('-', '').startsWith(normalizedPrefix.replaceAll('-', ''))
}

function htmlCompletions(value: string, caret: number, force: boolean, format: SourceCompletionFormat) {
  const before = value.slice(0, caret)
  const closingMatch = before.match(/<\/([a-z][\w:-]*)?$/i)
  if (closingMatch) {
    const prefix = closingMatch[1] ?? ''
    const from = caret - closingMatch[0].length
    return HTML_ELEMENT_SPECS
      .filter((spec) => !HTML_VOID_ELEMENTS.has(spec.tag) && matchesPrefix(spec.tag, prefix))
      .slice(0, 8)
      .map((spec) => htmlElementCompletion(spec, from, caret, true))
  }

  const openingMatch = before.match(/<([a-z][\w:-]*)?$/i)
  if (openingMatch) {
    const prefix = openingMatch[1] ?? ''
    const from = caret - openingMatch[0].length
    return HTML_ELEMENT_SPECS
      .filter((spec) => matchesPrefix(spec.tag, prefix))
      .slice(0, 8)
      .map((spec) => htmlElementCompletion(spec, from, caret))
  }

  const openTagMatch = before.match(/<([a-z][\w:-]*)([^<>]*)$/i)
  if (openTagMatch && !unclosedQuote(openTagMatch[2])) {
    const attributeMatch = openTagMatch[2].match(/(?:^|\s)([a-z:@][\w:.-]*)?$/i)
    if (attributeMatch) {
      const tag = openTagMatch[1].toLowerCase()
      const prefix = attributeMatch[1] ?? ''
      const from = caret - prefix.length
      const tagAttributes = HTML_ATTRIBUTES_BY_TAG[tag] ?? []
      const seen = new Set<string>()
      return [...tagAttributes, ...GLOBAL_HTML_ATTRIBUTES]
        .filter((spec) => {
          if (seen.has(spec.label) || !matchesPrefix(spec.label, prefix)) return false
          seen.add(spec.label)
          return true
        })
        .slice(0, 8)
        .map((spec) => htmlAttributeCompletion(spec, tag, from, caret))
    }
  }

  if (!force || format !== 'html') return []
  return HTML_ELEMENT_SPECS
    .slice(0, 8)
    .map((spec) => htmlElementCompletion(spec, caret, caret))
}

function markdownCompletions(value: string, caret: number, force: boolean) {
  const before = value.slice(0, caret)
  const inlineMatch = before.match(/(?:^|[^\S\n])(!?\[|\[\^|`{1,3})$/)
  if (inlineMatch) {
    const prefix = inlineMatch[1]
    const from = caret - prefix.length
    return MARKDOWN_SNIPPETS
      .filter((spec) => spec.insertText.startsWith(prefix))
      .map((spec) => completion(
        `markdown-${spec.id}`,
        spec.label,
        compactDetail(spec.insertText),
        'snippet',
        from,
        caret,
        spec.insertText,
        spec.selectFrom,
        spec.selectTo,
      ))
  }

  const lineStart = before.lastIndexOf('\n') + 1
  const lineBeforeCaret = before.slice(lineStart)
  const indentation = lineBeforeCaret.match(/^\s*/)?.[0] ?? ''
  const fragment = lineBeforeCaret.slice(indentation.length)
  const slashTriggered = fragment === '/'
  const lineTriggered = /^(?:#{1,3}|[-*+]|\d?\.?|>|!|\[|\[\^|`{1,3}|\|)$/.test(fragment)
    && fragment.length > 0
  if (!force && !slashTriggered && !lineTriggered) return []

  const from = slashTriggered ? lineStart + indentation.length : force ? caret : lineStart + indentation.length
  const prefix = slashTriggered || force ? '' : fragment
  return MARKDOWN_SNIPPETS
    .filter((spec) => !prefix || spec.insertText.startsWith(prefix))
    .map((spec) => completion(
      `markdown-${spec.id}`,
      spec.label,
      compactDetail(spec.insertText),
      'snippet',
      from,
      caret,
      spec.insertText,
      spec.selectFrom,
      spec.selectTo,
    ))
}

export function getSourceCompletions(
  value: string,
  caret: number,
  format: SourceCompletionFormat,
  force = false,
) {
  const safeCaret = Math.max(0, Math.min(caret, value.length))
  const htmlItems = htmlCompletions(value, safeCaret, force, format)
  if (htmlItems.length > 0) return htmlItems
  return markdownCompletions(value, safeCaret, force)
}

export function getHtmlAutoCloseEdit(value: string, caret: number) {
  const safeCaret = Math.max(0, Math.min(caret, value.length))
  const before = value.slice(0, safeCaret)
  const match = before.match(/<([a-z][\w:-]*)(?:\s+[^<>]*)?$/i)
  if (!match || unclosedQuote(match[0]) || /\/\s*$/.test(match[0])) return null
  const tag = match[1].toLowerCase()
  if (HTML_VOID_ELEMENTS.has(tag)) {
    return { insertText: '>', caretOffset: 1 }
  }
  const closingTag = `</${tag}>`
  if (value.slice(safeCaret).startsWith(closingTag)) {
    return { insertText: '>', caretOffset: 1 }
  }
  return { insertText: `>${closingTag}`, caretOffset: 1 }
}
