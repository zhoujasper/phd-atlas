/**
 * Provenance links, ordered the way somebody checking a claim would want them.
 *
 * A record used to link straight to the JSON endpoint it was parsed from,
 * which answers "where did this come from" with a wall of API output. What a
 * person -- or an agent following the link on their behalf -- actually needs
 * is the readable page first, then somewhere to keep looking, and only then
 * the raw response for anyone who wants to audit the parse.
 *
 * Every link here is built from the record's own fields. Nothing is guessed:
 * a search link is offered as a search, never as evidence.
 */

import { searchablePersonName } from './sourceRelevance.js'

const KIND = Object.freeze({
  PRIMARY: 'primary',
  SEARCH: 'search',
  RAW: 'raw',
})

function query(value) {
  return encodeURIComponent(String(value ?? '').trim())
}

function link(kind, id, label, url) {
  return url ? { kind, id, label, url } : null
}

/**
 * Public search pages for one person, usable whether or not this particular
 * record matched. These are where an agent should go to keep investigating.
 */
export function advisorSearchLinks({ name, institution }) {
  // Agency search pages behave like their APIs: a leading "Prof." matches
  // nothing. Send the same normalized name the queries use.
  const person = searchablePersonName(name)
  if (!person) return []
  const withInstitution = [person, String(institution ?? '').trim()].filter(Boolean).join(' ')
  return [
    link(KIND.SEARCH, 'nsf-search', 'NSF Award Search',
      `https://www.nsf.gov/awardsearch/simpleSearchResult?queryText=${query(person)}`),
    link(KIND.SEARCH, 'nih-search', 'NIH RePORTER',
      `https://reporter.nih.gov/search/?fy=active&pi_name=${query(person)}`),
    link(KIND.SEARCH, 'ukri-search', 'UKRI Gateway to Research',
      `https://gtr.ukri.org/search/person?fetchSize=25&selectedSortOrder=&selectedSortableField=&term=${query(person)}`),
    link(KIND.SEARCH, 'openalex-search', 'OpenAlex',
      `https://openalex.org/works?search=${query(person)}`),
    link(KIND.SEARCH, 'scholar-search', 'Google Scholar',
      `https://scholar.google.com/scholar?q=${query(withInstitution)}`),
  ].filter(Boolean)
}

/** Public search pages for one programme's admission results. */
export function programSearchLinks({ school, program }) {
  const institution = String(school ?? '').trim()
  const field = String(program ?? '').trim()
  if (!institution && !field) return []
  const combined = [institution, field].filter(Boolean).join(' ')
  return [
    link(KIND.SEARCH, 'gradcafe-search', 'The GradCafe',
      `https://www.thegradcafe.com/survey/?q=${query(combined)}`),
    link(KIND.SEARCH, 'reddit-search', 'r/gradadmissions',
      `https://www.reddit.com/r/gradadmissions/search/?q=${query(combined)}&restrict_sr=1`),
  ].filter(Boolean)
}

/**
 * The ordered link set for one record: the page it lives on, then places to
 * keep looking, then the API response it was parsed from.
 */
export function recordLinks(record, context = {}) {
  const value = record?.value ?? {}
  const links = []
  const push = (candidate) => {
    if (candidate && !links.some((existing) => existing.url === candidate.url)) links.push(candidate)
  }

  const primaryLabel = context.primaryLabel || 'Open the source page'
  push(link(KIND.PRIMARY, 'primary', primaryLabel, value.detailUrl || record?.sourceUrl))

  for (const searchLink of context.searchLinks ?? []) push(searchLink)

  // Last, and clearly labelled as the raw response rather than a source page.
  push(link(KIND.RAW, 'raw', 'Raw API response', record?.apiUrl))
  return links
}
