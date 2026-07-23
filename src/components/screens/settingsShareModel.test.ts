import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  expiresAtForShare,
  formatManagedShareScope,
  formatPasskeyTimestamp,
  formatShareExpiry,
  managedShareKindLabel,
  sharedLinkPath,
  sharedLinkPermission,
  sharedLinkSubject,
  shareExpiryChoice,
  type SharedLinkInfo,
} from './settingsShareModel'

const translations: Record<string, string> = {
  'share.neverExpires': 'Never expires',
  'settings.passkeyNeverUsed': 'Never used',
  'share.scope.upload': 'Attachment upload',
  'share.scope.count': '{count} sections',
  'share.sections.overview': 'Overview',
  'settings.shareUploadLinkType': 'Attachment upload link',
  'settings.shareProjectLinkType': 'Project preview link',
}
const tx = (key: string, fallback = '') => translations[key] ?? fallback
const format = (template: string, values: Record<string, string | number>) => (
  Object.entries(values).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, String(value)), template)
)

const applicationLink: SharedLinkInfo = {
  applicationId: 'application-1',
  applicationName: 'Example University',
  share: {
    id: 'share-1',
    token: 'project-token',
    createdAt: '2026-07-22T10:00:00.000Z',
    expiresAt: null,
    permission: 'edit',
    sections: ['overview'],
  },
}

describe('settings share model', () => {
  afterEach(() => vi.useRealTimers())

  it('preserves expiry calculations and their tolerant choice boundaries', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-22T10:00:00.000Z'))

    expect(expiresAtForShare('never')).toBeNull()
    expect(expiresAtForShare('1d')).toBe('2026-07-23T10:00:00.000Z')
    expect(shareExpiryChoice('2026-07-22T11:29:00.000Z')).toBe('1h')
    expect(shareExpiryChoice('2026-07-24T10:00:00.000Z')).toBe('7d')
  })

  it('keeps share subjects, routes, permission, scopes, and empty timestamps stable', () => {
    expect(sharedLinkSubject(applicationLink)).toBe('Example University')
    expect(sharedLinkPath(applicationLink)).toBe('/share/project-token')
    expect(sharedLinkPermission(applicationLink)).toBe('edit')
    expect(formatManagedShareScope(applicationLink, tx, format)).toEqual({ summary: '1 sections', labels: 'Overview' })
    expect(managedShareKindLabel(applicationLink, tx)).toBe('Project preview link')
    expect(formatShareExpiry(null, 'en', tx)).toBe('Never expires')
    expect(formatPasskeyTimestamp(null, 'en', tx)).toBe('Never used')
  })
})
