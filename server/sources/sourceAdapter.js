import { validateProvenanceRecord, validateSourceConfig } from './sourceSchemas.js'
import { SourceConfigurationError } from './sourceErrors.js'
import { createSourceHttpClient } from './sourceHttpClient.js'

function runtimeSource(source, options = {}) {
  const retry = options.retry ? { ...source.retry, ...options.retry } : source.retry
  return {
    ...source,
    timeoutMs: options.timeoutMs ?? source.timeoutMs,
    rateLimitPerMin: options.rateLimitPerMin ?? source.rateLimitPerMin,
    cacheTtlMs: options.cacheTtlMs ?? source.cacheTtlMs,
    retry,
  }
}

/**
 * Standard Phase 12 adapter shape. An adapter receives a normalized config and
 * returns records carrying provenance; this runner rejects any record that
 * would enter the system without a source link, fetch time, or confidence.
 */
export function createSourceAdapter(config, impl) {
  const source = validateSourceConfig(config)
  if (typeof impl !== 'function') {
    throw new SourceConfigurationError(`Source adapter ${source.id} requires an implementation.`)
  }
  return Object.freeze({
    config: source,
    async run(query = {}, options = {}) {
      if (!source.enabled) {
        return {
          sourceId: source.id,
          status: 'disabled',
          records: [],
          warnings: ['Source is disabled by configuration.'],
          meta: {
            checkedAt: options.now ? new Date(options.now()).toISOString() : new Date().toISOString(),
          },
        }
      }
      const result = await impl(query, {
        source: runtimeSource(source, options),
        ...options,
      })
      const records = (result?.records || []).map((record) => validateProvenanceRecord(record, source.id))
      return {
        sourceId: source.id,
        status: records.length ? 'ok' : 'empty',
        records,
        warnings: result?.warnings || [],
        meta: {
          ...(result?.meta || {}),
          checkedAt: options.now ? new Date(options.now()).toISOString() : new Date().toISOString(),
        },
      }
    },
  })
}

export function httpClientFor(context) {
  if (context?.httpClient) return context.httpClient
  return createSourceHttpClient({
    fetchImpl: context?.fetchImpl,
    cache: context?.cache,
    now: context?.now,
    delayFn: context?.delayFn,
    maxConcurrency: context?.maxConcurrency ?? context?.source?.concurrency,
  })
}
