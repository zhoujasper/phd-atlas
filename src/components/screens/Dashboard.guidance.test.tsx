import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { getDict, registerLanguage, t, tpl, type LangDict } from '../../i18n'
import englishDashboard from '../../i18n/en/dashboard.json'
import guidanceStyles from '../../styles/dashboard-guidance.css?raw'
import { I18nContext } from '../hooks/useI18n'
import { Dashboard, type DashboardGuidanceTeam } from './Dashboard'
import appSource from '../../App.tsx?raw'

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

registerLanguage('en', englishDashboard as LangDict, 'dashboard')

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

function renderDashboard(
  team = guidanceTeam,
  onSendGuidanceMessage = vi.fn(async () => {}),
) {
  return render(
    <I18nContext.Provider value={{
      lang: 'en',
      t: getDict('en'),
      format: tpl,
      tx: (path, fallback) => t('en', path, fallback),
    }}>
      <Dashboard
        applications={[]}
        guidanceTeam={team}
        onSendGuidanceMessage={onSendGuidanceMessage}
        onSelect={vi.fn()}
      />
    </I18nContext.Provider>,
  )
}

describe('student dashboard guidance team', () => {
  it('shows the saved title after the name and offers in-app or email contact', async () => {
    renderDashboard()

    expect(screen.getByRole('heading', { name: 'My guidance team' })).toBeInTheDocument()
    expect(screen.getByText('Atlas Lab')).toBeInTheDocument()
    expect(screen.getByText('MC')).toHaveClass('dashboard-guidance-avatar-fallback')
    expect(screen.getByText('Senior Advisor')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Contact Dr. Mei Chen' }))
    expect(await screen.findByRole('button', { name: 'In-app message' })).toBeInTheDocument()
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

  it('sends a direct in-app message through the compact composer', async () => {
    const onSend = vi.fn(async () => {})
    renderDashboard(guidanceTeam, onSend)

    fireEvent.click(screen.getByRole('button', { name: 'Contact Dr. Mei Chen' }))
    fireEvent.click(await screen.findByRole('button', { name: 'In-app message' }))
    fireEvent.change(await screen.findByPlaceholderText('Short notification title'), {
      target: { value: 'Draft review' },
    })
    fireEvent.change(screen.getByPlaceholderText('Write the message recipients will see.'), {
      target: { value: 'Could you review my research statement?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send notification' }))

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith(
        'teacher-mei',
        'Draft review',
        'Could you review my research statement?',
      )
    })
  })

  it('loads additional guidance members when the bounded list nears its end', async () => {
    const manyMembers: DashboardGuidanceTeam = {
      teamName: 'Atlas Lab',
      members: Array.from({ length: 8 }, (_, index) => ({
        id: `teacher-${index + 1}`,
        name: `Teacher ${index + 1}`,
        role: 'admin' as const,
        email: `teacher${index + 1}@example.edu`,
      })),
    }
    const view = renderDashboard(manyMembers)
    const list = view.container.querySelector<HTMLElement>('.dashboard-guidance-list')!
    expect(screen.getByText('Teacher 5')).toBeInTheDocument()
    expect(screen.queryByText('Teacher 6')).not.toBeInTheDocument()
    Object.defineProperties(list, {
      clientHeight: { configurable: true, value: 280 },
      scrollHeight: { configurable: true, value: 520 },
      scrollTop: { configurable: true, value: 230, writable: true },
    })

    fireEvent.scroll(list)

    expect(await screen.findByText('Teacher 8')).toBeInTheDocument()
  })

  it('keeps compact contact actions and one-line member rows on mobile', () => {
    expect(guidanceStyles).toContain('.dashboard-lead-row.has-guidance')
    expect(guidanceStyles).toContain('grid-template-columns: minmax(0, 1fr) minmax(292px, 336px)')
    expect(guidanceStyles).toContain('@media (max-width: 1100px)')
    expect(guidanceStyles).toContain('@media (max-width: 820px)')
    expect(guidanceStyles).toContain('grid-template-columns: 36px minmax(0, 1fr) auto 28px')
    expect(guidanceStyles).toContain('width: 28px')
    expect(guidanceStyles).toContain('max-height: min(46dvh, 320px)')
    expect(guidanceStyles).toContain('.dashboard-guidance-detail-inner')
  })

  it('provides an explicit functional collapse control for the guidance panel', () => {
    renderDashboard()
    const collapse = screen.getByRole('button', { name: 'Collapse My guidance team' })
    expect(collapse).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(collapse)

    expect(screen.getByRole('button', { name: 'Expand My guidance team' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('mounts guidance only on the student Team overview, never on the personal dashboard', () => {
    expect(appSource).toContain("screen === 'team'")
    expect(appSource).toContain("teamViewerRole === 'member'")
    expect(appSource).toContain("teamSection === 'overview'")
    expect(appSource).toContain('guidanceTeam={isTeamStudentDashboard ? studentGuidanceTeam : undefined}')
    expect(appSource).not.toContain('guidanceTeam={!isTeamMode ? studentGuidanceTeam : undefined}')
  })
})
