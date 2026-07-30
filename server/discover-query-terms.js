import { discoverDisciplineExpansionForTerm } from './discover-discipline-taxonomy.js'

function splitTerms(value) {
  return String(value || '')
    .split(/[\n,，、;；|/]+/)
    .map((term) => term.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

/**
 * Preserve the user's terms while adding stable English search aliases for
 * common Chinese research fields. The aliases improve official-page and
 * scholarly-index retrieval only; they never translate saved user content.
 */
export function expandDiscoverResearchTerms(values, { limit = 24 } = {}) {
  const input = (Array.isArray(values) ? values : [values]).flatMap(splitTerms)
  const output = []
  const seen = new Set()
  const add = (value) => {
    const term = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    const key = term.toLocaleLowerCase()
    if (!term || seen.has(key) || output.length >= Math.max(1, Math.min(64, Number(limit) || 24))) return
    seen.add(key)
    output.push(term)
  }
  for (const term of input) {
    discoverDisciplineExpansionForTerm(term).canonical.forEach(add)
    add(term)
  }
  for (const term of input) {
    discoverDisciplineExpansionForTerm(term).related.forEach(add)
  }
  return output
}
