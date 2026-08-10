export type FrontendBuildInfo = {
  version: string
  buildId: string
  builtAt: string
  commit: string
  sourceState: string
  mode: string
}

function buildValue(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

export const frontendBuildInfo: FrontendBuildInfo = Object.freeze({
  version: buildValue(import.meta.env.VITE_FRONTEND_VERSION, '0.0.0-dev'),
  buildId: buildValue(import.meta.env.VITE_FRONTEND_BUILD_ID, 'development-unversioned'),
  builtAt: buildValue(import.meta.env.VITE_FRONTEND_BUILT_AT, new Date(0).toISOString()),
  commit: buildValue(import.meta.env.VITE_FRONTEND_COMMIT, 'unversioned'),
  sourceState: buildValue(import.meta.env.VITE_FRONTEND_SOURCE_STATE, 'unknown'),
  mode: buildValue(import.meta.env.MODE, 'unknown'),
})

export function formatFrontendBuildTime(locale: string) {
  const value = new Date(frontendBuildInfo.builtAt)
  if (Number.isNaN(value.getTime())) return frontendBuildInfo.builtAt
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(value)
}
