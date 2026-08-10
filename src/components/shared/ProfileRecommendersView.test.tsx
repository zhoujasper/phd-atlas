import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ProfileRecommender } from '../../api/phdApi'
import type { ApplicationRecord, MaterialRecommender } from '../../data/applications'
import { getDict, registerLanguage, t, tpl, type LangDict } from '../../i18n'
import englishProfile from '../../i18n/en/profile.json'
import { I18nContext } from '../hooks/useI18n'
import { ProfileRecommendersView } from './ProfileRecommendersView'

registerLanguage('en', englishProfile as LangDict, 'profile')

const savedProfile: ProfileRecommender = {
  id: 'ada-profile',
  name: 'Professor Ada Lovelace',
  email: 'ada@example.edu',
  phone: '',
  title: 'Professor',
  institution: 'Analytical Engine Institute',
  relationship: 'Research supervisor',
  notes: 'Private context',
}

function application({
  id,
  school,
  deadline,
  recommenders,
}: {
  id: string
  school: string
  deadline: string
  recommenders: MaterialRecommender[]
}): ApplicationRecord {
  return {
    id,
    ownerId: 'owner-a',
    school: { name: school, country: '', website: '' },
    program: 'Computer Science PhD',
    deadline,
    materials: [
      {
        id: `${id}-recommendations`,
        name: 'Recommendation letters',
        type: 'Request',
        status: 'Not started',
        version: '',
        updatedAt: '',
        recommenders,
      },
    ],
  } as ApplicationRecord
}

function renderDirectory(
  profiles: readonly ProfileRecommender[],
  applications: readonly ApplicationRecord[],
  onOpenApplication = vi.fn(),
) {
  return {
    onOpenApplication,
    ...render(
      <I18nContext.Provider
        value={{
          lang: 'en',
          t: getDict('en'),
          format: tpl,
          tx: (path, fallback) => t('en', path, fallback),
        }}
      >
        <ProfileRecommendersView
          profiles={profiles}
          applications={applications}
          ownerId="owner-a"
          onChange={vi.fn()}
          onOpenApplication={onOpenApplication}
        />
      </I18nContext.Provider>,
    ),
  }
}

describe('ProfileRecommendersView directory', () => {
  it('renders one continuous directory and opens one button per distinct application', async () => {
    const user = userEvent.setup()
    const cambridge = application({
      id: 'cambridge',
      school: 'University of Cambridge',
      deadline: '2026-12-03',
      recommenders: [
        { id: 'ada-slot-one', name: 'Ada', contact: 'ada@example.edu' },
        { id: 'ada-slot-two', name: 'Ada Lovelace', contact: 'ADA@example.edu' },
        { id: 'kim-slot', name: 'Professor Daniel Kim', contact: 'dkim@mit.edu' },
        { id: 'blank-slot', name: '', contact: '' },
      ],
    })
    const mit = application({
      id: 'mit',
      school: 'MIT',
      deadline: '2026-12-15',
      recommenders: [{ id: 'ada-mit-slot', name: 'Ada', contact: 'ada@example.edu' }],
    })
    const { container, onOpenApplication } = renderDirectory([savedProfile], [cambridge, mit])

    expect(screen.getByText('2 recommenders')).toBeInTheDocument()
    expect(screen.getAllByText('2 applications')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Import' })).not.toBeInTheDocument()
    expect(container.querySelectorAll('.profile-recommender-directory-list > li')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /Open application:/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show or hide details for Professor Ada Lovelace' }))
    const detail = document.getElementById('profile-recommender-detail-profile%3Aada-profile')
    expect(detail).not.toBeNull()
    const applicationButtons = within(detail as HTMLElement).getAllByRole('button', {
      name: /Open application:/,
    })
    expect(applicationButtons).toHaveLength(2)
    expect(applicationButtons[0]).toHaveTextContent('University of Cambridge')
    expect(applicationButtons[0]).toHaveTextContent('Deadline: Dec 3, 2026')
    expect(applicationButtons[1]).toHaveTextContent('MIT')

    await user.click(applicationButtons[1])
    expect(onOpenApplication).toHaveBeenCalledTimes(1)
    expect(onOpenApplication.mock.calls[0]?.[0]).toMatchObject({ applicationId: 'mit' })

    expect(screen.getByRole('button', { name: 'Edit Professor Ada Lovelace' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Professor Ada Lovelace' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show or hide details for Professor Daniel Kim' }))
    expect(screen.queryByRole('button', { name: 'Edit Professor Daniel Kim' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete Professor Daniel Kim' })).not.toBeInTheDocument()
  })

  it('keeps the explanation behind an accessible info control and searches the unified rows', async () => {
    const user = userEvent.setup()
    const description =
      'Everyone named in your applications appears here automatically. Expand a recommender to review every project and deadline; saved private details stay editable without changing old applications.'
    const view = renderDirectory(
      [savedProfile],
      [
        application({
          id: 'cambridge',
          school: 'University of Cambridge',
          deadline: '2026-12-03',
          recommenders: [{ id: 'blank-slot', name: '', contact: '' }],
        }),
      ],
    )

    const infoTrigger = screen.getByRole('button', { name: description })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    await user.click(infoTrigger)
    expect(infoTrigger).toHaveAccessibleDescription(description)
    expect(screen.getByRole('tooltip')).toHaveTextContent(description)
    expect(view.container.querySelector('.profile-recommenders-hero p')).not.toBeInTheDocument()
    expect(screen.queryByText('Unnamed recommender')).not.toBeInTheDocument()

    await user.type(screen.getByRole('searchbox', { name: 'Search recommenders' }), 'Analytical Engine')
    expect(screen.getByText('Professor Ada Lovelace')).toBeInTheDocument()
    await user.clear(screen.getByRole('searchbox', { name: 'Search recommenders' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search recommenders' }), 'not present')
    expect(screen.getByText('No matching recommenders')).toBeInTheDocument()
  })

  it('renders a bounded first batch, progressively reveals more, and searches the complete directory', async () => {
    const user = userEvent.setup()
    const profiles = Array.from({ length: 386 }, (_, index): ProfileRecommender => ({
      ...savedProfile,
      id: `profile-${index + 1}`,
      name: `Recommender ${String(index + 1).padStart(3, '0')}`,
      email: `recommender.${index + 1}@example.edu`,
    }))
    const view = renderDirectory(profiles, [])
    const renderedRows = () => view.container.querySelectorAll('.profile-recommender-directory-list > li')

    expect(screen.getByText('386 recommenders')).toBeInTheDocument()
    expect(renderedRows()).toHaveLength(20)
    expect(screen.queryByText('Recommender 386')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show 20 more recommenders' }))
    await waitFor(() => expect(renderedRows()).toHaveLength(40))

    const search = screen.getByRole('searchbox', { name: 'Search recommenders' })
    await user.type(search, 'Recommender 386')
    expect(screen.getByText('Recommender 386')).toBeInTheDocument()
    expect(renderedRows()).toHaveLength(1)

    await user.clear(search)
    expect(renderedRows()).toHaveLength(20)
    expect(screen.queryByText('Recommender 386')).not.toBeInTheDocument()
  })
})
