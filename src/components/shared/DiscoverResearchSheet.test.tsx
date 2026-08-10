import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiKey } from '../../api/phdApi'
import { DEFAULT_INTAKE } from '../../data/discover'
import { getDict, t, tpl } from '../../i18n'
import { I18nContext } from '../hooks/useI18n'
import { DiscoverResearchSheet } from './DiscoverResearchSheet'

const savedKey: AiKey = {
  id: 'key-1',
  ownerId: 'user-1',
  teamId: null,
  scope: 'personal',
  provider: 'openai',
  label: 'Research model',
  model: 'gpt-test',
  baseUrl: '',
  maxConcurrency: 1,
  createdAt: '2026-07-23T00:00:00.000Z',
  updatedAt: '2026-07-23T00:00:00.000Z',
  lastUsedAt: null,
  usage: { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, resetAt: null },
  secretSet: true,
}

function renderSheet(overrides: Partial<Parameters<typeof DiscoverResearchSheet>[0]> = {}) {
  const props: Parameters<typeof DiscoverResearchSheet>[0] = {
    open: true,
    meta: null,
    draft: { ...DEFAULT_INTAKE, field: 'Computer science' },
    applications: [],
    useApplicationSeeds: false,
    aiKeys: [],
    selectedKeyIds: [],
    researching: false,
    submissionPhase: 'idle',
    submissionError: null,
    onClose: vi.fn(),
    onDraftChange: vi.fn(),
    onUseApplicationSeedsChange: vi.fn(),
    onSelectedKeyIdsChange: vi.fn(),
    onConfigureAiKeys: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  }
  render(
    <I18nContext.Provider value={{
      lang: 'en',
      t: getDict('en'),
      format: tpl,
      tx: (path, fallback) => t('en', path, fallback),
    }}>
      <DiscoverResearchSheet {...props} />
    </I18nContext.Provider>,
  )
  return props
}

describe('DiscoverResearchSheet AI requirements', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('guides an account without a usable key to configuration and blocks research', () => {
    const props = renderSheet()

    fireEvent.click(screen.getByRole('button', { name: 'Configure AI key' }))

    expect(props.onConfigureAiKeys).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Start update' })).toBeDisabled()
  })

  it('requires a selected saved key and has no AI opt-out control', () => {
    const props = renderSheet({ aiKeys: [savedKey], selectedKeyIds: ['key-1'] })

    expect(document.querySelector('.discover-sheet-section input[required]')).toBeRequired()
    expect(screen.queryByRole('switch', { name: 'Use AI research agents' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start update' }))

    expect(props.onSubmit).toHaveBeenCalledOnce()
  })

  it('uses evidence-exhaustive coverage without program or advisor count inputs', () => {
    renderSheet({ aiKeys: [savedKey], selectedKeyIds: ['key-1'] })

    expect(screen.getByText('No result quota')).toBeVisible()
    expect(screen.queryByText('Programs to rank')).not.toBeInTheDocument()
    expect(screen.queryByText('Advisors per program')).not.toBeInTheDocument()
    expect(screen.getByRole('spinbutton')).toHaveAttribute('min', '0')
    expect(screen.getByRole('spinbutton')).not.toHaveAttribute('max')
  })

  it('shows the configuration validation progress before handing work to the background server', () => {
    renderSheet({
      aiKeys: [savedKey],
      selectedKeyIds: ['key-1'],
      researching: true,
      submissionPhase: 'validating',
    })

    expect(screen.getByText('Checking model access and configuration…', {
      selector: '.discover-research-validation-copy strong',
    })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Checking model access and configuration…' })).toBeDisabled()
  })

  it('keeps the queued sheet mounted for its exit motion before closing', () => {
    vi.useFakeTimers()
    const props = renderSheet({
      aiKeys: [savedKey],
      selectedKeyIds: ['key-1'],
      researching: true,
      submissionPhase: 'queued',
    })

    expect(screen.getByRole('dialog')).toHaveClass('is-exiting')
    expect(props.onClose).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(219)
    })
    expect(props.onClose).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('shows only the authorized team target choices supplied by the parent', () => {
    const onTeamTargetChange = vi.fn()
    renderSheet({
      aiKeys: [savedKey],
      selectedKeyIds: ['key-1'],
      teamTargetUserId: 'student-a',
      teamTargetOptions: [{ id: 'student-a', name: 'Student A', email: 'a@example.com', count: 2 }],
      onTeamTargetChange,
    })

    const targetPicker = screen.getAllByRole('button', { name: 'Student' })
      .find((button) => button.getAttribute('aria-haspopup') === 'listbox')
    expect(targetPicker).toBeTruthy()
    fireEvent.mouseDown(targetPicker!)

    expect(screen.getByRole('option', { name: /Student A/ })).toBeInTheDocument()
    expect(screen.queryByText('Student B')).not.toBeInTheDocument()
  })
})
