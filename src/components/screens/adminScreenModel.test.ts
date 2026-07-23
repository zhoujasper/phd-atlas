import { describe, expect, it } from 'vitest'
import type { AdminUser, SystemEvent } from '../../api/phdApi'
import {
  accountTypeForUser,
  compareAdminUsers,
  compareLogEvents,
  databaseDraftFromConfiguration,
  defaultDatabasePort,
  formatBytes,
  formatQuotaLimit,
  formatUptime,
  localizeEventMessage,
  normalizeBackupFrequency,
  normalizeBackupLimitOption,
  patchForAccountType,
  quotaProgressClass,
} from './adminScreenModel'

const translations: Record<string, string> = {
  'admin.eventMessages.UpdatedUser': 'Updated {email}',
  'admin.uptimeMinutes': '{count}m {sec}s',
}
const tx = (key: string, fallback = '') => translations[key] ?? fallback
const fallbackTx = (_key: string, fallback = '') => fallback

const user = (overrides: Partial<AdminUser> = {}) => ({
  id: 'user-1',
  name: 'Example User',
  email: 'example@example.edu',
  role: 'user',
  createdAt: '2026-07-01T00:00:00.000Z',
  lastLoginAt: null,
  settings: { membershipPlan: 'free' },
  applicationCount: 0,
  applicationQuota: 10,
  applicationCreateQuota: 10,
  applicationCreatedCount: 0,
  storageUsedBytes: 0,
  storageQuotaMb: 1024,
  shareQuota: 10,
  shareCreateQuota: 10,
  shareCreatedCount: 0,
  activeShareCount: 0,
  privacy: 'private',
  ...overrides,
}) as AdminUser

const event = (overrides: Partial<SystemEvent> = {}): SystemEvent => ({
  id: 'event-1',
  time: '2026-07-22T10:00:00.000Z',
  scope: 'Settings',
  actorId: 'user-1',
  message: 'Updated user example@example.edu',
  metadata: {},
  ...overrides,
})

describe('admin screen model', () => {
  it('normalizes database and backup settings with the existing fallbacks', () => {
    expect(defaultDatabasePort('mysql')).toBe(3306)
    expect(databaseDraftFromConfiguration(null)).toEqual({ type: 'sqlite', sqlitePath: '' })
    expect(databaseDraftFromConfiguration({
      type: 'postgresql',
      configured: true,
      passwordSet: true,
      cachePath: '',
      host: 'db.example.edu',
    })).toMatchObject({ type: 'postgresql', host: 'db.example.edu', port: 5432, ssl: false })
    expect(normalizeBackupFrequency('weekly')).toBe('7d')
    expect(normalizeBackupFrequency('unexpected')).toBe('daily')
    expect(normalizeBackupLimitOption(17)).toBe('10')
  })

  it('keeps localized audit text, formatters, and quota presentation stable', () => {
    expect(localizeEventMessage('Updated user example@example.edu', tx)).toBe('Updated example@example.edu')
    expect(localizeEventMessage('System update package removed: update.zip', fallbackTx)).toBe(
      'System update package removed:',
    )
    expect(formatUptime(125, tx)).toBe('2m 5s')
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatQuotaLimit(Number.MAX_SAFE_INTEGER)).toBe('∞')
    expect(quotaProgressClass(80)).toBe('admin-mini-progress-fill-warning')
  })

  it('preserves account conversion plus deterministic user and audit sorting', () => {
    const pro = user({
      settings: { language: 'en', highContrast: false, themeAccent: '#0071e3', membershipPlan: 'pro' },
    })
    const free = user({ id: 'user-2', email: 'another@example.edu' })

    expect(accountTypeForUser(pro)).toBe('pro')
    expect(patchForAccountType('admin')).toEqual({ role: 'admin', membershipPlan: 'pro' })
    expect(compareAdminUsers(pro, free, 'email', 'asc')).toBeGreaterThan(0)
    expect(compareLogEvents(event(), event({ id: 'event-2', time: '2026-07-22T11:00:00.000Z' }), 'time', 'asc')).toBeLessThan(0)
  })
})
