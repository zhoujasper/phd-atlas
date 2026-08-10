import { z } from 'zod'
import { SourceConfigurationError } from './sourceErrors.js'

export const RetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(10).default(3),
  baseDelayMs: z.number().int().min(0).max(60_000).default(250),
  maxDelayMs: z.number().int().min(1).max(120_000).default(10_000),
  retryableStatuses: z.array(z.number().int().min(400).max(599)).default([429, 502, 503, 504]),
  retryNetworkErrors: z.boolean().default(true),
})

export const SourceConfigSchema = z.object({
  id: z.string().min(1).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'source id must be kebab-case'),
  name: z.string().min(1).max(120),
  kind: z.enum(['api', 'html']),
  baseUrl: z.string().url(),
  enabled: z.boolean().default(true),
  rateLimitPerMin: z.number().int().min(1).max(1_200).default(30),
  concurrency: z.number().int().min(1).max(16).default(1),
  cacheTtlMs: z.number().int().min(0).max(7 * 24 * 60 * 60 * 1_000).default(60 * 60 * 1_000),
  userAgent: z.string().min(1).max(300).default(
    'PhDAtlasPhase12/0.1 (+https://phd-atlas.local/research)',
  ),
  robotsPolicy: z.enum(['respect', 'override']).default('respect'),
  timeoutMs: z.number().int().min(100).max(120_000).default(20_000),
  retry: RetryPolicySchema.default({
    maxAttempts: 3,
    baseDelayMs: 250,
    maxDelayMs: 10_000,
    retryableStatuses: [429, 502, 503, 504],
    retryNetworkErrors: true,
  }),
  description: z.string().max(500).default(''),
}).passthrough()

export const ProvenanceSchema = z.object({
  value: z.unknown(),
  sourceId: z.string().min(1).max(64),
  sourceUrl: z.string().url(),
  fetchedAt: z.string().datetime({ offset: true }),
  confidence: z.number().min(0).max(1),
})

export const SourceRecordSchema = ProvenanceSchema.passthrough()

export function validateSourceConfig(value) {
  const parsed = SourceConfigSchema.safeParse(value ?? {})
  if (!parsed.success) {
    throw new SourceConfigurationError(
      `Invalid source config: ${parsed.error.issues.map((issue) => issue.path.join('.') || 'value').join(', ')}`,
      { details: parsed.error.issues },
    )
  }
  return parsed.data
}

export function validateProvenanceRecord(value, sourceId = '') {
  const parsed = SourceRecordSchema.safeParse(value)
  if (!parsed.success) {
    throw new SourceConfigurationError(
      `Invalid provenance record${sourceId ? ` for ${sourceId}` : ''}: ${parsed.error.issues
        .map((issue) => issue.path.join('.') || 'value')
        .join(', ')}`,
      { details: parsed.error.issues },
    )
  }
  return parsed.data
}

export function cleanOptionalText(value, limit = 1_000) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, limit) : null
}

export function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function cleanBooleanOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'boolean') return value
  const normalized = String(value).trim().toLowerCase()
  if (['true', '1', 'yes'].includes(normalized)) return true
  if (['false', '0', 'no'].includes(normalized)) return false
  return null
}
