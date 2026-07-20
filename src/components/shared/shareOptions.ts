export type ShareExpiry = '1h' | '1d' | '7d' | '30d' | 'never'

export const shareExpiryOptions: Array<{ value: ShareExpiry; labelKey: string; fallback: string }> = [
  { value: '1h', labelKey: 'share.expiry.1h', fallback: '1 hour' },
  { value: '1d', labelKey: 'share.expiry.1d', fallback: '1 day' },
  { value: '7d', labelKey: 'share.expiry.7d', fallback: '7 days' },
  { value: '30d', labelKey: 'share.expiry.30d', fallback: '30 days' },
  { value: 'never', labelKey: 'share.expiry.never', fallback: 'Never' },
]
