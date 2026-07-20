import type { TeamWorkspaceOption } from '../../api/phdApi'

/** Public-edition compatibility boundary; Team workspaces are unavailable. */
export type TeamWorkspaceChooserProps = {
  open: boolean
  workspaces: TeamWorkspaceOption[]
  activeTeamId?: string | null
  onSelect: (teamId: string) => void
  onClose: () => void
}

export function TeamWorkspaceChooser(_props: TeamWorkspaceChooserProps) {
  return null
}
