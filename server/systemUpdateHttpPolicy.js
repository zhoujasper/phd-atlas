export function usesSystemUpdateMutationBudget(method) {
  const normalized = String(method ?? '').toUpperCase()
  return normalized !== 'GET' && normalized !== 'HEAD'
}
