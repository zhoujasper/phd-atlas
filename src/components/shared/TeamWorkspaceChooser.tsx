import '../../styles/team-workspace-chooser.css'
import { ArrowRight, Building2, Check, FileText, Users, X } from 'lucide-react'
import type { TeamRole, TeamWorkspaceOption } from '../../api/phdApi'
import { useAnimatedClose } from '../hooks/useAnimatedClose'
import { useI18n } from '../hooks/useI18n'
import { useModalA11y } from '../hooks/useModalA11y'
import { ModalPortal } from './ModalPortal'

const roleKeys: Record<TeamRole, string> = {
  owner: 'team.roleOwner',
  admin: 'team.roleAdmin',
  member: 'team.roleMember',
}

export function TeamWorkspaceChooser({
  open,
  workspaces,
  activeTeamId,
  onSelect,
  onClose,
}: {
  open: boolean
  workspaces: TeamWorkspaceOption[]
  activeTeamId?: string | null
  onSelect: (teamId: string) => void
  onClose: () => void
}) {
  const { tx, format } = useI18n()
  const { exiting, requestClose } = useAnimatedClose(open, onClose)
  const dialogRef = useModalA11y<HTMLDivElement>({
    open: open && !exiting,
    onClose: () => requestClose(onClose),
  })

  if (!open) return null

  return (
    <ModalPortal>
      <div
        className={`dialog-layer team-workspace-chooser-layer${exiting ? ' exiting' : ''}`}
        onClick={(event) => {
          if (event.target === event.currentTarget) requestClose(onClose)
        }}
      >
        <div
          ref={dialogRef}
          className="team-workspace-chooser"
          role="dialog"
          aria-modal="true"
          aria-labelledby="team-workspace-chooser-title"
          aria-describedby="team-workspace-chooser-description"
        >
          <header>
            <span className="team-workspace-chooser-icon" aria-hidden="true"><Building2 size={18} /></span>
            <div>
              <span className="eyebrow">{tx('team.workspaceChooserEyebrow')}</span>
              <h2 id="team-workspace-chooser-title">{tx('team.workspaceChooserTitle')}</h2>
              <p id="team-workspace-chooser-description">{tx('team.workspaceChooserDescription')}</p>
            </div>
            <button type="button" className="icon-action" onClick={() => requestClose(onClose)} aria-label={tx('cancel')}>
              <X size={15} aria-hidden="true" />
            </button>
          </header>

          <div className="team-workspace-chooser-list">
            {workspaces.map((workspace) => {
              const selected = workspace.teamId === activeTeamId
              return (
                <button
                  key={workspace.teamId}
                  type="button"
                  className={`team-workspace-choice${selected ? ' selected' : ''}`}
                  onClick={() => requestClose(() => onSelect(workspace.teamId))}
                >
                  <span className="team-workspace-choice-mark" aria-hidden="true">
                    {selected ? <Check size={15} /> : <Building2 size={15} />}
                  </span>
                  <span className="team-workspace-choice-copy">
                    <strong>{workspace.name}</strong>
                    <em>{workspace.viewerRole ? tx(roleKeys[workspace.viewerRole]) : tx('team.workspaceRoleUnknown')}</em>
                    <span>
                      <small><Users size={11} aria-hidden="true" /> {format(tx('team.workspaceChooserMembers'), { count: workspace.memberCount })}</small>
                      <small><FileText size={11} aria-hidden="true" /> {format(tx('team.workspaceChooserApplications'), { count: workspace.applicationCount })}</small>
                    </span>
                  </span>
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
