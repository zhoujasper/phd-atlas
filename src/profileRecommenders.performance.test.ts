import { describe, expect, it } from 'vitest'
import type { ProfileRecommender } from './api/phdApi'
import type { ApplicationRecord, MaterialRecommender } from './data/applications'
import { aggregateProfileRecommendersAsync } from './profileRecommenderAggregation'
import { aggregateProfileRecommenders } from './profileRecommenders'

function recommenderFixture(index: number): ProfileRecommender {
  return {
    id: `profile-${index}`,
    name: `Professor ${index}`,
    email: `professor.${index}@example.edu`,
    phone: '',
    title: 'Professor',
    institution: 'Example University',
    relationship: 'Research supervisor',
    notes: `Private notes for recommender ${index}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function applicationFixture(index: number): ApplicationRecord {
  const recommender: MaterialRecommender = {
    id: `recommender-${index}`,
    name: `Professor ${index}`,
    contact: `professor.${index}@example.edu`,
    profileId: `profile-${index}`,
  }
  return {
    id: `application-${index}`,
    ownerId: 'owner-a',
    school: { name: 'Example University', country: '', website: '' },
    program: 'Computer Science PhD',
    deadline: '2027-01-15',
    materials: [{
      id: `material-${index}`,
      name: 'Recommendation letters',
      type: 'Request',
      status: 'Not started',
      version: '',
      updatedAt: '',
      recommenders: [recommender],
    }],
  } as ApplicationRecord
}

describe('profile recommender aggregation performance', () => {
  it('keeps the 1,000 x 200 first-screen path under 1 second', async () => {
    const profiles = Array.from({ length: 1_000 }, (_, index) => recommenderFixture(index))
    const applications = Array.from({ length: 200 }, (_, index) => applicationFixture(index))
    const started = performance.now()
    const aggregation = await aggregateProfileRecommendersAsync(profiles, applications, {
      ownerId: 'owner-a',
    })
    const elapsed = performance.now() - started
    console.log(`profileRecommendersAsync 1000x200 elapsed=${elapsed.toFixed(1)}ms directory=${aggregation.directory.length}`)
    expect(elapsed).toBeLessThan(1_000)
    expect(aggregation.directory.length).toBeGreaterThanOrEqual(1_000)
  })

  it('keeps the synchronous fallback under the 200ms long-task budget', () => {
    const profiles = Array.from({ length: 1_000 }, (_, index) => recommenderFixture(index))
    const applications = Array.from({ length: 200 }, (_, index) => applicationFixture(index))
    const started = performance.now()
    aggregateProfileRecommenders(profiles, applications, { ownerId: 'owner-a' })
    const elapsed = performance.now() - started
    console.log(`profileRecommendersSync 1000x200 elapsed=${elapsed.toFixed(1)}ms`)
    expect(elapsed).toBeLessThan(200)
  })
})
