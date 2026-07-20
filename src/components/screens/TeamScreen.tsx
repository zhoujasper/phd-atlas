import type { TeamSection } from '../../appModel'
import type { AiKey, AiKeyInput, AuthSession, TeamApplicationRecord, TeamSummary, TeamWorkspaceOption } from '../../api/phdApi'

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
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info' | 'warning') => void
}

export function TeamScreen(_props: TeamScreenProps) {
  return null
}
