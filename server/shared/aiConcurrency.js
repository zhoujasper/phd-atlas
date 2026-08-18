export const AI_KEY_DEFAULT_MAX_CONCURRENCY = 4
export const AI_KEY_MAX_CONCURRENCY = 2_500

export function normalizeAiKeyMaxConcurrency(value, fallback = AI_KEY_DEFAULT_MAX_CONCURRENCY) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(AI_KEY_MAX_CONCURRENCY, Math.max(1, Math.floor(parsed)))
}
