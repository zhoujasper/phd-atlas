import { describe, expect, it } from 'vitest'
import {
  auditTrackedSource,
  excludeDeletedTrackedFiles,
} from '../tools/security-source-audit.mjs'

describe('security source audit', () => {
  it('excludes only paths Git explicitly identifies as deleted', () => {
    expect(excludeDeletedTrackedFiles(
      ['src/live.ts', 'src/deleted.ts', 'src/unreadable.ts'],
      ['src/deleted.ts'],
    )).toEqual(['src/live.ts', 'src/unreadable.ts'])
  })

  it('still fails closed for an unreadable path supplied to the audit', async () => {
    await expect(auditTrackedSource(['does-not-exist/security-audit.ts'])).resolves.toEqual([{
      path: 'does-not-exist/security-audit.ts',
      rule: 'unreadable-tracked-file',
    }])
  })
})
