import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import englishDossier from '../../i18n/en/dossier.json'
import { tpl } from '../../i18n'
import logoStyles from '../../styles/school-logo.css?raw'
import { I18nContext, type I18nContextValue } from '../hooks/useI18n'
import { SchoolLogoManager, SchoolLogoMark } from './SchoolLogo'

const normalizedLogoStyles = logoStyles.replace(/\r\n/g, '\n')

function cssRule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = normalizedLogoStyles.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))
  expect(match, `Missing CSS rule: ${selector}`).not.toBeNull()
  return match?.[1] ?? ''
}

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

  it('renders stored marks edge-to-edge without clipping or a framed white canvas', () => {
    const imageMark = cssRule('.school-logo-mark.has-image')
    const image = cssRule('.school-logo-mark img')
    const trigger = cssRule('button.school-logo-trigger.has-image')
    const headerMark = cssRule('button.school-logo-trigger.has-image .school-logo-mark-header')
    const previewMark = cssRule('.school-logo-mark-preview.has-image')

    expect(imageMark).toContain('padding: 0')
    expect(imageMark).toContain('border: 0')
    expect(imageMark).toContain('background: transparent')
    expect(image).toContain('height: 100%')
    expect(image).toContain('object-fit: contain')
    expect(image).toContain('border-radius: inherit')
    expect(trigger).toContain('padding: 0')
    expect(trigger).toContain('border: 0')
    expect(trigger).toContain('background: transparent')
    expect(headerMark).toContain('height: 52px')
    expect(previewMark).toContain('min-width: 48px')
    expect(previewMark).toContain('max-width: 64px')
  })

  it('accepts either another school website or a direct image link in one focused popover', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: /Get logo from a link/u }))
    fireEvent.change(screen.getByRole('textbox', { name: 'School website' }), {
      target: { value: 'www.cam.ac.uk' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Fetch' }))
    await waitFor(() => {
      expect(onResolve).toHaveBeenCalledWith({ website: 'https://www.cam.ac.uk', refresh: true })
    })

    fireEvent.click(screen.getByRole('tab', { name: 'Direct image link' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Direct image link' }), {
      target: { value: 'assets.example.edu/logo.png' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Fetch' }))
    await waitFor(() => {
      expect(onResolve).toHaveBeenCalledWith({ imageUrl: 'https://assets.example.edu/logo.png' })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(onRemove).toHaveBeenCalledTimes(1))
  })
})
