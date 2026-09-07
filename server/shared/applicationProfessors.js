// The legacy professor remains the default contact. Additional contacts have
// stable IDs and never share storage with recommendation-letter contacts.
export const MAX_APPLICATION_PROFESSORS = 30
export const PRIMARY_PROFESSOR_ID = 'primary'

export function emptyProfessor() {
  return { english: '', chinese: '', email: '', phone: '', social: '', homepage: '', research: '', lab: '' }
}

export function createProfessorId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `professor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function professorCollectionIssues(application) {
  const ids = new Set()
  const addresses = new Set()
  const issues = []
  for (const [index, professor] of applicationProfessors(application).entries()) {
    const path = index === 0 ? ['professor'] : ['additionalProfessors', index - 1]
    if (ids.has(professor.id)) issues.push({ path: [...path, 'id'], message: 'Supervisor identifiers must be unique.' })
    ids.add(professor.id)
    for (const address of professorAddresses(professor)) {
      if (addresses.has(address)) issues.push({ path: [...path, 'email'], message: 'Each email address must belong to only one supervisor in this application.' })
      addresses.add(address)
    }
  }
  return issues
}

export function applicationProfessors(application) {
  const primary = application?.professor ?? emptyProfessor()
  return [
    { ...primary, id: primary.id || PRIMARY_PROFESSOR_ID },
    ...(Array.isArray(application?.additionalProfessors) ? application.additionalProfessors : []),
  ]
}

export function professorAddresses(professor) {
  return [...new Set([professor?.email, ...(professor?.correspondenceEmails ?? [])]
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim().toLowerCase()))].slice(0, 10)
}

export function correspondenceAddressTokens(value) {
  return String(value ?? '').toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+/g) ?? []
}

export function findApplicationProfessor(application, address) {
  const addresses = new Set(correspondenceAddressTokens(address))
  return applicationProfessors(application).find((professor) =>
    professorAddresses(professor).some((email) => addresses.has(email))) ?? null
}

export function communicationMatchesProfessor(application, communication, professorId) {
  const professor = applicationProfessors(application).find((item) => item.id === professorId)
  if (!professor) return false
  const addresses = new Set(correspondenceAddressTokens(
    communication?.direction === 'incoming' ? communication.from : communication?.to,
  ))
  return professorAddresses(professor).some((email) => addresses.has(email))
}

export function professorName(professor, language = 'en') {
  return (language === 'zh' ? professor?.chinese : professor?.english)
    || professor?.english || professor?.chinese || professor?.email || ''
}
