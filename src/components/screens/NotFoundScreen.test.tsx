import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDict, t, tpl } from '../../i18n'
import { I18nContext } from '../hooks/useI18n'
import { NotFoundScreen } from './NotFoundScreen'

afterEach(() => {
  cleanup()
})

function renderNotFound(props: Partial<Parameters<typeof NotFoundScreen>[0]> = {}) {
  const onAction = props.onAction ?? vi.fn()
  const onBack = props.onBack ?? vi.fn()
  render(
    <I18nContext.Provider
      value={{
        lang: 'en',
        t: getDict('en'),
        format: tpl,
        tx: (path, fallback) => t('en', path, fallback),
      }}
    >
      <NotFoundScreen
        kind="route"
        path="/missing/page"
        onAction={onAction}
        onBack={onBack}
        {...props}
      />
    </I18nContext.Provider>,
  )
  return { onAction, onBack }
}

describe('NotFoundScreen', () => {
  it('offers dashboard and back actions, and reveals diagnostics on demand', () => {
    const { onAction, onBack } = renderNotFound()

    fireEvent.click(screen.getByRole('button', { name: /back to dashboard/i }))
    expect(onAction).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /go back/i }))
    expect(onBack).toHaveBeenCalledTimes(1)

    const toggle = screen.getByRole('button', { name: /technical details/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(document.querySelector('.not-found-details')).not.toHaveClass('open')

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(document.querySelector('.not-found-details')).toHaveClass('open')

    const panel = document.querySelector('.not-found-details-panel')
    expect(panel).toBeTruthy()
    const details = within(panel as HTMLElement)
    expect(details.getByText('Error ID')).toBeInTheDocument()
    expect(details.getByText('/missing/page')).toBeInTheDocument()
    expect(details.getByText('Route navigation')).toBeInTheDocument()
    expect(details.getByText('GET')).toBeInTheDocument()
    expect(details.getByText('NOT_FOUND')).toBeInTheDocument()
  })

  it('shows application-specific request type copy', () => {
    renderNotFound({
      kind: 'application',
      title: 'Application not found',
      message: 'Missing application access.',
    })

    fireEvent.click(screen.getByRole('button', { name: /technical details/i }))
    const panel = document.querySelector('.not-found-details-panel') as HTMLElement
    const details = within(panel)
    expect(details.getByText('Application lookup')).toBeInTheDocument()
    expect(details.getByText('Missing application access.')).toBeInTheDocument()
  })
})
