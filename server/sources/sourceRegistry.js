import { validateSourceConfig } from './sourceSchemas.js'
import { SourceConfigurationError } from './sourceErrors.js'

import { nsfAwardsSource } from './nsfAwards.js'
import { nihReporterSource } from './nihReporter.js'
import { openalexWorksSource } from './openalexWorks.js'
import { gradcafeResultsSource } from './gradcafeResults.js'
import { redditSubmissionsSource } from './redditSubmissions.js'

export const PHASE12_SOURCE_ADAPTERS = Object.freeze([
  nsfAwardsSource,
  nihReporterSource,
  openalexWorksSource,
  gradcafeResultsSource,
  redditSubmissionsSource,
])

export const PHASE12_SOURCE_REGISTRY = Object.freeze(
  PHASE12_SOURCE_ADAPTERS.map((adapter) => adapter.config),
)

export function validatePhase12Registry(registry = PHASE12_SOURCE_REGISTRY) {
  const errors = []
  const ids = new Set()
  for (const config of registry || []) {
    try {
      const validated = validateSourceConfig(config)
      if (ids.has(validated.id)) errors.push(`${validated.id}: duplicate source id`)
      ids.add(validated.id)
    } catch (error) {
      errors.push(error?.message || 'invalid source config')
    }
  }
  return {
    passed: errors.length === 0,
    sourceCount: registry?.length || 0,
    sourceIds: [...ids],
    errors,
  }
}

export function getPhase12SourceConfig(id) {
  const found = PHASE12_SOURCE_REGISTRY.find((source) => source.id === id)
  if (!found) {
    throw new SourceConfigurationError(`Unknown Phase 12 source id: ${id}`)
  }
  return found
}
