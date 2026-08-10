import type { TeamSection } from '../../appModel'
import type { AiKey, AiKeyInput, AuthSession, ProfileAsset, ProfileAssetInput, ProfileRecommender, TeamApplicationRecord, TeamSummary, TeamWorkspaceOption } from '../../api/phdApi'

/** Public-edition compatibility boundary; Team UI is not distributed here. */
export type TeamScreenProps = {
  session: AuthSession
  initialSummary?: TeamSummary | null
  onChanged?: () => void | Promise<void>
  applicationCounts?: Record<string, number>
  applications?: TeamApplicationRecord[]
  activeSection?: TeamSection
  hideTabs?: boolean
  onSectionChange?: (section: TeamSection) => void
  onViewApplications?: (ownerId: string) => void
  onOpenApplication?: (applicationId: string) => void
  onOpenApplicationInNewPage?: (applicationId: string) => void
  onImpersonateMember?: (userId: string) => void
  onCreateApplication?: (ownerId?: string | null) => void
  onSwitchToPersonal?: () => void
  teamWorkspaces?: TeamWorkspaceOption[]
  activeTeamId?: string | null
  onSwitchTeam?: (teamId: string) => void
  onCopy?: (value: string, label: string) => void
  aiKeys?: AiKey[]
  onCreateAiKey?: (input: AiKeyInput) => Promise<void> | void
  onUpdateAiKey?: (id: string, input: Partial<Pick<AiKeyInput, 'label' | 'model' | 'baseUrl' | 'apiKey'>>) => Promise<void> | void
  onDeleteAiKey?: (id: string) => Promise<void> | void
  onTestAiKey?: (id: string) => Promise<{ latencyMs: number; model?: string }>
  onResetAiKeyUsage?: (id: string) => Promise<void> | void
  studentRecommenderProfiles?: Readonly<Record<string, readonly ProfileRecommender[]>>
  studentRecommenderLoadingIds?: ReadonlySet<string>
  onLoadStudentRecommenders?: (studentUserId: string) => void | Promise<void>
  onUpdateStudentRecommenders?: (studentUserId: string, nextProfiles: ProfileRecommender[]) => void | Promise<void>
  canEditStudentRecommenders?: (studentUserId: string) => boolean
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info' | 'warning') => void
  onOpenTeamDiscover?: (studentUserId: string) => void
  personalProfileAssets?: ProfileAsset[]
  onCreatePersonalProfileAsset?: (input: ProfileAssetInput) => void | Promise<void>
  onUpdatePersonalProfileAsset?: (assetId: string, input: Partial<ProfileAssetInput>) => void | Promise<void>
  onDeletePersonalProfileAsset?: (assetId: string) => void | Promise<void>
}

export function TeamScreen(_props: TeamScreenProps) {
  return null
}
