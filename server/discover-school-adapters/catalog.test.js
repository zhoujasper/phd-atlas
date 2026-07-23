import { describe, expect, it } from 'vitest'
import {
  DISCOVER_SCHOOL_ADAPTERS,
  discoverSchoolAdapterFor,
} from './catalog.js'
import {
  DISCOVER_SCHOOL_ADAPTER_COVERAGE,
  DISCOVER_SOURCE_REGISTRY,
} from '../discover-source-registry.js'

const REQUIRED_KINDS = ['faculty', 'departments', 'research', 'doctoral']

describe('Discover school-adapter catalog', () => {
  it('covers every curated school with four separately typed official entry points', () => {
    expect(DISCOVER_SOURCE_REGISTRY).toHaveLength(145)
    expect(DISCOVER_SCHOOL_ADAPTERS).toHaveLength(145)
    expect(DISCOVER_SCHOOL_ADAPTER_COVERAGE).toMatchObject({
      passed: true,
      registrySchoolCount: 145,
      coveredSchoolCount: 145,
      fullyTypedSchoolCount: 145,
    })
    expect(DISCOVER_SCHOOL_ADAPTER_COVERAGE.seedCount).toBeGreaterThanOrEqual(580)

    for (const source of DISCOVER_SOURCE_REGISTRY) {
      const kinds = new Set(source.seeds.map((seed) => seed.kind))
      expect(REQUIRED_KINDS.every((kind) => kinds.has(kind)), source.school).toBe(true)
      expect(source.adapterVerifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(source.allowedHosts.length).toBeGreaterThan(0)
      expect(discoverSchoolAdapterFor(source.school)).not.toBeNull()
    }
  })

  it('keeps school names unique after independently verified batches are merged', () => {
    expect(new Set(DISCOVER_SCHOOL_ADAPTERS.map((adapter) => adapter.school)).size).toBe(145)
  })
})
