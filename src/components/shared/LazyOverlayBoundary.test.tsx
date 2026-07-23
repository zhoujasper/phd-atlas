import '@testing-library/jest-dom/vitest'
import { act, render, screen } from '@testing-library/react'
import { lazy, type ComponentType, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { I18nContext, useI18nValue } from '../hooks/useI18n'
import { LazyOverlayBoundary } from './LazyOverlayBoundary'

function TestI18nProvider({ children }: { children: ReactNode }) {
  const value = useI18nValue('en', ['core', 'shared'])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

describe('LazyOverlayBoundary', () => {
  it('paints an immediate status cue until a cold dialog chunk resolves', async () => {
    let resolveDialog!: (module: { default: ComponentType }) => void
    const ColdDialog = lazy(() => new Promise<{ default: ComponentType }>((resolve) => {
      resolveDialog = resolve
    }))

    render(
      <TestI18nProvider>
        <LazyOverlayBoundary namespaces={['core', 'shared']}>
          <ColdDialog />
        </LazyOverlayBoundary>
      </TestI18nProvider>,
    )

    expect(screen.getByRole('status')).toBeInTheDocument()

    await act(async () => {
      resolveDialog({ default: () => <div role="dialog">Loaded dialog</div> })
    })

    expect(await screen.findByRole('dialog')).toHaveTextContent('Loaded dialog')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
