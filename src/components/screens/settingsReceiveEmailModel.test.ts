import { describe, expect, it } from 'vitest'
import type { AuthSession } from '../../api/phdApi'
import {
  fallbackReceiveEmails,
  MAX_RECEIVE_EMAILS,
  normalizeReceiveEmails,
} from './settingsReceiveEmailModel'

describe('settings receive-email model', () => {
  it('normalizes duplicates and chooses the first verified mailbox as primary', () => {
    expect(normalizeReceiveEmails([
      { address: ' First@Example.edu ', isPrimary: true, notify: true, verified: false },
      { address: 'second@example.edu', isPrimary: false, notify: false, verified: true },
      { address: 'first@example.edu', isPrimary: true, notify: true, verified: true },
    ])).toEqual([
      { address: 'first@example.edu', isPrimary: false, notify: true, verified: false },
      { address: 'second@example.edu', isPrimary: true, notify: false, verified: true },
    ])
  })

  it('uses the configured address list or the account address fallback without exceeding the cap', () => {
    const session = {
      user: {
        email: 'account@example.edu',
        settings: {
          receiveEmails: Array.from({ length: MAX_RECEIVE_EMAILS + 1 }, (_, index) => ({
            address: `mailbox-${index}@example.edu`,
            isPrimary: index === 0,
            notify: true,
          })),
        },
      },
    } as AuthSession

    expect(fallbackReceiveEmails(session)).toHaveLength(MAX_RECEIVE_EMAILS)
    expect(fallbackReceiveEmails({
      user: { email: 'account@example.edu', settings: {} },
    } as AuthSession)).toEqual([{
      address: 'account@example.edu',
      isPrimary: true,
      notify: true,
      verified: true,
    }])
  })
})
