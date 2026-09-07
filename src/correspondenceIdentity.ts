import { findApplicationProfessor, professorName, type ProfessorApplication } from '../shared/applicationProfessors.js'
import { normalizeCorrespondenceEmail } from './correspondenceRecipients'
import type { ApplicationRecord } from './data/applications'
import { emailLeadingInitial } from './components/shared/avatarInitial'
import { professorAvatarTone } from './professorAvatarTone'

export function correspondenceAvatarIdentity(
  item: ApplicationRecord['communications'][number], application: ProfessorApplication,
  account: { name: string; email: string; avatarUrl?: string | null },
) {
  if (item.direction !== 'incoming') return { ...account, displayEmail: '', tone: undefined }
  const email = normalizeCorrespondenceEmail(item.from)
  const matched = findApplicationProfessor(application, email)
  if (matched) return {
    name: professorName(matched), email, avatarUrl: undefined, displayEmail: '',
    tone: professorAvatarTone(matched.id),
  }
  // Old hand-entered messages may have no address. An unknown real sender must
  // never inherit another professor's name, including after a contact is removed.
  const legacy = !email && !item.sourceMessageKey && item.messageType !== 'fetched-email'
  return {
    name: legacy ? professorName(application.professor) : emailLeadingInitial(email),
    email, avatarUrl: undefined, displayEmail: email, tone: undefined,
  }
}
