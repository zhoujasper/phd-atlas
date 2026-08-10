import { cleanOptionalText } from './sourceSchemas.js'
import { SourceStructureChangedError } from './sourceErrors.js'
import { httpClientFor, createSourceAdapter } from './sourceAdapter.js'
import { provenanceRecord } from './sourceProvenance.js'
import {
  childElements,
  cleanText,
  findByTag,
  parseHtml,
  textContent,
} from './sourceHtml.js'

export const GRADCAFE_BASE_URL = 'https://www.thegradcafe.com/survey/'

const DECISION_PATTERN = /\b(?:accepted|admitted|wait\s*listed|waitlisted|rejected|interview|pending)\b/i
const DATE_PATTERN = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}|[A-Za-z]{3,}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})\b/

export function buildGradCafeResultsUrl(query = {}, config = {}) {
  const url = new URL(config.baseUrl || GRADCAFE_BASE_URL)
  const optional = [
    ['q', query.keyword],
    ['school', query.school],
    ['program', query.program],
    ['type', query.type],
    ['sort', query.sort],
  ]
  for (const [name, value] of optional) {
    const text = cleanOptionalText(value, 240)
    if (text) url.searchParams.set(name, text)
  }
  if (query.year) url.searchParams.set('year', String(query.year))
  return url
}

function hasClass(element, className) {
  const values = element?.properties?.className
  return Array.isArray(values) ? values.includes(className) : String(values || '').split(/\s+/).includes(className)
}

function absoluteHref(href, baseUrl) {
  if (!href) return null
  try {
    return new URL(String(href), baseUrl).toString()
  } catch {
    return null
  }
}

function rowCells(row) {
  const cells = childElements(row).filter((child) => ['td', 'th'].includes(child.tagName))
  return cells.length ? cells : childElements(row).flatMap((child) => findByTag(child, 'td'))
}

function schoolFromCells(cells) {
  const explicit = cells.find((cell) => hasClass(cell, 'school') || hasClass(cell, 'institution'))
  if (explicit) return cleanText(textContent(explicit))
  const first = cleanText(textContent(cells[0]))
  if (first && /university|college|institute|school/i.test(first)) return first
  return first
}

function programFromCells(cells) {
  const explicit = cells.find((cell) => hasClass(cell, 'program'))
  if (explicit) return cleanText(textContent(explicit))
  return cleanText(textContent(cells[1]))
}

function decisionFromCells(cells) {
  const explicit = cells.find((cell) => (
    hasClass(cell, 'decision')
    || hasClass(cell, 'decision-status')
    || hasClass(cell, 'result')
    || DECISION_PATTERN.test(cleanText(textContent(cell)))
  ))
  if (!explicit) return null
  const text = cleanText(textContent(explicit))
  return text.match(DECISION_PATTERN)?.[0]?.toLowerCase() || null
}

function dateFromCells(cells) {
  const time = cells.flatMap((cell) => findByTag(cell, 'time'))
  const dateTime = time.map((node) => cleanOptionalText(node?.properties?.dateTime, 40)).find(Boolean)
  if (dateTime) return dateTime
  const explicit = cells.find((cell) => (
    hasClass(cell, 'date')
    || hasClass(cell, 'decision-date')
    || DATE_PATTERN.test(cleanText(textContent(cell)))
  ))
  return explicit ? (cleanText(textContent(explicit)).match(DATE_PATTERN)?.[0] || null) : null
}

function linkFromCells(cells, baseUrl) {
  for (const cell of cells) {
    const hrefs = findByTag(cell, 'a').map((link) => absoluteHref(link?.properties?.href, baseUrl)).filter(Boolean)
    if (hrefs.length) return hrefs[0]
  }
  return null
}

function extractGradCafeRows(tree, pageUrl) {
  const tables = findByTag(tree, 'table')
  const surveyTable = tables.find((table) => {
    const headers = findByTag(table, 'th').map((cell) => cleanText(textContent(cell)).toLowerCase())
    return headers.some((header) => /school|institution/.test(header))
      && headers.some((header) => /program/.test(header))
      && headers.some((header) => /decision|result|status/.test(header))
  })
  if (!surveyTable) {
    throw new SourceStructureChangedError(
      'GradCafe result page no longer exposes a table with School/Program/Decision headers.',
      'gradcafe-results',
    )
  }

  const warnings = []
  const records = []
  for (const row of findByTag(surveyTable, 'tr')) {
    const cells = rowCells(row)
    const school = schoolFromCells(cells)
    const program = programFromCells(cells)
    const decision = decisionFromCells(cells)
    if (!school || !program || !decision) {
      warnings.push(`Skipped GradCafe row without school/program/decision: ${cleanText(textContent(row), 240)}`)
      continue
    }
    const date = dateFromCells(cells)
    const sourceUrl = linkFromCells(cells, pageUrl) || pageUrl
    records.push({
      school,
      program,
      decision,
      date,
      detailUrl: sourceUrl,
      rawText: cleanText(textContent(row), 800),
    })
  }
  return { records, warnings }
}

export function parseGradCafeResultsHtml(html, context = {}) {
  const tree = parseHtml(String(html ?? ''))
  const pageUrl = context.sourceUrl || GRADCAFE_BASE_URL
  const extracted = extractGradCafeRows(tree, pageUrl)
  const sourceId = context.sourceId || 'gradcafe-results'
  const fetchedAt = context.fetchedAt || new Date().toISOString()
  return {
    records: extracted.records.map((row) => provenanceRecord({
      kind: 'gradcafe:result',
      value: row,
      sourceId,
      sourceUrl: row.detailUrl || pageUrl,
      fetchedAt,
      confidence: 0.85,
    })),
    warnings: extracted.warnings,
  }
}

async function gradcafeResultsImpl(query, context) {
  const http = httpClientFor(context)
  const requestUrl = buildGradCafeResultsUrl(query, context.source).toString()
  const fetched = await http.fetchText(requestUrl, {
    source: context.source,
    headers: {
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
    },
    cacheKey: `gradcafe-results:${requestUrl}`,
  })
  const parsed = parseGradCafeResultsHtml(fetched.text, {
    sourceId: context.source.id,
    sourceUrl: fetched.sourceUrl || requestUrl,
    fetchedAt: fetched.fetchedAt,
  })
  return {
    records: parsed.records,
    warnings: parsed.warnings,
    meta: {
      requestUrl,
      skippedInvalidRows: parsed.warnings.length,
    },
  }
}

export const gradcafeResultsSource = createSourceAdapter({
  id: 'gradcafe-results',
  name: 'GradCafe Survey Results',
  kind: 'html',
  baseUrl: GRADCAFE_BASE_URL,
  enabled: true,
  rateLimitPerMin: 20,
  concurrency: 1,
  cacheTtlMs: 24 * 60 * 60 * 1_000,
  userAgent: 'PhDAtlasPhase12/0.1 (+https://phd-atlas.local/research; reference use only, no AI training)',
  robotsPolicy: 'respect',
  timeoutMs: 25_000,
  retry: {
    maxAttempts: 3,
    baseDelayMs: 500,
    maxDelayMs: 15_000,
    retryableStatuses: [429, 502, 503, 504],
    retryNetworkErrors: true,
  },
  description: 'GradCafe public survey pages allowed for reference use. Derived facts link back to the original page.',
}, gradcafeResultsImpl)
