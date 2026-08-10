import type { ScoredDiscoverPi, ScoredDiscoverProgram } from '../../data/discover'

export function normalizeDiscoverQuery(value: string) {
  return value.trim().normalize('NFKC').toLocaleLowerCase()
}

export function programMatchesDiscoverQuery(program: ScoredDiscoverProgram, normalizedQuery: string) {
  if (!normalizedQuery) return true
  const requirements = [
    ...(program.requirements?.materials || []).map((item) => item.name),
    ...(program.requirements?.tests || []).map((item) => `${item.name} ${item.status}`),
  ]
  const advisors = (program.pis || []).flatMap((pi) => [
    pi.name,
    pi.email || '',
    pi.research,
    pi.whyFit,
    pi.recruiting,
    pi.labSize,
    pi.category,
  ])
  return [
    program.school,
    program.program,
    program.city,
    program.country,
    program.researchFocus,
    program.fitRationale,
    ...requirements,
    ...(program.tags || []),
    ...advisors,
  ].join(' ').normalize('NFKC').toLocaleLowerCase().includes(normalizedQuery)
}

export function piMatchesDiscoverQuery(pi: ScoredDiscoverPi, normalizedQuery: string) {
  if (!normalizedQuery) return true
  return [pi.name, pi.email || '', pi.school, pi.program, pi.research, pi.whyFit, pi.recruiting, pi.labSize]
    .join(' ')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .includes(normalizedQuery)
}
