export const MAX_APPLICATION_CORRESPONDENCE_EMAILS = 10

export type CorrespondenceProfessor = {
  email: string
  correspondenceEmails?: string[]
}

export function normalizeCorrespondenceEmail(value: string | null | undefined) {
  const raw = String(value ?? '').trim()
  const bracketed = raw.match(/<([^<>]+)>/)?.[1]
  return (bracketed ?? raw.split(/[;,]/, 1)[0] ?? '').trim().toLowerCase()
}

export function isValidCorrespondenceEmail(value: string | null | undefined) {
  const normalized = normalizeCorrespondenceEmail(value)
  return normalized.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
}

export function applicationCorrespondenceEmails(professor: CorrespondenceProfessor) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of [professor.email, ...(professor.correspondenceEmails ?? [])]) {
    const normalized = normalizeCorrespondenceEmail(value)
    if (!isValidCorrespondenceEmail(normalized) || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
    if (result.length >= MAX_APPLICATION_CORRESPONDENCE_EMAILS) break
  }
  return result
}

export function additionalCorrespondenceEmails(
  primaryEmail: string,
  emails: Array<string | null | undefined>,
) {
  const primary = normalizeCorrespondenceEmail(primaryEmail)
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of emails) {
    const normalized = normalizeCorrespondenceEmail(value)
    if (
      !isValidCorrespondenceEmail(normalized)
      || normalized === primary
      || seen.has(normalized)
    ) continue
    seen.add(normalized)
    result.push(normalized)
    if (result.length >= MAX_APPLICATION_CORRESPONDENCE_EMAILS - 1) break
  }
  return result
}
