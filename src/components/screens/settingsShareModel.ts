import type { ProfileAssetShare } from '../../api/phdApi'
import {
  normalizeSharePermission,
  normalizeShareSections,
  shareSections,
  type SharePermission,
  type ShareSection,
} from '../../data/applications'
import { localeForLanguage } from '../../i18n'

export type SettingsTx = (path: string, fallback?: string) => string
export type SettingsFormat = (template: string, values: Record<string, string | number>) => string
export type ShareExpiryChoice = '1h' | '1d' | '7d' | '30d' | 'never'

type ApplicationSharedLinkInfo = {
  /** Omitted by older callers; defaults to a project-preview link. */
  kind?: 'application'
  applicationId: string
  applicationName: string
  share: {
    id: string
    token: string
    createdAt: string
    expiresAt: string | null
    permission?: SharePermission
    sections?: ShareSection[]
  }
}

type AssetUploadSharedLinkInfo = {
  kind: 'asset-upload'
  assetId: string
  assetName: string
  share: ProfileAssetShare
}

export type SharedLinkInfo = ApplicationSharedLinkInfo | AssetUploadSharedLinkInfo

export function formatShareExpiry(expiresAt: string | null, lang: string, tx: SettingsTx) {
  if (!expiresAt) return tx('share.neverExpires')
  return new Date(expiresAt).toLocaleString(localeForLanguage(lang), {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function formatShareTimestamp(value: string, lang: string) {
  return new Date(value).toLocaleString(localeForLanguage(lang), {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function formatPasskeyTimestamp(value: string | null | undefined, lang: string, tx: SettingsTx) {
  if (!value) return tx('settings.passkeyNeverUsed')
  return new Date(value).toLocaleString(localeForLanguage(lang), {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function expiresAtForShare(expiry: ShareExpiryChoice) {
  if (expiry === 'never') return null
  const durations: Record<Exclude<ShareExpiryChoice, 'never'>, number> = {
    '1h': 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  }
  return new Date(Date.now() + durations[expiry]).toISOString()
}

export function shareExpiryChoice(expiresAt: string | null): ShareExpiryChoice {
  if (!expiresAt) return 'never'
  const delta = new Date(expiresAt).getTime() - Date.now()
  if (delta <= 60 * 60 * 1000 * 1.5) return '1h'
  if (delta <= 24 * 60 * 60 * 1000 * 1.5) return '1d'
  if (delta <= 7 * 24 * 60 * 60 * 1000 * 1.5) return '7d'
  return '30d'
}

export function formatShareScope(
  sections: ShareSection[] | undefined,
  tx: SettingsTx,
  format: SettingsFormat,
) {
  const normalized = normalizeShareSections(sections)
  const summary = normalized.length === shareSections.length
    ? tx('share.scope.all')
    : format(tx('share.scope.count'), { count: normalized.length })
  const labels = normalized.map((section) => tx(`share.sections.${section}`, section)).join(', ')
  return { summary, labels }
}

export function sharedLinkSubject(link: SharedLinkInfo) {
  return link.kind === 'asset-upload' ? link.assetName : link.applicationName
}

export function sharedLinkPath(link: SharedLinkInfo) {
  return link.kind === 'asset-upload' ? `/asset-upload/${link.share.token}` : `/share/${link.share.token}`
}

export function sharedLinkPermission(link: SharedLinkInfo): SharePermission {
  return link.kind === 'asset-upload' ? 'upload' : normalizeSharePermission(link.share.permission)
}

export function formatManagedShareScope(
  link: SharedLinkInfo,
  tx: SettingsTx,
  format: SettingsFormat,
) {
  if (link.kind === 'asset-upload') {
    const label = tx('share.scope.upload', 'Attachment upload')
    return { summary: label, labels: label }
  }
  return formatShareScope(link.share.sections, tx, format)
}

export function managedShareKindLabel(link: SharedLinkInfo, tx: SettingsTx) {
  return link.kind === 'asset-upload'
    ? tx('settings.shareUploadLinkType', 'Attachment upload')
    : tx('settings.shareProjectLinkType', 'Project preview')
}
