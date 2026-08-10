import type { ProfileRecommender } from './api/phdApi'
import type { ApplicationRecord } from './data/applications'
import {
  aggregateProfileRecommenders,
  type ProfileRecommenderAggregation,
} from './profileRecommenders'

type ProfileRecommenderWorkerRequest = {
  id: number
  profiles: ProfileRecommender[]
  applications: ApplicationRecord[]
  ownerId?: string
  now?: string
}

type ProfileRecommenderWorkerResponse = {
  id: number
  aggregation?: ProfileRecommenderAggregation
  error?: string
}

globalThis.addEventListener('message', (event: MessageEvent<ProfileRecommenderWorkerRequest>) => {
  const { id, profiles, applications, ownerId, now } = event.data
  try {
    const aggregation = aggregateProfileRecommenders(profiles, applications, {
      ownerId,
      now: now ? new Date(now) : undefined,
    })
    globalThis.postMessage({
      id,
      aggregation,
    } satisfies ProfileRecommenderWorkerResponse)
  } catch (error) {
    globalThis.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    } satisfies ProfileRecommenderWorkerResponse)
  }
})

export {}
