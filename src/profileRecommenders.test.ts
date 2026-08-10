import { describe, expect, it } from 'vitest'
import type { ProfileRecommender } from './api/phdApi'
import type { ApplicationRecord, MaterialRecommender } from './data/applications'
import {
  aggregateProfileRecommenders,
  applicationsWithActiveRecommenderDraft,
  extractProfileRecommenderUses,
  materialRecommenderEmail,
  materialRecommenderMatchesProfile,
  materialRecommenderPhone,
  materialRecommenderWithContacts,
  normalizeRecommenderEmail,
  profileRecommenderSuggestions,
  profileRecommendersShareIdentity,
} from './profileRecommenders'

function application({
  id,
  ownerId = 'owner-a',
  deadline,
  school = id,
  recommenders,
}: {
  id: string
  ownerId?: string
  deadline: string
  school?: string
  recommenders: MaterialRecommender[]
}): ApplicationRecord {
  return {
    id,
    ownerId,
    school: { name: school, country: '', website: '' },
    program: 'PhD',
    deadline,
    recommenders,
    materials: [],
  } as unknown as ApplicationRecord
}

function saved(overrides: Partial<ProfileRecommender> = {}): ProfileRecommender {
  return {
    id: 'profile-1',
    name: 'Professor Ada Lovelace',
    email: 'ada@example.edu',
    phone: '',
    ...overrides,
  }
}

