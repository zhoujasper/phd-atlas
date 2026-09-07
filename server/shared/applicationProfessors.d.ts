export type ApplicationProfessor = {
  id?: string
  english: string
  chinese: string
  email: string
  correspondenceEmails?: string[]
  phone: string
  social: string
  homepage: string
  research: string
  lab: string
  labUrl?: string
  projectUrl?: string
}
export type ProfessorApplication = {
  professor: ApplicationProfessor
  additionalProfessors?: Array<ApplicationProfessor & { id: string }>
}
export const MAX_APPLICATION_PROFESSORS: number
export const PRIMARY_PROFESSOR_ID: string
export function emptyProfessor(): ApplicationProfessor
export function createProfessorId(): string
export function professorCollectionIssues(application: ProfessorApplication): Array<{ path: Array<string | number>; message: string }>
export function applicationProfessors(application: ProfessorApplication): Array<ApplicationProfessor & { id: string }>
export function professorAddresses(professor: ApplicationProfessor): string[]
export function correspondenceAddressTokens(value: string | null | undefined): string[]
export function findApplicationProfessor(application: ProfessorApplication, address: string | null | undefined): (ApplicationProfessor & { id: string }) | null
export function communicationMatchesProfessor(application: ProfessorApplication, communication: { direction?: string; from?: string; to?: string }, professorId: string): boolean
export function professorName(professor: ApplicationProfessor | null | undefined, language?: string): string
