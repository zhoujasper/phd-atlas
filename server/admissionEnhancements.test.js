import { describe, expect, it, vi } from 'vitest'
import {
  getAdmissionHistoryTrend,
  saveAdmissionHistorySnapshot,
} from './admissionEnhancements.js'

describe('admission lookup observations', () => {
  it('stores the report target and preserves an unknown accepted share as null', () => {
    const run = vi.fn()
    const prepare = vi.fn(() => ({ run }))
    const db = { prepare }

    saveAdmissionHistorySnapshot(db, 'user-1', 'application-1', {
      target: {
        school: 'University of Oxford',
        program: 'DPhil Computer Science',
        advisorName: 'Andrew Zisserman',
      },
      outcomes: {
        query: { school: 'wrong fallback', program: 'wrong fallback' },
        summary: { total: 1, accepted: 0, acceptedShare: null },
      },
      advisor: {
        query: { name: 'wrong fallback' },
        funding: { hasPublicAward: true, awardCount: 2 },
      },
    })

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-1',
      application_id: 'application-1',
      school_name: 'University of Oxford',
      program_name: 'DPhil Computer Science',
      advisor_name: 'Andrew Zisserman',
      accepted_share: null,
      has_public_award: 1,
      award_count: 2,
    }))
  })

  it('returns an observation date and never aliases it to an admission year', () => {
    const all = vi.fn(() => [{
      observedAt: '2026-08-09',
      accepted: 3,
      total: 5,
      acceptedShare: 0.6,
      hasPublicAward: 1,
      awardCount: 2,
    }])
    const prepare = vi.fn(() => ({ all }))

    const observations = getAdmissionHistoryTrend({ prepare }, 'user-1', 'application-1', 10)

    expect(prepare.mock.calls[0][0]).toContain('query_date as observedAt')
    expect(prepare.mock.calls[0][0]).not.toContain('query_date as year')
    expect(observations).toEqual([expect.objectContaining({
      observedAt: '2026-08-09',
      hasPublicAward: true,
    })])
    expect(observations[0]).not.toHaveProperty('year')
  })
})
