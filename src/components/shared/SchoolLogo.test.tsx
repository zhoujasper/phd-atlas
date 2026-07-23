import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import englishDossier from '../../i18n/en/dossier.json'
import { tpl } from '../../i18n'
import { I18nContext, type I18nContextValue } from '../hooks/useI18n'
import { SchoolLogoManager, SchoolLogoMark } from './SchoolLogo'

const validLogo = {
  dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  source: 'upload' as const,
  updatedAt: '2026-07-23T12:00:00.000Z',
}

function tx(path: string, fallback?: string) {
  const value = path.split('.').reduce<unknown>((current, key) => (
    current && typeof current === 'object'
      ? (current as Record<string, unknown>)[key]
      : undefined
  ), englishDossier)
  return typeof value === 'string' ? value : fallback ?? path
}

const i18nValue: I18nContextValue = {
  lang: 'en',
  t: englishDossier,
  ready: true,
  format: tpl,
  tx,
}

describe('SchoolLogo', () => {
  it('renders readable initials when no official image is stored', () => {
    render(<SchoolLogoMark schoolName="University of Cambridge" variant="list" />)
    expect(screen.getByText('UC')).toBeInTheDocument()
  })

  it('keeps website, direct-link, upload, and remove controls in one focused popover', async () => {
    const onResolve = vi.fn(async () => true)
    const onUpload = vi.fn(async () => true)
    const onRemove = vi.fn(async () => true)
    render(
      <I18nContext.Provider value={i18nValue}>
        <SchoolLogoManager
          schoolName="Example University"
          website="https://www.example.edu"
          logo={validLogo}
          autoDetectEnabled={false}
          onResolve={onResolve}
          onUpload={onUpload}
          onRemove={onRemove}
        />
      </I18nContext.Provider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Manage school logo' }))
    expect(await screen.findByRole('dialog', { name: 'Manage school logo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Refresh from school website/u })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Upload an image/u })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Use a direct image link/u }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Use a direct image link' }), {
      target: { value: 'https://assets.example.edu/logo.png' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Fetch' }))
    await waitFor(() => {
      expect(onResolve).toHaveBeenCalledWith({ imageUrl: 'https://assets.example.edu/logo.png' })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(onRemove).toHaveBeenCalledTimes(1))
  })
})
