import type { TeamTransferPreflight, TeamWorkspaceOption } from '../../api/phdApi'
import type { ApplicationRecord } from '../../data/applications'

/** Public-edition compatibility boundary; organization transfers are unavailable. */
export function ApplicationTransferDialog(_props: {
  open: boolean
  application: ApplicationRecord
  direction: 'join' | 'leave'
  approvalRequired?: boolean
  organizations: TeamWorkspaceOption[]
  onPreflight: (teamId: string) => Promise<TeamTransferPreflight>
  onSubmit: (teamId: string) => Promise<boolean | void> | boolean | void
  onClose: () => void
}) {
  return null
}
