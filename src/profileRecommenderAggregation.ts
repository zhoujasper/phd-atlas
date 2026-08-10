import { useEffect, useRef, useState } from 'react'
import type { ProfileRecommender } from './api/phdApi'
import type { ApplicationRecord } from './data/applications'
import {
  aggregateProfileRecommenders,
  type ProfileRecommenderAggregation,
  type ProfileRecommenderAggregationOptions,
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

type PendingJob = {
  resolve: (value: ProfileRecommenderAggregation) => void
  reject: (reason: unknown) => void
  fallback: () => ProfileRecommenderAggregation
  timer: ReturnType<typeof setTimeout>
}

const PROFILE_RECOMMENDER_WORKER_TIMEOUT_MS = 2_500
export const EMPTY_PROFILE_RECOMMENDER_AGGREGATION: ProfileRecommenderAggregation = {
  uses: [],
  directory: [],
  saved: [],
  inferred: [],
}

let profileRecommenderWorker: Worker | null = null
let profileRecommenderWorkerUnavailable = false
let nextProfileRecommenderWorkerRequestId = 0
const profileRecommenderPendingJobs = new Map<number, PendingJob>()

function aggregateFallback(
  profiles: readonly ProfileRecommender[],
  applications: readonly ApplicationRecord[],
  options: ProfileRecommenderAggregationOptions,
) {
  return aggregateProfileRecommenders(profiles, applications, options)
}

function settleProfileRecommenderJob(id: number, aggregation?: ProfileRecommenderAggregation) {
  const job = profileRecommenderPendingJobs.get(id)
  if (!job) return
  clearTimeout(job.timer)
  profileRecommenderPendingJobs.delete(id)
  if (aggregation) job.resolve(aggregation)
  else {
    try {
      job.resolve(job.fallback())
    } catch (error) {
      job.reject(error)
    }
  }
}

function disableProfileRecommenderWorker() {
  profileRecommenderWorker?.terminate()
  profileRecommenderWorker = null
  profileRecommenderWorkerUnavailable = true
  const jobs = [...profileRecommenderPendingJobs.values()]
  profileRecommenderPendingJobs.clear()
  for (const job of jobs) {
    clearTimeout(job.timer)
    try {
      job.resolve(job.fallback())
    } catch (error) {
      job.reject(error)
    }
  }
}

function getProfileRecommenderWorker() {
  if (profileRecommenderWorkerUnavailable || typeof Worker === 'undefined') return null
  if (profileRecommenderWorker) return profileRecommenderWorker
  try {
    profileRecommenderWorker = new Worker(
      new URL('./profileRecommenders.worker.ts', import.meta.url),
      { type: 'module' },
    )
    profileRecommenderWorker.addEventListener('message', (event: MessageEvent<ProfileRecommenderWorkerResponse>) => {
      const result = event.data
      if (!result || !profileRecommenderPendingJobs.has(result.id)) return
      settleProfileRecommenderJob(result.id, result.error ? undefined : result.aggregation)
    })
    profileRecommenderWorker.addEventListener('error', disableProfileRecommenderWorker)
    profileRecommenderWorker.addEventListener('messageerror', disableProfileRecommenderWorker)
    return profileRecommenderWorker
  } catch {
    profileRecommenderWorker = null
    profileRecommenderWorkerUnavailable = true
    return null
  }
}

export function profileRecommenderWorkerSupported() {
  return !profileRecommenderWorkerUnavailable && typeof Worker !== 'undefined'
}

export function aggregateProfileRecommendersAsync(
  profiles: readonly ProfileRecommender[],
  applications: readonly ApplicationRecord[],
  options: ProfileRecommenderAggregationOptions = {},
): Promise<ProfileRecommenderAggregation> {
  const fallback = () => aggregateFallback(profiles, applications, options)
  if (!profileRecommenderWorkerSupported()) return Promise.resolve(fallback())

  const id = ++nextProfileRecommenderWorkerRequestId
  return new Promise<ProfileRecommenderAggregation>((resolve, reject) => {
    const timer = setTimeout(() => {
      profileRecommenderPendingJobs.delete(id)
      try {
        resolve(fallback())
      } catch (error) {
        reject(error)
      }
    }, PROFILE_RECOMMENDER_WORKER_TIMEOUT_MS)
    profileRecommenderPendingJobs.set(id, { resolve, reject, fallback, timer })

    const worker = getProfileRecommenderWorker()
    if (!worker) {
      clearTimeout(timer)
      profileRecommenderPendingJobs.delete(id)
      try {
        resolve(fallback())
      } catch (error) {
        reject(error)
      }
      return
    }
    const request: ProfileRecommenderWorkerRequest = {
      id,
      profiles: [...profiles],
      applications: [...applications],
      ownerId: options.ownerId,
      now: options.now?.toISOString(),
    }
    try {
      worker.postMessage(request)
    } catch {
      clearTimeout(timer)
      profileRecommenderPendingJobs.delete(id)
      disableProfileRecommenderWorker()
      try {
        resolve(fallback())
      } catch (fallbackError) {
        reject(fallbackError)
      }
    }
  })
}

/**
 * Holds a list's identity steady while its contents are unchanged.
 *
 * Callers reach this hook through expressions like
 * `settings.profileRecommenders ?? []`, which allocates a fresh array on every
 * render whenever the setting is absent -- the normal state for an account that
 * has never added a recommender. Depending on that identity directly makes the
 * aggregation effect re-run, set state, and re-render without end, so the app
 * never reaches a settled paint and the boot curtain stays up forever.
 */
function useStableList<T>(list: readonly T[]): readonly T[] {
  const stable = useRef(list)
  const previous = stable.current
  if (
    previous !== list
    && (previous.length !== list.length || previous.some((item, index) => item !== list[index]))
  ) {
    stable.current = list
  }
  return stable.current
}

export function useProfileRecommenderAggregation(
  profiles: readonly ProfileRecommender[],
  applications: readonly ApplicationRecord[],
  ownerId?: string,
) {
  const stableProfiles = useStableList(profiles)
  const stableApplications = useStableList(applications)
  const [aggregation, setAggregation] = useState<ProfileRecommenderAggregation>(() => (
    profileRecommenderWorkerSupported()
      ? EMPTY_PROFILE_RECOMMENDER_AGGREGATION
      : aggregateProfileRecommenders(profiles, applications, { ownerId })
  ))

  useEffect(() => {
    let active = true
    void aggregateProfileRecommendersAsync(stableProfiles, stableApplications, { ownerId })
      .then((next) => {
        if (active) setAggregation(next)
      })
      .catch(() => {
        if (active) {
          setAggregation(aggregateProfileRecommenders(stableProfiles, stableApplications, { ownerId }))
        }
      })
    return () => {
      active = false
    }
  }, [stableApplications, ownerId, stableProfiles])

  return aggregation
}
