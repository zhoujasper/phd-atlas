import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nContext } from '../hooks/useI18n'
import { AiProfilePanel } from './AiProfilePanel'

describe('AiProfilePanel', () => {
  it('uses an edit icon instead of an expand chevron', () => {
    const { container } = render(
      <I18nContext.Provider value={{
        lang: 'en',
        t: {},
        format: (template) => template,
        tx: (path) => path === 'profile.aiProfileTitle' ? 'Personal profile' : path,
      }}>
        <AiProfilePanel onUpdate={vi.fn()} />
      </I18nContext.Provider>,
    )

    expect(screen.getByRole('button', { name: /personal profile/i })).toBeInTheDocument()
    expect(container.querySelector('.ai-profile-edit-icon')).toHaveClass('lucide-pencil')
    expect(container.querySelector('.lucide-chevron-down')).not.toBeInTheDocument()
  })
})
