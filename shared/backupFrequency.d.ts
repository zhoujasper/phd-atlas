export type BackupFrequencyValue =
  | '1m' | '5m' | '15m' | '30m' | '1h' | '3h' | '6h' | '12h' | 'daily' | '3d' | '7d'

export const BACKUP_FREQUENCIES: readonly BackupFrequencyValue[]
export const LEGACY_BACKUP_FREQUENCIES: readonly string[]
export const DEFAULT_BACKUP_FREQUENCY: BackupFrequencyValue

export function isBackupFrequency(value: unknown): value is BackupFrequencyValue

export function normalizeBackupFrequency(
  value: string | undefined | null,
  fallback?: BackupFrequencyValue,
): BackupFrequencyValue
