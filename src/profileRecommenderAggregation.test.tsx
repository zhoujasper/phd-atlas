import { describe, expect, it } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { useProfileRecommenderAggregation } from './profileRecommenderAggregation'
import type { ProfileRecommender } from './api/phdApi'
import type { ApplicationRecord } from './data/applications'

function Probe({
  profiles,
  applications,
  onRender,
}: {
  profiles: readonly ProfileRecommender[]
  applications: readonly ApplicationRecord[]
  onRender: () => void
}) {
  onRender()
  const aggregation = useProfileRecommenderAggregation(profiles, applications, 'owner-1')
  return <span data-testid="count">{aggregation.directory.length}</span>
}

describe('useProfileRecommenderAggregation', () => {
  // Regression: the common caller expression is
  // `settings.profileRecommenders ?? []`, which allocates a new array on every
  // render whenever the setting is absent -- the normal state for an account
  // that never added a recommender. Depending on that identity re-ran the
  // effect, which set state, which re-rendered, without end. In the app that
  // meant the boot curtain never lifted, so this must settle rather than spin.
  it('settles when the caller passes a new empty array on every render', async () => {
    let renders = 0
    const { rerender, getByTestId } = render(
      <Probe profiles={[]} applications={[]} onRender={() => { renders += 1 }} />,
    )

    // Fresh array literals each time, exactly as `?? []` produces.
    for (let pass = 0; pass < 3; pass += 1) {
      rerender(<Probe profiles={[]} applications={[]} onRender={() => { renders += 1 }} />)
    }

    await waitFor(() => expect(getByTestId('count').textContent).toBe('0'))
    const settledRenders = renders
    await new Promise((resolve) => setTimeout(resolve, 150))
    // A self-perpetuating effect keeps incrementing after the tree is idle.
    expect(renders).toBe(settledRenders)
  })

  it('recomputes when the list contents actually change', async () => {
    const profile: ProfileRecommender = {
      id: 'profile-1',
      name: 'Professor One',
      email: 'one@example.edu',
      phone: '',
      title: 'Professor',
      institution: 'Example University',
      relationship: 'Research supervisor',
      notes: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const { rerender, getByTestId } = render(
      <Probe profiles={[]} applications={[]} onRender={() => {}} />,
    )
    await waitFor(() => expect(getByTestId('count').textContent).toBe('0'))

    rerender(<Probe profiles={[profile]} applications={[]} onRender={() => {}} />)
    await waitFor(() => expect(getByTestId('count').textContent).toBe('1'))
  })
})
