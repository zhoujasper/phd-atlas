import { CUSTOM_PROFILE_KIND } from '../../profileAssets'

export type TeamStudentProfileAsset = {
  id: string
  teamId: string
  studentUserId: string
  kind: string
  name: string
  description: string
  updatedAt: string
}

export type TeamStudentProfileDraft = {
  kind: string
  name: string
  description: string
}

const teamStudentProfileStorageKey = 'phd-atlas-team-student-profiles:v1'

export const defaultStudentProfileDraft: TeamStudentProfileDraft = {
  kind: CUSTOM_PROFILE_KIND,
  name: '',
  description: '',
}

export function readStoredTeamStudentProfiles(): TeamStudentProfileAsset[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(teamStudentProfileStorageKey) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is TeamStudentProfileAsset => (
      Boolean(item) &&
      typeof item.id === 'string' &&
      typeof item.teamId === 'string' &&
      typeof item.studentUserId === 'string' &&
      typeof item.kind === 'string' &&
      typeof item.name === 'string' &&
      typeof item.description === 'string' &&
      typeof item.updatedAt === 'string'
    ))
  } catch {
    return []
  }
}

export function writeStoredTeamStudentProfiles(items: TeamStudentProfileAsset[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(teamStudentProfileStorageKey, JSON.stringify(items))
  } catch {
    // Local notes are an enhancement; failing to persist should not block team work.
  }
}
