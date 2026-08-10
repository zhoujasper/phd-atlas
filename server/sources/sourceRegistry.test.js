import { describe, expect, it } from 'vitest'
import {
  PHASE12_SOURCE_REGISTRY,
  getPhase12SourceConfig,
  validatePhase12Registry,
} from './sourceRegistry.js'
import { SourceConfigurationError } from './sourceErrors.js'

describe('Phase 12 source registry', () => {
  it('validates the registry with all Phase 12 adapters', () => {
    const report = validatePhase12Registry(PHASE12_SOURCE_REGISTRY)
    expect(report.passed).toBe(true)
    expect(report.sourceCount).toBe(5)
    expect(report.sourceIds).toEqual([
      'nsf-awards',
      'nih-reporter',
      'openalex-works',
      'gradcafe-results',
      'reddit-submissions',
    ])
  })

  it('detects duplicate ids and invalid configs', () => {
    const report = validatePhase12Registry([
      { id: 'dup', name: 'A', kind: 'api', baseUrl: 'https://a.example.com' },
      { id: 'dup', name: 'B', kind: 'html', baseUrl: 'https://b.example.com' },
      { id: 'bad', name: 'Bad', kind: 'api', baseUrl: 'not-a-url' },
    ])
    expect(report.passed).toBe(false)
    expect(report.errors.join('\n')).toContain('duplicate source id')
  })

  it('throws for an unknown source id', () => {
    expect(() => getPhase12SourceConfig('missing')).toThrow(SourceConfigurationError)
  })
})
