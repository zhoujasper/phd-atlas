import '@testing-library/jest-dom/vitest'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ScreenSkeleton, PanelSkeleton } from './ScreenSkeleton'

describe('ScreenSkeleton', () => {
  it('renders generic skeleton by default', () => {
    render(<ScreenSkeleton />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Loading')
  })

  it('renders dashboard skeleton', () => {
    render(<ScreenSkeleton type="dashboard" />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Loading dashboard')
    expect(screen.getByRole('status')).toHaveClass('screen-skeleton')
  })

  it('renders dossier skeleton', () => {
    render(<ScreenSkeleton type="dossier" />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Loading application')
  })

  it('renders profile skeleton', () => {
    render(<ScreenSkeleton type="profile" />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Loading profile')
    expect(screen.getByRole('status')).toHaveClass('screen-skeleton-profile')
  })

  it('renders settings skeleton', () => {
    render(<ScreenSkeleton type="settings" />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Loading settings')
  })

  it('applies custom className', () => {
    render(<ScreenSkeleton className="custom-class" />)
    expect(screen.getByRole('status')).toHaveClass('custom-class')
  })

  it('dashboard skeleton has 4 stat cards', () => {
    render(<ScreenSkeleton type="dashboard" />)
    const stats = screen.getByRole('status').querySelectorAll('.screen-skeleton-stat')
    expect(stats).toHaveLength(4)
  })

  it('dashboard skeleton has 4 content cards', () => {
    render(<ScreenSkeleton type="dashboard" />)
    const cards = screen.getByRole('status').querySelectorAll('.loading-skeleton-card')
    expect(cards).toHaveLength(4)
  })

  it('dossier skeleton has tabs', () => {
    render(<ScreenSkeleton type="dossier" />)
    const tabs = screen.getByRole('status').querySelector('.screen-skeleton-tabs')
    expect(tabs).toBeInTheDocument()
    expect(tabs?.querySelectorAll('span')).toHaveLength(5)
  })

  it('dossier skeleton has tall cards', () => {
    render(<ScreenSkeleton type="dossier" />)
    const tallCards = screen.getByRole('status').querySelectorAll('.loading-skeleton-card.tall')
    expect(tallCards).toHaveLength(3)
  })

  it('profile skeleton has 3 stats', () => {
    render(<ScreenSkeleton type="profile" />)
    const stats = screen.getByRole('status').querySelectorAll('.screen-skeleton-stat')
    expect(stats).toHaveLength(3)
  })

  it('settings skeleton has setting rows', () => {
    render(<ScreenSkeleton type="settings" />)
    const settings = screen.getByRole('status').querySelector('.screen-skeleton-settings')
    expect(settings).toBeInTheDocument()
    const rows = settings?.querySelectorAll('.screen-skeleton-setting-row')
    expect(rows).toHaveLength(6)
  })

  it('all skeletons have hero section', () => {
    const types: Array<'dashboard' | 'dossier' | 'profile' | 'settings' | 'generic'> = [
      'dashboard',
      'dossier',
      'profile',
      'settings',
      'generic',
    ]

    types.forEach(type => {
      const { container } = render(<ScreenSkeleton type={type} />)
      const hero = container.querySelector('.screen-skeleton-hero')
      expect(hero).toBeInTheDocument()
    })
  })
})

describe('PanelSkeleton', () => {
  it('renders list panel skeleton by default', () => {
    render(<PanelSkeleton />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Loading')
  })

  it('renders applications panel skeleton', () => {
    render(<PanelSkeleton type="applications" />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Loading applications')
    expect(screen.getByRole('status')).toHaveClass('pane-skeleton-applications')
  })

  it('renders inspector panel skeleton', () => {
    render(<PanelSkeleton type="inspector" />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Loading details')
    expect(screen.getByRole('status')).toHaveClass('pane-skeleton-inspector')
  })

  it('applies custom className', () => {
    render(<PanelSkeleton className="custom-panel" />)
    expect(screen.getByRole('status')).toHaveClass('custom-panel')
  })

  it('list type has search and chips', () => {
    render(<PanelSkeleton type="list" />)
    const container = screen.getByRole('status')
    expect(container.querySelector('.pane-skeleton-search')).toBeInTheDocument()
    expect(container.querySelector('.pane-skeleton-chips')).toBeInTheDocument()
  })

  it('applications type has search and chips', () => {
    render(<PanelSkeleton type="applications" />)
    const container = screen.getByRole('status')
    expect(container.querySelector('.pane-skeleton-search')).toBeInTheDocument()
    expect(container.querySelector('.pane-skeleton-chips')).toBeInTheDocument()
  })

  it('inspector type does not have search and chips', () => {
    render(<PanelSkeleton type="inspector" />)
    const container = screen.getByRole('status')
    expect(container.querySelector('.pane-skeleton-search')).not.toBeInTheDocument()
    expect(container.querySelector('.pane-skeleton-chips')).not.toBeInTheDocument()
  })

  it('list type has 5 rows', () => {
    render(<PanelSkeleton type="list" />)
    const rows = screen.getByRole('status').querySelectorAll('.pane-skeleton-row')
    expect(rows).toHaveLength(5)
  })

  it('inspector type has ring and cards', () => {
    render(<PanelSkeleton type="inspector" />)
    const container = screen.getByRole('status')
    expect(container.querySelector('.pane-skeleton-ring')).toBeInTheDocument()
    expect(container.querySelectorAll('.loading-skeleton-card')).toHaveLength(3)
  })

  it('all panel types have heading', () => {
    const types: Array<'applications' | 'inspector' | 'list'> = ['applications', 'inspector', 'list']

    types.forEach(type => {
      const { container } = render(<PanelSkeleton type={type} />)
      const heading = container.querySelector('.pane-skeleton-heading')
      expect(heading).toBeInTheDocument()
    })
  })

  it('chips render correct count', () => {
    render(<PanelSkeleton type="applications" />)
    const chips = screen.getByRole('status').querySelectorAll('.pane-skeleton-chips span')
    expect(chips).toHaveLength(3)
  })

  it('row structure has avatar and content', () => {
    render(<PanelSkeleton type="list" />)
    const firstRow = screen.getByRole('status').querySelector('.pane-skeleton-row')
    expect(firstRow?.querySelector('.pane-skeleton-avatar')).toBeInTheDocument()
    expect(firstRow?.querySelectorAll('.skeleton')).toHaveLength(2)
  })
})
