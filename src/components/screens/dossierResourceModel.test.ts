import { describe, expect, it } from 'vitest'
import { applications } from '../../data/applications'
import {
  createDefaultDossierResourceCards,
  normalizeDossierResourceCards,
  normalizedExternalHref,
  resourceFieldSummary,
  resourceTags,
} from './dossierResourceModel'

const tx = (key: string) => key

describe('dossier resource model', () => {
  it('creates the same four application-aware default cards', () => {
    const draft = structuredClone(applications[0])
    const cards = createDefaultDossierResourceCards(draft, tx)

    expect(cards.map((card) => card.id)).toEqual([
      'default-application-portal',
      'default-program-page',
      'default-professor-contact',
      'default-requirements-notes',
    ])
    expect(cards[1].fields).toContainEqual(expect.objectContaining({
      id: 'default-program-website',
      value: draft.school.website,
    }))
    expect(cards[2].fields).toContainEqual(expect.objectContaining({
      id: 'default-professor-email',
      value: draft.professor.email,
    }))
    expect(cards[3].fields[0]).toMatchObject({
      type: 'tags',
      value: draft.tags.join(', '),
      width: 'full',
    })
  })

  it('normalizes malformed persisted cards without changing valid field values', () => {
    const draft = structuredClone(applications[0])
    const cards = normalizeDossierResourceCards([
      {
        id: '',
        title: null,
        icon: 'unknown-icon',
        color: 'neon',
        width: 'narrow',
        fields: [{ id: '', type: 'unsupported', label: null, value: null, width: 'narrow' }],
      },
    ] as unknown as typeof draft.dossierCards, draft, tx)

    expect(cards).toEqual([{
      id: 'resource-card-1',
      title: '',
      icon: 'link',
      color: 'accent',
      width: 'half',
      createdAt: undefined,
      updatedAt: undefined,
      fields: [{
        id: 'resource-card-1-field-1',
        type: 'text',
        label: '',
        value: '',
        width: 'half',
      }],
    }])
  })

  it('keeps resource summaries and safe click targets deterministic', () => {
    expect(resourceTags(' alpha，beta\n gamma,, ')).toEqual(['alpha', 'beta', 'gamma'])
    expect(resourceFieldSummary({ id: 'notes', type: 'textarea', label: 'Notes', value: '\n First line\nSecond line' })).toBe('First line')
    expect(normalizedExternalHref('example.edu/path')).toBe('https://example.edu/path')
    expect(normalizedExternalHref('javascript:alert(1)')).toBe('')
  })
})
