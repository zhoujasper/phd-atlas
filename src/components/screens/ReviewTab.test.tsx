import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ApplicationRecord } from '../../data/applications'
import { getDict, preloadLanguage, t, tpl } from '../../i18n'
import { I18nContext } from '../hooks/useI18n'
import ReviewTab from './ReviewTab'

const application = {
  id: 'review-motion-application',
  ownerId: 'review-user',
  teamId: 'team-review',
  reviewComments: [{
    id: 'comment-1',
    authorId: 'advisor-1',
    authorName: 'Advisor',
    body: 'Please make the opening paragraph more specific.',
    createdAt: '2026-07-18T10:00:00.000Z',
  }],
} as unknown as ApplicationRecord

describe('ReviewTab reply motion', () => {
  it('keeps the reply composer mounted so opening and cancelling use the shared smooth collapse', async () => {
    await preloadLanguage('en', ['review', 'team'])
    const user = userEvent.setup()
    const view = render(
      <I18nContext.Provider value={{ lang: 'en', t: getDict('en'), format: tpl, tx: (path, fallback) => t('en', path, fallback) }}>
        <ReviewTab application={application} token="review-test-token" currentUserId="review-user" onCommentAdded={vi.fn()} />
      </I18nContext.Provider>,
    )

    const panel = view.container.querySelector('.review-reply-composer-panel')
    expect(panel).toHaveAttribute('data-collapsible-open', 'false')
    expect(panel).not.toHaveClass('open')

    await user.click(screen.getByRole('button', { name: 'Reply' }))
    await waitFor(() => expect(panel).toHaveClass('open'))
    expect(panel).toHaveAttribute('data-collapsible-open', 'true')

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(panel).not.toHaveClass('open'))
    expect(panel).toHaveAttribute('data-collapsible-open', 'false')
  })
})
