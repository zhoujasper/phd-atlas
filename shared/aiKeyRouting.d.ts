export type AiKeyRequestMode = 'auto' | 'responses' | 'chat_completions'

export const AI_KEY_REQUEST_MODES: readonly AiKeyRequestMode[]
export const AI_KEY_DEFAULT_WEIGHT: 50
export const AI_KEY_MIN_WEIGHT: 1
export const AI_KEY_MAX_WEIGHT: 100

export function normalizeAiKeyRequestMode(value: unknown, provider?: string): AiKeyRequestMode
export function normalizeAiKeyWeight(value: unknown, fallback?: number): number
export function aiKeyIsEnabled(value: unknown): boolean
