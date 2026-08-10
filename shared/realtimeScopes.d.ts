export type RealtimeScope =
  | 'applications'
  | 'profile-assets'
  | 'backups'
  | 'teams'
  | 'notifications'
  | 'session'
  | 'ai-keys'
  | 'discover'
  | 'interview'
  | 'admission'

export const REALTIME_SCOPES: readonly RealtimeScope[]

export function scopesForMutation(method: unknown, originalUrl: unknown): RealtimeScope[]
