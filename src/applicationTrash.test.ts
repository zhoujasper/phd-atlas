import { describe, expect, it } from 'vitest'
import type { ApplicationTrashItem } from './api/phdApi'
import { applicationTrashForScope } from './applicationTrash'

function trashItem(id: string, teamId: string | null): ApplicationTrashItem {
  return {
    id,
    deletedAt: '2026-08-02T10:00:00.000Z',
    expiresAt: '2026-09-01T10:00:00.000Z',
    application: {
      id: `application-${id}`,
      teamId,
    } as ApplicationTrashItem['application'],
  }
}

describe('applicationTrashForScope', () => {
  const items = [
    trashItem('personal', null),
    trashItem('team-a', 'team-a'),
    trashItem('team-b', 'team-b'),
  ]

  it('keeps Team deletions out of the personal recycle bin', () => {
    expect(applicationTrashForScope(items, { kind: 'personal' }).map((item) => item.id)).toEqual([
      'personal',
    ])
  })

  it('shows only entries deleted by this account for the active Team workspace', () => {
    expect(applicationTrashForScope(items, { kind: 'team', teamId: 'team-a' }).map((item) => item.id)).toEqual([
      'team-a',
    ])
    expect(applicationTrashForScope(items, { kind: 'team', teamId: null })).toEqual([])
  })
})
