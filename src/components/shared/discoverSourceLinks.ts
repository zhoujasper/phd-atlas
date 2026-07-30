export function uniqueDiscoverSourceLinks(sources: readonly string[]) {
  return Array.from(new Set(sources.filter(Boolean)))
}
