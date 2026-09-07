import { professorAvatarTone } from '../../professorAvatarTone'
import { UserAvatar } from './UserAvatar'
import { professorName, type ApplicationProfessor } from '../../../shared/applicationProfessors.js'

export function ProfessorAvatar({ professor }: { professor: ApplicationProfessor }) {
  return (
    <span className="professor-avatar" data-tone={professorAvatarTone(professor.id || 'primary')}>
      <UserAvatar name={professorName(professor)} email={professor.email} className="professor-avatar-initial" />
    </span>
  )
}
