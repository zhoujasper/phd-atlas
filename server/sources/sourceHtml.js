import rehypeParse from 'rehype-parse'
import { unified } from 'unified'
import { SourceStructureChangedError } from './sourceErrors.js'

export function parseHtml(value) {
  const processor = unified().use(rehypeParse, { fragment: false })
  return processor.runSync(processor.parse(String(value ?? '')))
}

export function descendants(node, predicate) {
  const output = []
  const visit = (current) => {
    if (Array.isArray(current)) {
      for (const child of current) visit(child)
      return
    }
    if (!current || typeof current !== 'object') return
    if (predicate(current)) output.push(current)
    for (const child of current.children || []) visit(child)
  }
  visit(node)
  return output
}

export function findElements(node, predicate) {
  return descendants(node, predicate)
}

export function findByTag(node, tagName) {
  const wanted = String(tagName || '').toLowerCase()
  return findElements(node, (element) => element?.type === 'element' && element.tagName === wanted)
}

export function findByClass(node, className) {
  const wanted = String(className || '').trim()
  return findElements(node, (element) => (
    element?.type === 'element'
    && (Array.isArray(element.properties?.className)
      ? element.properties.className.includes(wanted)
      : String(element.properties?.className ?? '').split(/\s+/).includes(wanted))
  ))
}

export function childElements(node) {
  return (node?.children || []).filter((child) => child?.type === 'element')
}

export function textContent(node) {
  if (Array.isArray(node)) return node.map(textContent).join('')
  if (!node || typeof node !== 'object') return ''
  if (node.type === 'text') return String(node.value ?? '')
  if (node.type === 'element') {
    return (node.children || []).map((child) => {
      if (child?.type === 'element' && child.tagName === 'br') return ' '
      return textContent(child)
    }).join('')
  }
  return ''
}

export function cleanText(value, limit = 1_000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit)
}

export function requireElements(node, predicate, message, sourceId = '') {
  const found = findElements(node, predicate)
  if (!found.length) {
    throw new SourceStructureChangedError(message, sourceId)
  }
  return found
}

export function requireTableRows(tree, sourceId) {
  const tables = findByTag(tree, 'table')
  const rows = tables.flatMap((table) => findByTag(table, 'tr'))
  if (!rows.length) {
    throw new SourceStructureChangedError(
      'GradCafe result page no longer exposes a table with survey result rows.',
      sourceId,
    )
  }
  return rows
}
