import { isIP } from 'node:net'

const REQUIRED_SEED_KINDS = Object.freeze(['faculty', 'departments', 'research', 'doctoral'])
const REQUIRED_HINT_GROUPS = Object.freeze(['faculty', 'lab', 'department', 'program'])
const MAX_URL_LENGTH = 2_048

function cleanHost(value) {
  return String(value || '').trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '')
}

function arrayOf(value) {
  return Array.isArray(value) ? value : []
}

function publicDomainHost(value) {
  const host = cleanHost(value)
  if (
    !host
    || host.length > 253
    || !host.includes('.')
    || isIP(host.replace(/^\[|\]$/g, ''))
    || host === 'localhost'
    || /\.(?:localhost|local|internal|lan|home)$/.test(host)
    || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host)
  ) return null
  return host
}

function allowedHost(hostname, declaredHosts) {
  const host = publicDomainHost(hostname)
  if (!host) return false
  return declaredHosts.some((declared) => host === declared || host.endsWith(`.${declared}`))
}

function canonicalSeedUrl(value) {
  try {
    const url = new URL(String(value || ''))
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || (url.port && url.port !== '443')
      || url.href.length > MAX_URL_LENGTH
      || !publicDomainHost(url.hostname)
    ) return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function uniqueStrings(values) {
  return [...new Set(arrayOf(values).map((value) => String(value || '').trim()).filter(Boolean))]
}

function mergePathHints(left = {}, right = {}) {
  return Object.fromEntries(REQUIRED_HINT_GROUPS.map((key) => [
    key,
    uniqueStrings([...arrayOf(left[key]), ...arrayOf(right[key])]),
  ]))
}

function mergeAdapter(left, right) {
  const seeds = new Map()
  for (const seed of [...arrayOf(left?.seeds), ...arrayOf(right?.seeds)]) {
    if (!seed?.kind || !seed?.url) continue
    const canonical = canonicalSeedUrl(seed.url)
    const url = canonical || String(seed.url).trim()
    seeds.set(`${seed.kind}|${url}`, { kind: seed.kind, url })
  }
  return {
    school: right.school,
    region: right.region || left?.region || '',
    allowedHosts: uniqueStrings([...arrayOf(left?.allowedHosts), ...arrayOf(right.allowedHosts)]).map(cleanHost),
    seeds: [...seeds.values()],
    pathHints: mergePathHints(left?.pathHints, right.pathHints),
    verifiedAt: [left?.verifiedAt, right.verifiedAt].filter(Boolean).sort().at(-1) || '',
  }
}

/**
 * Merge batch overlap by school. Overlap is useful during source maintenance:
 * two independently checked batches may contribute different official hosts,
 * but the crawler still receives one bounded adapter for that university.
 */
export function mergeSchoolAdapterBatches(batches) {
  const bySchool = new Map()
  for (const adapter of arrayOf(batches).flatMap(arrayOf)) {
    const school = String(adapter?.school || '').trim()
    if (!school) continue
    bySchool.set(school, mergeAdapter(bySchool.get(school), { ...adapter, school }))
  }
  return [...bySchool.values()].sort((left, right) => left.school.localeCompare(right.school))
}

/**
 * Structural acceptance gate for the 100+ school-specific crawler promise.
 * A homepage row cannot satisfy this: every covered school must declare four
 * separately typed entry points and the path signals used to fan out into
 * individual faculty, lab, department and doctoral-program pages.
 */
export function validateSchoolAdapterCoverage(adapters, registry = [], { minimumSchools = 100 } = {}) {
  const expected = new Map((registry || []).map((source) => [source.school, source]))
  const errors = []
  const schools = new Set()

  for (const adapter of adapters || []) {
    const school = String(adapter?.school || '').trim()
    if (!school) {
      errors.push('adapter: missing school')
      continue
    }
    if (schools.has(school)) errors.push(`${school}: duplicate adapter after merge`)
    schools.add(school)
    const source = expected.get(school)
    if (expected.size && !source) errors.push(`${school}: not present in curated school registry`)
    if (source && adapter.region !== source.region) errors.push(`${school}: region does not match registry`)

    const declaredHosts = uniqueStrings(adapter.allowedHosts).map(cleanHost)
    if (!declaredHosts.length) errors.push(`${school}: no allowedHosts`)
    const kinds = new Set()
    for (const seed of adapter.seeds || []) {
      kinds.add(seed?.kind)
      let url
      try {
        url = new URL(String(seed?.url || ''))
      } catch {
        errors.push(`${school}: invalid seed URL ${String(seed?.url || '')}`)
        continue
      }
      if (url.protocol !== 'https:' || url.username || url.password) {
        errors.push(`${school}: seed must be credential-free HTTPS (${url.href})`)
      } else if (!allowedHost(url.hostname, declaredHosts)) {
        errors.push(`${school}: seed host is outside allowedHosts (${url.hostname})`)
      }
    }
    for (const kind of REQUIRED_SEED_KINDS) {
      if (!kinds.has(kind)) errors.push(`${school}: missing ${kind} seed`)
    }
    for (const group of REQUIRED_HINT_GROUPS) {
      if (!uniqueStrings(adapter.pathHints?.[group]).length) errors.push(`${school}: missing ${group} path hints`)
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(adapter.verifiedAt || ''))) {
      errors.push(`${school}: verifiedAt must be YYYY-MM-DD`)
    }
  }

  const missingSchools = [...expected.keys()].filter((school) => !schools.has(school))
  const extraSchools = [...schools].filter((school) => expected.size && !expected.has(school))
  if (schools.size < minimumSchools) errors.push(`coverage: ${schools.size} schools is below required ${minimumSchools}`)
  if (missingSchools.length) errors.push(`coverage: missing ${missingSchools.length} registry schools`)

  return {
    passed: errors.length === 0,
    requiredSchoolCount: minimumSchools,
    registrySchoolCount: expected.size,
    coveredSchoolCount: schools.size,
    fullyTypedSchoolCount: (adapters || []).filter((adapter) => {
      const kinds = new Set((adapter.seeds || []).map((seed) => seed.kind))
      return REQUIRED_SEED_KINDS.every((kind) => kinds.has(kind))
    }).length,
    seedCount: (adapters || []).reduce((total, adapter) => total + (adapter.seeds?.length || 0), 0),
    missingSchools,
    extraSchools,
    errors,
  }
}

export { REQUIRED_HINT_GROUPS, REQUIRED_SEED_KINDS }
