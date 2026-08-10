export const AI_KEY_REQUEST_MODES = Object.freeze([
  'auto',
  'responses',
  'chat_completions',
])

export const AI_KEY_DEFAULT_WEIGHT = 50
export const AI_KEY_MIN_WEIGHT = 1
export const AI_KEY_MAX_WEIGHT = 100

export function normalizeAiKeyRequestMode(value, provider = 'openai') {
  if (!['openai', 'deepseek'].includes(String(provider || '').toLowerCase())) return 'auto'
  const normalized = String(value || '').trim().toLowerCase()
  return AI_KEY_REQUEST_MODES.includes(normalized) ? normalized : 'auto'
}

export function normalizeAiKeyWeight(value, fallback = AI_KEY_DEFAULT_WEIGHT) {
  const parsed = Number(value)
  const resolved = Number.isFinite(parsed) ? Math.round(parsed) : fallback
  return Math.min(AI_KEY_MAX_WEIGHT, Math.max(AI_KEY_MIN_WEIGHT, resolved))
}

export function aiKeyIsEnabled(value) {
  return value !== false && value !== 0 && value !== '0'
}