describe('profile recommender aggregation', () => {
  it('projects a saved active draft for ownerless legacy personal applications without publishing unrelated edits', () => {
    const canonical = application({
      id: 'legacy-personal',
      ownerId: undefined,
      deadline: '2026-12-01',
      recommenders: [],
    })
    delete canonical.ownerId
    const unrelatedDraft = { ...canonical, result: 'Unsaved note' }
    const savedRecommenderDraft = {
      ...unrelatedDraft,
      recommenders: [{ id: 'jim', name: 'Jim Wright', contact: 'jim.wright@example.com' }],
    }
    const canonicalApplications = [canonical]

    expect(applicationsWithActiveRecommenderDraft(canonicalApplications, unrelatedDraft)).toBe(canonicalApplications)

    const projected = applicationsWithActiveRecommenderDraft(canonicalApplications, savedRecommenderDraft)
    const aggregation = aggregateProfileRecommenders([], projected)
    expect(projected).not.toBe(canonicalApplications)
    expect(aggregation.directory).toEqual([
      expect.objectContaining({
        source: 'application',
        name: 'Jim Wright',
        email: 'jim.wright@example.com',
      }),
    ])
    expect(profileRecommenderSuggestions(aggregation.directory)).toEqual([
      expect.objectContaining({ name: 'Jim Wright', email: 'jim.wright@example.com' }),
    ])
  })

  it('normalizes Unicode, case, whitespace, and mailto email prefixes', () => {
    expect(normalizeRecommenderEmail(' MAILTO:Ada@Example.EDU ')).toBe('ada@example.edu')
    expect(
      profileRecommendersShareIdentity(
        { name: 'Old display name', email: 'ADA@example.edu' },
        { name: 'New display name', email: 'ada@EXAMPLE.edu' },
      ),
    ).toBe(true)
  })

  it('projects explicit email and phone independently while keeping the legacy preferred-contact field', () => {
    const legacyEmail = { id: 'legacy-email', name: 'Email', contact: 'old@example.edu' }
    const legacyPhone = { id: 'legacy-phone', name: 'Phone', contact: '+44 20 7000 0000' }
    expect(materialRecommenderEmail(legacyEmail)).toBe('old@example.edu')
    expect(materialRecommenderPhone(legacyEmail)).toBe('')
    expect(materialRecommenderEmail(legacyPhone)).toBe('')
    expect(materialRecommenderPhone(legacyPhone)).toBe('+44 20 7000 0000')

    const withBoth = materialRecommenderWithContacts(
      { id: 'both', name: 'Professor Both', contact: '', notes: 'Application-only note' },
      ' both@example.edu ',
      ' +44 20 7111 1111 ',
    )
    expect(withBoth).toEqual({
      id: 'both',
      name: 'Professor Both',
      email: 'both@example.edu',
      phone: '+44 20 7111 1111',
      contact: 'both@example.edu',
      notes: 'Application-only note',
    })

    const uses = extractProfileRecommenderUses([
      application({
        id: 'separate-contacts',
        deadline: '2026-12-01',
        recommenders: [withBoth],
      }),
    ])
    expect(uses).toEqual([
      expect.objectContaining({
        recommenderId: 'both',
        email: 'both@example.edu',
        phone: '+44 20 7111 1111',
        contact: 'both@example.edu',
      }),
    ])
  })

  it('matches equal phone identities only when their normalized names also match', () => {
    expect(
      profileRecommendersShareIdentity(
        { name: ' Professor Katherine Johnson ', phone: '+1 555 0101' },
        { name: 'professor katherine johnson', phone: ' +1 555 0101 ' },
      ),
    ).toBe(true)
    expect(
      profileRecommendersShareIdentity(
        { name: 'A Different Person', phone: '+1 555 0101' },
        { name: 'Professor Katherine Johnson', phone: '+1 555 0101' },
      ),
    ).toBe(false)
  })

  it('matches an exact normalized email before the display name', () => {
    const profiles = [saved()]
    const applications = [
      application({
        id: 'cambridge',
        deadline: '2026-12-03',
        recommenders: [
          {
            id: 'rec-1',
            name: 'Dr. A. Lovelace',
            contact: ' ADA@EXAMPLE.EDU ',
          },
        ],
      }),
    ]

    const result = aggregateProfileRecommenders(profiles, applications, {
      ownerId: 'owner-a',
      now: new Date('2026-08-01T09:00:00Z'),
    })

    expect(result.saved[0].usageCount).toBe(1)
    expect(result.saved[0].nextUse?.applicationId).toBe('cambridge')
    expect(result.inferred).toEqual([])
  })

  it('falls back to exact nonempty contact plus name and never merges name-only rows', () => {
    const applications = [
      application({
        id: 'first',
        deadline: '2026-12-10',
        recommenders: [
          { id: 'phone-1', name: 'Dr. Kim', contact: '+44 20 1234' },
          { id: 'blank-1', name: 'Dr. Lee', contact: '' },
        ],
      }),
      application({
        id: 'second',
        deadline: '2026-12-20',
        recommenders: [
          { id: 'phone-2', name: '  DR.   KIM ', contact: ' +44 20 1234 ' },
          { id: 'blank-2', name: 'Dr. Lee', contact: '' },
        ],
      }),
    ]

    const result = aggregateProfileRecommenders([], applications, {
      ownerId: 'owner-a',
      now: new Date('2026-08-01T09:00:00Z'),
    })

    expect(result.inferred).toHaveLength(3)
    expect(result.inferred.find((candidate) => candidate.name.trim() === 'Dr. Kim')?.usageCount).toBe(2)
    expect(result.inferred.filter((candidate) => candidate.name === 'Dr. Lee')).toHaveLength(2)
  })

  it('builds one directory across saved and application-derived people and counts distinct applications', () => {
    const ada = saved({
      id: 'ada',
      title: 'Professor',
      institution: 'Analytical Engine Institute',
      relationship: 'Research supervisor',
      notes: 'Private context for future requests',
    })
    const unused = saved({
      id: 'unused',
      name: 'Professor No Current Project',
      email: 'unused@example.edu',
    })
    const result = aggregateProfileRecommenders(
      [ada, unused],
      [
        application({
          id: 'cambridge',
          school: 'University of Cambridge',
          deadline: '2026-11-20',
          recommenders: [
            { id: 'ada-first-slot', name: 'Ada', contact: 'ada@example.edu' },
            { id: 'ada-second-slot', name: 'Ada Lovelace', contact: 'ADA@example.edu' },
          ],
        }),
        application({
          id: 'mit',
          school: 'MIT',
          deadline: '2026-12-01',
          recommenders: [{ id: 'ada-third-slot', name: 'Ada', contact: 'ada@example.edu' }],
        }),
        application({
          id: 'stanford',
          school: 'Stanford University',
          deadline: '2027-01-02',
          recommenders: [{ id: 'grace', name: 'Grace Hopper', contact: 'grace@example.edu' }],
        }),
      ],
      { now: new Date('2026-08-01T09:00:00Z') },
    )

    const adaEntry = result.directory.find((entry) => entry.profileId === 'ada')
    const unusedEntry = result.directory.find((entry) => entry.profileId === 'unused')
    const graceEntry = result.directory.find((entry) => entry.source === 'application')

    expect(result.directory).toHaveLength(3)
    expect(adaEntry).toMatchObject({ source: 'profile', projectCount: 2 })
    expect(adaEntry?.uses).toHaveLength(3)
    expect(adaEntry?.projects.find((project) => project.applicationId === 'cambridge')?.uses).toHaveLength(2)
    expect(adaEntry?.searchText).toContain('private context for future requests')
    expect(adaEntry?.searchText).toContain('university of cambridge')
    expect(unusedEntry).toMatchObject({ source: 'profile', projectCount: 0, projects: [] })
    expect(graceEntry).toMatchObject({
      source: 'application',
      name: 'Grace Hopper',
      projectCount: 1,
      profile: null,
    })
    expect(result.saved.find((summary) => summary.profile.id === 'ada')).toMatchObject({
      usageCount: 2,
      projectCount: 2,
    })
  })

  it('filters strictly to the requested owner, including excluding ownerless records', () => {
    const owned = application({
      id: 'owned',
      ownerId: 'owner-a',
      deadline: '2026-12-01',
      recommenders: [{ id: 'owned-rec', name: 'Owned', contact: 'owned@example.edu' }],
    })
    const other = application({
      id: 'other',
      ownerId: 'owner-b',
      deadline: '2026-12-01',
      recommenders: [{ id: 'other-rec', name: 'Other', contact: 'other@example.edu' }],
    })
    const ownerless = application({
      id: 'ownerless',
      ownerId: undefined,
      deadline: '2026-12-01',
      recommenders: [
        {
          id: 'ownerless-rec',
          name: 'Ownerless',
          contact: 'ownerless@example.edu',
        },
      ],
    })
    delete ownerless.ownerId

    expect(
      extractProfileRecommenderUses([owned, other, ownerless], {
        ownerId: 'owner-a',
      }),
    ).toHaveLength(1)
  })

  it('does not turn completely blank recommendation slots into directory people', () => {
    const uses = extractProfileRecommenderUses([
      application({
        id: 'blank-slots',
        deadline: '2026-12-01',
        recommenders: [
          { id: 'generated-empty-row', name: '   ', contact: '', profileId: '  ' },
          { id: 'named-row', name: 'Dr. Real', contact: '' },
          { id: 'linked-row', name: '', contact: ' ', profileId: ' profile-1 ' },
        ],
      }),
    ])

    expect(uses.map((use) => use.recommenderId)).toEqual(['named-row', 'linked-row'])
    expect(uses[1].profileId).toBe('profile-1')
  })

  it('uses a stable profile link even when the application snapshot changed', () => {
    const profile = saved({
      id: 'linked',
      name: 'Current name',
      email: 'current@example.edu',
    })
    const recommender = {
      id: 'rec',
      name: 'Historical name',
      contact: 'historical@example.edu',
      profileId: 'linked',
    }

    expect(materialRecommenderMatchesProfile(recommender, profile)).toBe(true)
  })

  it('treats an explicit profile link as authoritative when saved emails are duplicated', () => {
    const first = saved({ id: 'first' })
    const linked = saved({ id: 'linked' })
    const applicationWithLink = application({
      id: 'linked-application',
      deadline: '2026-12-01',
      recommenders: [
        {
          id: 'rec',
          name: 'Ada',
          contact: 'ada@example.edu',
          profileId: 'linked',
        },
      ],
    })

    const result = aggregateProfileRecommenders([first, linked], [applicationWithLink], {
      now: new Date('2026-08-01T09:00:00Z'),
    })

    expect(result.saved.find((summary) => summary.profile.id === 'first')?.usageCount).toBe(0)
    expect(result.saved.find((summary) => summary.profile.id === 'linked')?.usageCount).toBe(1)
    expect(
      materialRecommenderMatchesProfile(
        applicationWithLink.recommenders?.[0] as MaterialRecommender,
        first,
      ),
    ).toBe(false)
  })

  it('sorts the unified directory by nearest future deadline, then project count, then name', () => {
    const profiles = [
      saved({ id: 'alice', name: 'Alice', email: 'alice@example.edu' }),
      saved({ id: 'zed', name: 'Zed', email: 'zed@example.edu' }),
      saved({ id: 'bob', name: 'Bob', email: 'bob@example.edu' }),
      saved({ id: 'carol', name: 'Carol', email: 'carol@example.edu' }),
      saved({ id: 'aaron', name: 'Aaron', email: 'aaron@example.edu' }),
    ]
    const applications = [
      application({
        id: 'alice-future',
        deadline: '2026-10-01',
        recommenders: [{ id: 'alice-rec', name: 'Alice', contact: 'alice@example.edu' }],
      }),
      application({
        id: 'zed-future',
        deadline: '2026-09-01',
        recommenders: [{ id: 'zed-rec', name: 'Zed', contact: 'zed@example.edu' }],
      }),
      application({
        id: 'bob-past-one',
        deadline: '2026-06-01',
        recommenders: [{ id: 'bob-one-rec', name: 'Bob', contact: 'bob@example.edu' }],
      }),
      application({
        id: 'bob-past-two',
        deadline: '2026-07-01',
        recommenders: [{ id: 'bob-two-rec', name: 'Bob', contact: 'bob@example.edu' }],
      }),
      application({
        id: 'carol-past',
        deadline: '2026-07-01',
        recommenders: [{ id: 'carol-rec', name: 'Carol', contact: 'carol@example.edu' }],
      }),
      application({
        id: 'aaron-past',
        deadline: '2026-07-01',
        recommenders: [{ id: 'aaron-rec', name: 'Aaron', contact: 'aaron@example.edu' }],
      }),
    ]

    const result = aggregateProfileRecommenders(profiles, applications, {
      now: new Date('2026-08-01T09:00:00Z'),
    })

    expect(result.directory.map((entry) => entry.name)).toEqual(['Zed', 'Alice', 'Bob', 'Aaron', 'Carol'])
  })

  it('creates safe combobox suggestions without inventing profile ids for application-derived people', () => {
    const result = aggregateProfileRecommenders(
      [saved({ id: 'persisted' })],
      [
        application({
          id: 'saved-use',
          deadline: '2026-12-01',
          recommenders: [{ id: 'saved-rec', name: 'Ada', contact: 'ada@example.edu' }],
        }),
        application({
          id: 'derived-use',
          deadline: '2026-12-10',
          recommenders: [{ id: 'derived-rec', name: 'Katherine Johnson', contact: 'kj@nasa.gov' }],
        }),
      ],
      { now: new Date('2026-08-01T09:00:00Z') },
    )

    const suggestions = profileRecommenderSuggestions(result.directory)
    const persisted = suggestions.find((suggestion) => suggestion.source === 'profile')
    const derived = suggestions.find((suggestion) => suggestion.source === 'application')

    expect(persisted).toMatchObject({ source: 'profile', profileId: 'persisted' })
    expect(derived).toMatchObject({ source: 'application', name: 'Katherine Johnson' })
    expect(derived).not.toHaveProperty('profileId')
    expect(derived?.searchText).toContain('nasa.gov')
  })

  it('selects the nearest valid upcoming application deadline', () => {
    const profile = saved()
    const result = aggregateProfileRecommenders(
      [profile],
      [
        application({
          id: 'past',
          deadline: '2026-07-01',
          recommenders: [{ id: 'past-rec', name: 'Ada', contact: 'ada@example.edu' }],
        }),
        application({
          id: 'later',
          deadline: '2027-01-12',
          recommenders: [{ id: 'later-rec', name: 'Ada', contact: 'ada@example.edu' }],
        }),
        application({
          id: 'next',
          deadline: '2026-11-28',
          recommenders: [{ id: 'next-rec', name: 'Ada', contact: 'ada@example.edu' }],
        }),
        application({
          id: 'invalid',
          deadline: '2026-13-40',
          recommenders: [{ id: 'invalid-rec', name: 'Ada', contact: 'ada@example.edu' }],
        }),
      ],
      {
        now: new Date('2026-08-01T09:00:00Z'),
      },
    )

    expect(result.saved[0].usageCount).toBe(4)
    expect(result.saved[0].nextUse?.applicationId).toBe('next')
  })

  it('uses the letter deadline when present and falls back to the application deadline', () => {
    const result = aggregateProfileRecommenders(
      [saved()],
      [
        application({
          id: 'letter-specific',
          deadline: '2026-12-20',
          recommenders: [
            {
              id: 'letter-specific-rec',
              name: 'Ada',
              contact: 'ada@example.edu',
              deadline: '2026-09-15',
            },
          ],
        }),
        application({
          id: 'application-fallback',
          deadline: '2026-10-10',
          recommenders: [{ id: 'fallback-rec', name: 'Ada', contact: 'ada@example.edu' }],
        }),
      ],
      { now: new Date('2026-08-01T09:00:00Z') },
    )

    expect(result.uses.find((use) => use.applicationId === 'letter-specific')?.deadline).toBe('2026-09-15')
    expect(result.uses.find((use) => use.applicationId === 'application-fallback')?.deadline).toBe('2026-10-10')
    expect(result.directory.find((entry) => entry.profileId === 'profile-1')?.nextProject).toMatchObject({
      applicationId: 'letter-specific',
      deadline: '2026-09-15',
    })
  })
})
