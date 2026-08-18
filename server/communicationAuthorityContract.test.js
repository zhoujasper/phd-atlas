import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  COMMUNICATION_SERVER_AUTHORITY_FIELDS,
  applicationUserEditablePersistenceProjection,
} from '../shared/applicationPersistenceProtocol.js'
import { preserveCommunicationAuthority } from './mailSync.js'

/**
 * The rule that keeps a save from being refused:
 *
 *   a field the server rewrites behind a submission must be excluded from the
 *   authored projection the browser verifies.
 *
 * When the two disagree, the browser submits the field, the server quietly
 * replaces it, and `applicationPersistenceAcknowledged` concludes the field did
 * not persist — so the save is reported as refused, identically on every retry,
 * and that edit can never be stored. It is not recoverable by the person and it
 * is not visible in any log; it just looks like "saving is broken".
 *
 * That disagreement is what a second, drifted copy of the list produces, which
 * is why there is now one definition and this test.
 */
describe('communication server-authority contract', () => {
  it('keeps exactly one definition of every authority set', () => {
    // Two copies in the same directory is what produced the drift. The sets are
    // declared once and imported; a second `new Set([...])` anywhere else is
    // the beginning of the next round of this bug.
    const owners = ['server/shared/applicationAuthorityFields.js']
    const consumers = [
      'server/shared/applicationCanonical.js',
      'server/shared/applicationPersistenceProtocol.js',
      'server/applicationDelta.js',
      'server/applicationMutationAck.js',
      'server/offlineReplay.js',
      'server/mailSync.js',
      'src/applicationDelta.ts',
      'src/applicationMutationAcknowledgement.ts',
      'src/offline.ts',
    ]
    for (const file of owners) {
      const source = readFileSync(path.join(process.cwd(), file), 'utf8')
      expect(source).toMatch(/COMMUNICATION_SERVER_AUTHORITY_FIELDS = Object\.freeze\(new Set\(\[/u)
    }
    for (const file of consumers) {
      const source = readFileSync(path.join(process.cwd(), file), 'utf8')
      expect(source, `${file} redefines an authority set`)
        .not.toMatch(/_(?:SERVER_AUTHORITY|REFERENCE)_FIELDS\s*=\s*(?:Object\.freeze\()?new Set\(\[/u)
      expect(source).toContain('applicationAuthorityFields.js')
    }
  })

  it('enforces authority only over fields the authored projection excludes', () => {
    const source = readFileSync(path.join(process.cwd(), 'server', 'mailSync.js'), 'utf8')
    // The enforcement list must be derived, not retyped.
    expect(source).toContain('[...COMMUNICATION_SERVER_AUTHORITY_FIELDS]')
    expect(source).not.toMatch(/const SERVER_OWNED_COMMUNICATION_FIELDS = \[\s*'/u)

    const communication = {
      id: 'comm_1',
      subject: 'Reply',
      summary: 'Body',
      channel: 'Email',
      date: '2026-08-06',
    }
    for (const field of COMMUNICATION_SERVER_AUTHORITY_FIELDS) {
      communication[field] = `authority-${field}`
    }
    const projected = applicationUserEditablePersistenceProjection({
      id: 'app_1',
      communications: [communication],
    }).communications[0]

    const leaked = [...COMMUNICATION_SERVER_AUTHORITY_FIELDS]
      .filter((field) => Object.hasOwn(projected, field))
    expect(leaked).toEqual([])
  })

  it('keeps a manual category selection with its author', () => {
    // Both halves of one decision: the list and its primary entry. Neither is
    // server-owned, so an ordinary save carries both through untouched.
    expect(COMMUNICATION_SERVER_AUTHORITY_FIELDS.has('mailCategories')).toBe(false)
    expect(COMMUNICATION_SERVER_AUTHORITY_FIELDS.has('mailCategoryOverride')).toBe(false)

    const stored = { id: 'comm_1', subject: 'Reply', mailClassification: { category: 'outreach' } }
    const submitted = {
      id: 'comm_1',
      subject: 'Reply',
      mailCategories: ['offer', 'custom:probe'],
      mailCategoryOverride: 'offer',
      mailClassification: { category: 'tampered' },
    }
    const preserved = preserveCommunicationAuthority(stored, submitted)

    expect(preserved.mailCategories).toEqual(['offer', 'custom:probe'])
    expect(preserved.mailCategoryOverride).toBe('offer')
    // The classifier's own output is still the server's to keep.
    expect(preserved.mailClassification).toEqual({ category: 'outreach' })
  })

  it('does not drop a submitted value for a field the store has never held', () => {
    // The original defect: an absent stored value made the filter delete the
    // submitted one, so the very first manual selection on a message could
    // never be saved.
    const preserved = preserveCommunicationAuthority(
      { id: 'comm_1', subject: 'Reply' },
      { id: 'comm_1', subject: 'Reply', mailCategoryOverride: 'interview_invite' },
    )
    expect(preserved.mailCategoryOverride).toBe('interview_invite')
  })
})
