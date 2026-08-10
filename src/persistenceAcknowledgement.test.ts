import { describe, expect, it } from 'vitest'
import { applications } from './data/applications'
import {
  applicationPersistenceAcknowledged,
  applicationPersistenceExpectation,
  persistedSubsetMatches,
} from './persistenceAcknowledgement'

describe('persistedSubsetMatches', () => {
  it('accepts server-owned additions while requiring every submitted nested field', () => {
    expect(persistedSubsetMatches(
      {
        writingBrief: {
          sections: [{ id: 'evidence', title: 'Evidence', content: 'Saved body', width: 'full' }],
        },
      },
      {
        id: 'asset-1',
        writingBrief: {
          requirements: '',
          sections: [{ id: 'evidence', title: 'Evidence', content: 'Saved body', width: 'full' }],
        },
        updatedAt: '2026-08-02T10:00:00.000Z',
      },
    )).toBe(true)
  })

  it('rejects a successful-looking response that silently strips a new field', () => {
    expect(persistedSubsetMatches(
      {
        recommenders: [{ id: 'teacher-1', name: 'Professor Ada', contact: 'ada@example.edu' }],
      },
      {
        id: 'application-1',
        updatedAt: '2026-08-02T10:00:00.000Z',
      },
    )).toBe(false)
  })

  it('requires every changed application field, not only recommenders', () => {
    const baseline = structuredClone(applications[0])
    const submitted = { ...baseline, program: 'Human-Centred AI PhD' }
    const incompleteCanonical = {
      ...submitted,
      program: baseline.program,
      updatedAt: '2026-08-02T10:00:00.000Z',
    }

    expect(applicationPersistenceExpectation(submitted, baseline)).toEqual({
      id: submitted.id,
      program: 'Human-Centred AI PhD',
    })
    expect(applicationPersistenceAcknowledged(
      submitted,
      incompleteCanonical,
      baseline,
    )).toBe(false)
  })

  it('ignores server-authoritative volatile fields while acknowledging the edited field', () => {
    const baseline = structuredClone(applications[0])
    const submitted = { ...baseline, priority: 97 }
    const canonical = {
      ...submitted,
      ownerId: 'server-owner',
      updatedAt: '2026-08-02T10:00:00.000Z',
      versions: [{
        id: 'server-version',
        file: 'snapshot.json',
        author: 'Server',
        createdAt: '2026-08-02T10:00:00.000Z',
      }],
    }

    expect(applicationPersistenceAcknowledged(submitted, canonical, baseline)).toBe(true)
  })
})
