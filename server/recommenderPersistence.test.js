import { describe, expect, it, vi } from 'vitest'
import {
  assertRecommenderMutationResponseBudget,
  MAX_RECOMMENDER_CASCADE_APPLICATIONS,
  MAX_RECOMMENDER_CASCADE_WORK_BYTES,
  MAX_RECOMMENDER_MUTATION_RESPONSE_BYTES,
  preflightApplicationRecommenderResolution,
  preflightProfileRecommenderCascade,
  RecommenderPersistenceError,
  recommenderIdentityMatchesProfile,
  replaceProfileRecommendersAndCascade,
  resolveApplicationRecommender,
} from './recommenderPersistence.js'

const OWNER_ID = 'owner-1'
const NOW = '2026-08-02T12:00:00.000Z'

function profile(overrides = {}) {
  return {
    id: 'profile-1',
    name: 'Professor Original',
    email: 'original@example.edu',
    phone: '+44 20 7000 0001',
    title: 'Professor',
    institution: 'Original University',
    relationship: 'Thesis supervisor',
    notes: 'Private profile note',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function recommender(overrides = {}) {
  return {
    id: 'row-1',
    name: 'Professor Original',
    email: 'original@example.edu',
    phone: '+44 20 7000 0001',
    contact: 'original@example.edu',
    notes: 'Application-private note',
    deadline: '2026-12-01',
    deadlineTime: '17:00',
    reminderDate: '2026-11-20',
    reminderTime: '09:30',
    ...overrides,
  }
}

function application(overrides = {}) {
  return {
    id: 'application-1',
    ownerId: OWNER_ID,
    university: 'Example University',
    recommenders: [],
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function resolve(overrides = {}) {
  return resolveApplicationRecommender({
    applications: [application()],
    profiles: [],
    applicationId: 'application-1',
    recommenderId: 'row-1',
    submittedRecommender: recommender(),
    decision: 'auto',
    ownerId: OWNER_ID,
    timestamp: NOW,
    createProfileId: () => 'profile-created',
    versionStamp: (previous) => `${previous}:next`,
    ...overrides,
  })
}

describe('application recommender resolution', () => {
  it('automatically links an existing profile by normalized email and keeps application-private fields', () => {
    const savedProfile = profile({
      name: 'Professor Canonical',
      email: 'Canonical@Example.edu',
      phone: '+44 20 7999 0000',
    })

    const result = resolve({
      profiles: [savedProfile],
      submittedRecommender: recommender({
        name: 'A stale display name',
        email: '  canonical@example.edu  ',
        phone: '+44 20 7111 1111',
      }),
    })

    expect(result.resolution).toBe('linked')
    expect(result.profiles).toEqual([savedProfile])
    expect(result.recommender).toMatchObject({
      id: 'row-1',
      profileId: 'profile-1',
      name: 'Professor Canonical',
      email: 'Canonical@Example.edu',
      phone: '+44 20 7999 0000',
      contact: 'Canonical@Example.edu',
      notes: 'Application-private note',
      deadline: '2026-12-01',
      reminderDate: '2026-11-20',
    })
    expect(result.affectedApplicationIds).toEqual(['application-1'])
  })

  it('automatically creates a shared profile for an unmatched teacher without copying application notes', () => {
    const result = resolve({
      submittedRecommender: recommender({
        name: '  Professor New  ',
        email: 'new@example.edu',
        phone: '+44 20 7222 2222',
        notes: 'Only this application should see this.',
      }),
    })

    expect(result.resolution).toBe('created')
    expect(result.profile).toEqual({
      id: 'profile-created',
      name: 'Professor New',
      email: 'new@example.edu',
      phone: '+44 20 7222 2222',
      title: '',
      institution: '',
      relationship: '',
      notes: '',
      createdAt: NOW,
      updatedAt: NOW,
    })
    expect(result.recommender).toMatchObject({
      profileId: 'profile-created',
      notes: 'Only this application should see this.',
    })
  })

  it('requires an explicit decision only when another application also holds the profile', () => {
    const linked = recommender({ profileId: 'profile-1' })
    const applications = [
      application({ recommenders: [linked] }),
      application({ id: 'application-2', recommenders: [recommender({ id: 'row-2', profileId: 'profile-1' })] }),
    ]
    const profiles = [profile()]
    const originalApplications = clone(applications)
    const originalProfiles = clone(profiles)

    expect(() => resolve({
      applications,
      profiles,
      submittedRecommender: { ...linked, name: 'Professor Changed' },
    })).toThrow(expect.objectContaining({
      code: 'RECOMMENDER_SYNC_DECISION_REQUIRED',
      status: 409,
    }))
    expect(applications).toEqual(originalApplications)
    expect(profiles).toEqual(originalProfiles)
  })

  it('renames a profile no other application holds without asking anything', () => {
    const linked = recommender({ profileId: 'profile-1' })
    const applications = [application({ recommenders: [linked] })]
    const profiles = [profile()]

    const result = resolve({
      applications,
      profiles,
      submittedRecommender: { ...linked, name: 'Professor Changed' },
    })

    expect(result.resolution).toBe('synced')
    expect(result.profile).toMatchObject({ id: 'profile-1', name: 'Professor Changed' })
    expect(result.recommender).toMatchObject({ profileId: 'profile-1', name: 'Professor Changed' })
  })

  it('synchronizes shared fields across owner applications while preserving every application-private field', () => {
    const linkedA = recommender({
      id: 'row-a',
      profileId: 'profile-1',
      notes: 'Application A note',
      deadline: '2026-12-01',
      reminderDate: '2026-11-20',
    })
    const linkedB = recommender({
      id: 'row-b',
      profileId: 'profile-1',
      notes: 'Application B note',
      deadline: '2027-01-15',
      reminderDate: '2027-01-02',
    })
    const foreignLinked = recommender({
      id: 'row-foreign',
      profileId: 'profile-1',
      notes: 'Another owner note',
    })
    const applications = [
      application({ id: 'application-a', recommenders: [linkedA], updatedAt: 'version-a' }),
      application({ id: 'application-b', recommenders: [linkedB], updatedAt: 'version-b' }),
      application({
        id: 'application-foreign',
        ownerId: 'owner-2',
        recommenders: [foreignLinked],
        updatedAt: 'version-foreign',
      }),
    ]
    const versionStamp = vi.fn((previous) => `${previous}:next`)

    const result = resolve({
      applications,
      profiles: [profile()],
      applicationId: 'application-a',
      recommenderId: 'row-a',
      decision: 'sync',
      submittedRecommender: {
        ...linkedA,
        name: 'Professor Updated',
        email: 'updated@example.edu',
        phone: '+44 20 7333 3333',
        notes: 'Updated application A note',
        deadline: '2026-12-20',
        reminderDate: '2026-12-10',
      },
      versionStamp,
    })

    expect(result.resolution).toBe('synced')
    expect(result.profile).toMatchObject({
      id: 'profile-1',
      name: 'Professor Updated',
      email: 'updated@example.edu',
      phone: '+44 20 7333 3333',
      institution: 'Original University',
      relationship: 'Thesis supervisor',
      notes: 'Private profile note',
    })
    expect(result.applications[0].recommenders[0]).toMatchObject({
      name: 'Professor Updated',
      email: 'updated@example.edu',
      phone: '+44 20 7333 3333',
      notes: 'Updated application A note',
      deadline: '2026-12-20',
      reminderDate: '2026-12-10',
    })
    expect(result.applications[1].recommenders[0]).toMatchObject({
      name: 'Professor Updated',
      email: 'updated@example.edu',
      phone: '+44 20 7333 3333',
      notes: 'Application B note',
      deadline: '2027-01-15',
      reminderDate: '2027-01-02',
    })
    expect(result.applications[2]).toEqual(applications[2])
    expect(result.affectedApplicationIds).toEqual(['application-a', 'application-b'])
    expect(versionStamp).toHaveBeenCalledTimes(3)
    expect(versionStamp.mock.calls.filter(([value]) => value === 'version-a')).toHaveLength(1)
    expect(versionStamp.mock.calls.filter(([value]) => value === 'version-b')).toHaveLength(1)
  })

  it('keeps an identity edit independent by creating a new profile for only the edited row', () => {
    const linkedA = recommender({ id: 'row-a', profileId: 'profile-1', notes: 'A only' })
    const linkedB = recommender({ id: 'row-b', profileId: 'profile-1', notes: 'B only' })

    const result = resolve({
      applications: [
        application({ id: 'application-a', recommenders: [linkedA] }),
        application({ id: 'application-b', recommenders: [linkedB] }),
      ],
      profiles: [profile()],
      applicationId: 'application-a',
      recommenderId: 'row-a',
      decision: 'independent',
      submittedRecommender: {
        ...linkedA,
        name: 'Professor Independent',
        email: 'independent@example.edu',
        phone: '+44 20 7444 4444',
      },
    })

    expect(result.resolution).toBe('created')
    expect(result.profiles).toHaveLength(2)
    expect(result.applications[0].recommenders[0]).toMatchObject({
      profileId: 'profile-created',
      name: 'Professor Independent',
      notes: 'A only',
    })
    expect(result.applications[1].recommenders[0]).toEqual(linkedB)
  })

  it('reuses another exact profile for an independent edit instead of creating a duplicate', () => {
    const linked = recommender({ profileId: 'profile-1' })
    const createProfileId = vi.fn(() => 'must-not-be-used')
    const matchingProfile = profile({
      id: 'profile-2',
      name: 'Professor Existing',
      email: 'existing@example.edu',
      phone: '+44 20 7555 5555',
    })

    const result = resolve({
      applications: [application({ recommenders: [linked] })],
      profiles: [profile(), matchingProfile],
      decision: 'independent',
      submittedRecommender: {
        ...linked,
        name: 'Professor Existing',
        email: 'EXISTING@example.edu',
        phone: '+44 20 7555 5555',
      },
      createProfileId,
    })

    expect(createProfileId).not.toHaveBeenCalled()
    expect(result.profiles).toHaveLength(2)
    expect(result.recommender).toMatchObject({
      profileId: 'profile-2',
      name: 'Professor Existing',
      email: 'existing@example.edu',
    })
  })

  it('does not merge people with different valid emails merely because their name and phone match', () => {
    const existing = profile({
      name: 'Professor Shared Office',
      email: 'first@example.edu',
      phone: '+44 20 7666 6666',
    })
    const submitted = recommender({
      name: 'Professor Shared Office',
      email: 'second@example.edu',
      phone: '+44 20 7666 6666',
    })

    expect(recommenderIdentityMatchesProfile(submitted, existing)).toBe(false)
    const result = resolve({ profiles: [existing], submittedRecommender: submitted })
    expect(result.resolution).toBe('created')
    expect(result.profiles).toHaveLength(2)
    expect(result.recommender.profileId).toBe('profile-created')
  })

  it('rejects ambiguous identities and generated profile id collisions', () => {
    const duplicateEmailProfiles = [
      profile({ id: 'profile-a', email: 'duplicate@example.edu' }),
      profile({ id: 'profile-b', email: 'DUPLICATE@example.edu' }),
    ]
    expect(() => resolve({
      profiles: duplicateEmailProfiles,
      submittedRecommender: recommender({ email: 'duplicate@example.edu' }),
    })).toThrow(expect.objectContaining({ code: 'RECOMMENDER_IDENTITY_AMBIGUOUS' }))

    expect(() => resolve({
      profiles: [profile({ id: 'profile-created' })],
      submittedRecommender: recommender({
        name: 'A different teacher',
        email: 'different@example.edu',
        phone: '',
      }),
    })).toThrow(expect.objectContaining({ code: 'PROFILE_RECOMMENDER_ID_CONFLICT' }))
  })
})

describe('duplicate recommender addresses on one application', () => {
  function preflight(overrides = {}) {
    return preflightApplicationRecommenderResolution({
      applications: [application()],
      profiles: [],
      applicationId: 'application-1',
      recommenderId: 'row-1',
      submittedRecommender: recommender(),
      decision: 'auto',
      ownerId: OWNER_ID,
      ...overrides,
    })
  }

  const occupied = application({
    recommenders: [recommender({ id: 'row-existing', name: 'Professor Existing' })],
  })

  it('refuses a second row that reuses an address already held on the application', () => {
    expect(() => preflight({
      applications: [occupied],
      submittedRecommender: recommender({ id: 'row-1', email: 'ORIGINAL@example.edu ' }),
    })).toThrow(expect.objectContaining({ code: 'RECOMMENDER_DUPLICATE_EMAIL', status: 409 }))
  })

  it('still lets the row that already owns the address save itself', () => {
    expect(() => preflight({
      applications: [occupied],
      recommenderId: 'row-existing',
      submittedRecommender: recommender({ id: 'row-existing', name: 'Professor Renamed' }),
    })).not.toThrow()
  })

  it('leaves rows without an address alone, since they have no identity to collide on yet', () => {
    const blank = application({
      recommenders: [recommender({ id: 'row-existing', email: '', contact: '' })],
    })
    expect(() => preflight({
      applications: [blank],
      submittedRecommender: recommender({ id: 'row-1', email: '', contact: '' }),
    })).not.toThrow()
  })
})

describe('profile recommender replacement', () => {
  it('cascades profile identity edits to every linked owner application without replacing private fields', () => {
    const current = profile()
    const edited = profile({
      name: 'Professor Profile Edit',
      email: 'profile-edit@example.edu',
      phone: '+44 20 7777 7777',
      institution: 'Updated University',
      updatedAt: NOW,
    })
    const linkedA = recommender({ id: 'row-a', profileId: 'profile-1', notes: 'Private A' })
    const linkedB = recommender({
      id: 'row-b',
      profileId: 'profile-1',
      notes: 'Private B',
      deadline: '2027-02-01',
    })
    const foreign = recommender({ id: 'row-foreign', profileId: 'profile-1', notes: 'Foreign' })
    const applications = [
      application({ id: 'application-a', recommenders: [linkedA] }),
      application({ id: 'application-b', recommenders: [linkedB] }),
      application({ id: 'application-foreign', ownerId: 'owner-2', recommenders: [foreign] }),
    ]

    const result = replaceProfileRecommendersAndCascade({
      applications,
      currentProfiles: [current],
      nextProfiles: [edited],
      ownerId: OWNER_ID,
      timestamp: NOW,
      versionStamp: (previous) => `${previous}:next`,
    })

    expect(result.affectedApplicationIds).toEqual(['application-a', 'application-b'])
    expect(result.applications[0].recommenders[0]).toMatchObject({
      profileId: 'profile-1',
      name: 'Professor Profile Edit',
      email: 'profile-edit@example.edu',
      phone: '+44 20 7777 7777',
      notes: 'Private A',
    })
    expect(result.applications[1].recommenders[0]).toMatchObject({
      name: 'Professor Profile Edit',
      notes: 'Private B',
      deadline: '2027-02-01',
    })
    expect(result.applications[2]).toEqual(applications[2])
  })

  it('detaches deleted profiles while retaining the last shared snapshot and all private fields', () => {
    const linked = recommender({ profileId: 'profile-1', notes: 'Keep this note' })

    const result = replaceProfileRecommendersAndCascade({
      applications: [application({ recommenders: [linked] })],
      currentProfiles: [profile()],
      nextProfiles: [],
      ownerId: OWNER_ID,
      timestamp: NOW,
      versionStamp: (previous) => `${previous}:next`,
    })

    expect(result.profiles).toEqual([])
    expect(result.affectedApplicationIds).toEqual(['application-1'])
    expect(result.applications[0].recommenders[0]).toEqual({
      ...linked,
      profileId: undefined,
    })
    expect(Object.hasOwn(result.applications[0].recommenders[0], 'profileId')).toBe(false)
  })

  it('rejects duplicate profile ids before changing any application snapshot', () => {
    const applications = [application({
      recommenders: [recommender({ profileId: 'profile-1' })],
    })]

    expect(() => replaceProfileRecommendersAndCascade({
      applications,
      currentProfiles: [profile()],
      nextProfiles: [profile(), profile({ name: 'Duplicate id' })],
      ownerId: OWNER_ID,
      timestamp: NOW,
    })).toThrow(expect.objectContaining({
      code: 'PROFILE_RECOMMENDER_DUPLICATE_ID',
      status: 400,
    }))
    expect(applications[0].recommenders[0].name).toBe('Professor Original')
  })
})

describe('RecommenderPersistenceError', () => {
  it('retains a machine-readable code and status', () => {
    const error = new RecommenderPersistenceError('CONFLICT', 'Conflict', 412)
    expect(error).toMatchObject({
      name: 'RecommenderPersistenceError',
      code: 'CONFLICT',
      message: 'Conflict',
      status: 412,
    })
  })
})

describe('recommender cascade admission', () => {
  it('rejects oversized replace and resolve fan-out before building full application replacements', () => {
    const linkedApplications = Array.from(
      { length: MAX_RECOMMENDER_CASCADE_APPLICATIONS + 1 },
      (_, index) => application({
        id: `application-${index}`,
        recommenders: [recommender({ id: `row-${index}`, profileId: 'profile-1' })],
      }),
    )
    const edited = profile({ name: 'Professor Bounded' })

    expect(() => preflightProfileRecommenderCascade({
      applications: linkedApplications,
      currentProfiles: [profile()],
      nextProfiles: [edited],
      ownerId: OWNER_ID,
    })).toThrow(expect.objectContaining({
      code: 'RECOMMENDER_CASCADE_TOO_LARGE',
      status: 413,
    }))

    expect(() => preflightApplicationRecommenderResolution({
      applications: linkedApplications,
      profiles: [profile()],
      applicationId: 'application-0',
      recommenderId: 'row-0',
      submittedRecommender: recommender({
        id: 'row-0',
        profileId: 'profile-1',
        name: 'Professor Bounded',
      }),
      decision: 'sync',
      ownerId: OWNER_ID,
    })).toThrow(expect.objectContaining({
      code: 'RECOMMENDER_CASCADE_TOO_LARGE',
      status: 413,
    }))
  })

  it('bounds full durability hashing work independently from compact response bytes', () => {
    const oversizedAuthoredState = 'x'.repeat(Math.floor(MAX_RECOMMENDER_CASCADE_WORK_BYTES / 2) + 1_024)
    expect(() => preflightProfileRecommenderCascade({
      applications: [application({
        recommenders: [recommender({ profileId: 'profile-1' })],
        notes: oversizedAuthoredState,
      })],
      currentProfiles: [profile()],
      nextProfiles: [profile({ name: 'Professor Bounded' })],
      ownerId: OWNER_ID,
    })).toThrow(expect.objectContaining({
      code: 'RECOMMENDER_CASCADE_TOO_LARGE',
      status: 413,
    }))
  })

  it('stops sizing a 32 MiB authored payload without materializing its full JSON string', () => {
    const oversizedAuthoredState = 'x'.repeat(32 * 1024 * 1024)
    const oversizedApplication = application({
      recommenders: [recommender({ profileId: 'profile-1' })],
      notes: oversizedAuthoredState,
    })
    const stringify = vi.spyOn(JSON, 'stringify')
    try {
      expect(() => preflightProfileRecommenderCascade({
        applications: [oversizedApplication],
        currentProfiles: [profile()],
        nextProfiles: [profile({ name: 'Professor Bounded' })],
        ownerId: OWNER_ID,
      })).toThrow(expect.objectContaining({
        code: 'RECOMMENDER_CASCADE_TOO_LARGE',
        status: 413,
      }))
      expect(stringify.mock.calls.some(([value]) => value === oversizedApplication)).toBe(false)
    } finally {
      stringify.mockRestore()
    }
  })

  it('rejects an aggregate response above the exact 768 KiB write-before-response budget', () => {
    expect(() => assertRecommenderMutationResponseBudget({
      value: 'x'.repeat(MAX_RECOMMENDER_MUTATION_RESPONSE_BYTES),
    })).toThrow(expect.objectContaining({
      code: 'RECOMMENDER_CASCADE_TOO_LARGE',
      status: 413,
    }))
  })
})
