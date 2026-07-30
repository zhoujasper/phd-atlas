import type { ApplicationRecord } from '../../data/applications'

export type ApplicationPipelineViewMode = 'board' | 'table'
export type ApplicationPipelineScope = 'personal' | 'team'

export type TeamKanbanStudent = {
  id: string
  name: string
  email?: string
  avatarUrl?: string
  advisorName?: string | null
  applications: ApplicationRecord[]
  allApplications: ApplicationRecord[]
  canCreateApplication?: boolean
}

export type ApplicationPriorityBand = 'high' | 'medium' | 'low'

export function applicationPriorityBand(priority: number): ApplicationPriorityBand {
  if (priority >= 80) return 'high'
  if (priority >= 50) return 'medium'
  return 'low'
}
