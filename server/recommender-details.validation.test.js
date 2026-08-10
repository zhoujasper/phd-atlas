import { describe, expect, it } from 'vitest'
import { MaterialSchema as ClientMaterialSchema } from '../src/contracts/applicationSchemas.ts'
import { normalizeMaterial } from './index.js'
import { MaterialSchema as ServerMaterialSchema } from './validation.js'

function material(recommender) {
  return {
    id: 'recommendation-material',
    name: 'References',
    type: 'Recommendation Letter',
    status: 'Missing',
    group: 'Recommendations',
    requiredCount: 1,
    recommenders: [recommender],
    version: 'v0',
    updatedAt: '2026-08-01',
  }
}

describe.each([
  ['client', ClientMaterialSchema],
  ['server', ServerMaterialSchema],
])('%s recommender details validation', (_owner, schema) => {
  it('defaults optional application-specific planning fields for legacy records', () => {
    const parsed = schema.parse(
      material({
        id: 'slot-1',
        name: 'Prof. Ada',
        contact: 'ada@example.edu',
      }),
    )

    expect(parsed.recommenders[0]).toMatchObject({
      notes: '',
      deadline: '',
      deadlineTime: '',
      reminderDate: '',
      reminderTime: '',
    })
  })

  it('preserves valid notes, deadline time, and reminder details', () => {
    const parsed = schema.parse(
      material({
        id: 'slot-1',
        name: 'Prof. Ada',
        contact: 'ada@example.edu',
        profileId: 'profile-ada',
        notes: 'Ask for a research-focused letter.',
        deadline: '2026-11-20',
        deadlineTime: '17:30',
        reminderDate: '2026-11-10',
        reminderTime: '09:30',
      }),
    )

    expect(parsed.recommenders[0]).toMatchObject({
      profileId: 'profile-ada',
      notes: 'Ask for a research-focused letter.',
      deadline: '2026-11-20',
      deadlineTime: '17:30',
      reminderDate: '2026-11-10',
      reminderTime: '09:30',
    })
  })

  it('enforces the shared recommender field and per-application count bounds', () => {
    expect(schema.safeParse(material({
      id: 'x'.repeat(161),
      name: 'Prof. Ada',
      contact: 'ada@example.edu',
    })).success).toBe(false)
    expect(schema.safeParse(material({
      id: 'slot-1',
      name: 'x'.repeat(201),
      contact: 'ada@example.edu',
    })).success).toBe(false)
    expect(schema.safeParse(material({
      id: 'slot-1',
      name: 'Prof. Ada',
      contact: 'x'.repeat(321),
    })).success).toBe(false)
    expect(schema.safeParse({
      ...material({ id: 'slot-1', name: 'Prof. Ada', contact: 'ada@example.edu' }),
      recommenders: Array.from({ length: 13 }, (_, index) => ({
        id: `slot-${index}`,
        name: `Professor ${index}`,
        contact: '',
      })),
    }).success).toBe(false)
  })
})

describe('server recommender normalization', () => {
  it.each([
    ['Recommendation Letter', 'Custom', 'Reference'],
    ['Document', 'Recommendations', 'Reference'],
    ['Document', 'Custom', 'Recommendation form'],
  ])(
    'recognizes recommendation material type=%s group=%s name=%s',
    (type, group, name) => {
      const candidate = material({ id: 'slot-1', name: '', contact: '' })
      candidate.type = type
      candidate.group = group
      candidate.name = name
      delete candidate.requiredCount

      expect(normalizeMaterial(candidate)).toMatchObject({
        requiredCount: 3,
        recommenders: expect.arrayContaining([
          expect.objectContaining({ id: 'slot-1' }),
        ]),
      })
    },
  )

  it('does not mistake a generic request channel for a recommendation letter', () => {
    const candidate = material({ id: 'slot-1', name: '', contact: '' })
    candidate.type = 'Request'
    candidate.group = 'Custom'
    candidate.name = 'Reference'
    delete candidate.requiredCount

    expect(normalizeMaterial(candidate)).toMatchObject({
      requiredCount: 1,
      recommenders: [expect.objectContaining({ id: 'slot-1' })],
    })
  })

  it('retains metadata-only trailing slots and supplies defaults to every slot', () => {
    const normalized = normalizeMaterial({
      ...material({ id: 'slot-1', name: '', contact: '' }),
      requiredCount: 1,
      recommenders: [
        { id: 'slot-1', name: '', contact: '' },
        {
          id: 'slot-2',
          name: '',
          contact: '',
          notes: 'Private project note',
          deadline: '2026-11-20',
          deadlineTime: '17:30',
          reminderDate: '2026-11-10',
          reminderTime: '09:30',
        },
      ],
    })

    expect(normalized.recommenders).toHaveLength(2)
    expect(normalized.recommenders[0]).toMatchObject({
      notes: '',
      deadline: '',
      deadlineTime: '',
      reminderDate: '',
      reminderTime: '',
    })
    expect(normalized.recommenders[1]).toMatchObject({
      notes: 'Private project note',
      deadline: '2026-11-20',
      deadlineTime: '17:30',
      reminderDate: '2026-11-10',
      reminderTime: '09:30',
    })
  })
})
