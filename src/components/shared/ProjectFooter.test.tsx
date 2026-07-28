import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nContext, type I18nContextValue } from '../hooks/useI18n'
import { ProjectFooter } from './ProjectFooter'

const context: I18nContextValue = {
  lang: 'en',
  t: {},
  format: (template, values) => template.replace('{method}', String(values.method)),
  tx: (path, fallback) => ({
    close: 'Close',
    'projectFooter.ariaLabel': 'Project information',
    'projectFooter.projectName': 'PhD Atlas',
    'projectFooter.authorName': 'Jasper Zhou',
    'projectFooter.projectHome': 'Open PhD Atlas home',
    'projectFooter.by': 'By',
    'projectFooter.repository': 'GitHub',
    'projectFooter.repositoryAria': 'Open the PhD Atlas GitHub repository',
    'projectFooter.support': 'Support',
    'projectFooter.supportAria': 'Support PhD Atlas',
    'projectFooter.dialogTitle': 'Give PhD Atlas a little boost',
    'projectFooter.dialogDescription': 'Pick whichever feels easiest to scan.',
    'projectFooter.wechat': 'WeChat Pay',
    'projectFooter.alipay': 'Alipay',
    'projectFooter.qrAlt': '{method} payment QR code',
  })[path] ?? fallback ?? path,
}

function renderFooter() {
  return render(
    <I18nContext.Provider value={context}>
      <ProjectFooter />
    </I18nContext.Provider>,
  )
}

describe('ProjectFooter', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('shows the project, author, repository, and support entry', () => {
    renderFooter()

    expect(screen.getByRole('link', { name: 'Open PhD Atlas home' })).toHaveTextContent('PhD Atlas')
    expect(screen.getByText('Jasper Zhou')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open the PhD Atlas GitHub repository' })).toHaveAttribute(
      'href',
      'https://github.com/zhoujasper/phd-atlas',
    )
    expect(screen.getByRole('button', { name: 'Support PhD Atlas' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('decodes the artwork before opening both codes and keeps the exit motion mounted', async () => {
    vi.useFakeTimers()
    const decodeResolvers: Array<() => void> = []
    class DeferredImage {
      complete = false
      decoding = ''
      onerror: (() => void) | null = null
      onload: (() => void) | null = null

      decode() {
        return new Promise<void>((resolve) => decodeResolvers.push(resolve))
      }

      set src(_source: string) {
        this.complete = true
        this.onload?.()
      }
    }
    vi.stubGlobal('Image', DeferredImage)
    renderFooter()

    fireEvent.click(screen.getByRole('button', { name: 'Support PhD Atlas' }))
    expect(screen.queryByRole('dialog', { name: 'Give PhD Atlas a little boost' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Support PhD Atlas' })).toHaveAttribute('aria-busy', 'true')

    await act(async () => {
      decodeResolvers.forEach((resolve) => resolve())
      await Promise.resolve()
    })

    expect(screen.getByRole('dialog', { name: 'Give PhD Atlas a little boost' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'WeChat Pay payment QR code' })).toHaveAttribute(
      'src',
      '/assets/support/wechat-pay-qr.png',
    )
    expect(screen.getByRole('img', { name: 'Alipay payment QR code' })).toHaveAttribute(
      'src',
      '/assets/support/alipay-qr.png',
    )
    expect(document.querySelector('.project-support-method.is-wechat .project-support-art-backdrop')).toHaveAttribute(
      'src',
      '/assets/support/wechat-support-art.png',
    )
    expect(document.querySelector('.project-support-method.is-alipay .project-support-art-backdrop')).toHaveAttribute(
      'src',
      '/assets/support/alipay-support-art.png',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(document.querySelector('.project-support-layer')).toHaveClass('exiting')

    act(() => vi.advanceTimersByTime(160))
    expect(screen.queryByRole('dialog', { name: 'Give PhD Atlas a little boost' })).not.toBeInTheDocument()
  })
})
