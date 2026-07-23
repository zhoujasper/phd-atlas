import type { AuthSession } from '../../api/phdApi'

export type ReceiveEmail = {
  address: string
  isPrimary: boolean
  notify: boolean
  verified?: boolean
  verificationSentAt?: string
}

export const MAX_RECEIVE_EMAILS = 5

export function fallbackReceiveEmails(session: AuthSession): ReceiveEmail[] {
  const configured = session.user.settings.receiveEmails
  if (configured?.length) {
    return configured.slice(0, MAX_RECEIVE_EMAILS).map((email) => ({
      ...email,
      address: email.address.trim().toLowerCase(),
      verified: email.verified ?? true,
    }))
  }
  return [{
    address: session.user.settings.receiveAt || session.user.email,
    isPrimary: true,
    notify: true,
    verified: true,
  }]
}

export function normalizeReceiveEmails(emails: ReceiveEmail[]) {
  const deduped = emails.reduce<ReceiveEmail[]>((items, email) => {
    const address = email.address.trim().toLowerCase()
    if (!address || items.some((item) => item.address === address) || items.length >= MAX_RECEIVE_EMAILS) return items
    items.push({
      ...email,
      address,
      verified: email.verified ?? false,
      isPrimary: Boolean(email.isPrimary && (email.verified ?? false)),
    })
    return items
  }, [])
  if (deduped.length === 0) return []

  const primaryIndex = deduped.findIndex((email) => email.isPrimary && email.verified)
  const fallbackPrimaryIndex = deduped.findIndex((email) => email.verified)
  return deduped.map((email, index) => ({
    ...email,
    isPrimary: index === (primaryIndex >= 0 ? primaryIndex : fallbackPrimaryIndex),
  }))
}
