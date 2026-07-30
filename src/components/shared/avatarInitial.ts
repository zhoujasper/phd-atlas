const latinHonorific = /^(?:dr|mr|mrs|ms|prof|professor)\.?$/i
const cjkHonorificSuffix = /(?:教授|老师|博士)\s*\d*$/u

function meaningfulNameParts(value: string) {
  return value
    .trim()
    .replace(cjkHonorificSuffix, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((part) => !latinHonorific.test(part))
}

function initialsFrom(value?: string) {
  if (!value?.trim()) return ''
  const parts = meaningfulNameParts(value)
  if (parts.length === 0) return ''
  if (parts.length > 1) {
    return `${Array.from(parts[0])[0] ?? ''}${Array.from(parts.at(-1) ?? '')[0] ?? ''}`
      .toLocaleUpperCase()
  }
  return Array.from(parts[0]).slice(0, 2).join('').toLocaleUpperCase()
}

export function emailLeadingInitial(email?: string) {
  const emailIdentity = email?.trim().split('@')[0] ?? ''
  return (Array.from(emailIdentity)[0] ?? '').toLocaleUpperCase() || '?'
}

export function avatarInitial(name?: string, email?: string) {
  const nameInitials = initialsFrom(name)
  if (nameInitials) return nameInitials

  const emailIdentity = email?.trim().split('@')[0]?.replace(/[._-]+/g, ' ')
  return initialsFrom(emailIdentity) || '?'
}
