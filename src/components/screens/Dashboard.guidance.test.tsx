import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { getDict, t, tpl } from '../../i18n'
import guidanceStyles from '../../styles/dashboard-guidance.css?raw'
import { I18nContext } from '../hooks/useI18n'
import { Dashboard, type DashboardGuidanceTeam } from './Dashboard'

const guidanceTeam: DashboardGuidanceTeam = {
  teamName: 'Atlas Lab',
  members: [{
    id: 'teacher-mei',
    name: 'Dr. Mei Chen',
    role: 'admin',
    title: 'Senior Advisor',
    department: 'Graduate Admissions',
    email: 'mei@example.edu',
    phone: '+44 20 7000 0000',
    office: 'Room 314',
    website: 'https://example.edu/mei',
    availability: 'Monday to Thursday',
    bio: 'Application strategy and writing feedback.',
  }],
}

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
  window.requestAnimationFrame ??= (callback) => window.setTimeout(() => callback(performance.now()), 0)
  window.cancelAnimationFrame ??= (handle) => window.clearTimeout(handle)
})

function renderDashboard() {
  return render(
    <I18nContext.Provider value={{
      lang: 'en',
      t: getDict('en'),
      format: tpl,
      tx: (path, fallback) => t('en', path, fallback),
    }}>
      <Dashboard
        applications={[]}
        guidanceTeam={guidanceTeam}
        onSelect={vi.fn()}
      />
    </I18nContext.Provider>,
  )
}

describe('student dashboard guidance team', () => {
  it('shows safe contact actions and progressively discloses advisor details', async () => {
    renderDashboard()

    expect(screen.getByRole('heading', { name: 'My guidance team' })).toBeInTheDocument()
    expect(screen.getByText('Atlas Lab')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Email Dr. Mei Chen' })).toHaveAttribute('href', 'mailto:mei@example.edu')
    expect(screen.getByRole('link', { name: 'Call Dr. Mei Chen' })).toHaveAttribute('href', 'tel:+442070000000')
    expect(screen.getByRole('link', { name: 'Open Dr. Mei Chen’s website' })).toHaveAttribute(
      'href',
      'https://example.edu/mei',
    )
    expect(screen.queryByText('Room 314')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show details for Dr. Mei Chen' }))

    expect(await screen.findByText('Room 314')).toBeInTheDocument()
    expect(screen.getByText('Monday to Thursday')).toBeInTheDocument()
    expect(screen.getByText('Application strategy and writing feedback.')).toBeInTheDocument()
  })

  it('keeps contact actions touch-friendly and stacks details on mobile', () => {
    expect(guidanceStyles).toContain('@media (max-width: 820px)')
    expect(guidanceStyles).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))')
    expect(guidanceStyles).toContain('.dashboard-guidance-detail-inner')
    expect(guidanceStyles).toContain('grid-template-columns: 1fr')
  })
})
