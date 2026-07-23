import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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
  it('guides an account without a usable key to configuration and blocks research', () => {
    const props = renderSheet()

    fireEvent.click(screen.getByRole('button', { name: 'Configure AI key' }))

    expect(props.onConfigureAiKeys).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Start update' })).toBeDisabled()
  })

  it('requires a selected saved key and has no AI opt-out control', () => {
    const props = renderSheet({ aiKeys: [savedKey], selectedKeyIds: ['key-1'] })

    expect(screen.queryByRole('switch', { name: 'Use AI research agents' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start update' }))

    expect(props.onSubmit).toHaveBeenCalledOnce()
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
