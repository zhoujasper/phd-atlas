export type DesktopRuntimeMode = 'local' | 'remote'

export type DesktopRuntime = {
  enabled: boolean
  mode: DesktopRuntimeMode
  remoteOrigin: string | null
  remoteEmail: string | null
  shareEnabled: boolean
  adminEnabled: boolean
  teamEnabled: boolean
  unlimited: boolean
  linkedAt: string | null
  unlockRequired: boolean
  unlocked: boolean
}

const disabledRuntime: DesktopRuntime = {
  enabled: false,
  mode: 'local',
  remoteOrigin: null,
  remoteEmail: null,
  shareEnabled: true,
  adminEnabled: true,
  teamEnabled: true,
  unlimited: false,
  linkedAt: null,
  unlockRequired: false,
  unlocked: true,
}

let cached: DesktopRuntime | null = null
let inflight: Promise<DesktopRuntime> | null = null

declare global {
  interface Window {
    phdAtlasDesktop?: Partial<DesktopRuntime> & {
      platform?: string
    }
  }
}

export function disabledDesktopRuntime(): DesktopRuntime {
  return { ...disabledRuntime }
}

export function isDesktopShell(target: Window | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  if (!target) return false
  if (target.phdAtlasDesktop?.enabled) return true
  return /\bElectron\b/i.test(String(target.navigator?.userAgent ?? ''))
}

export function readDesktopRuntime(): DesktopRuntime {
  if (cached) return cached
  if (isDesktopShell()) return desktopEnabledPlaceholder()
  return disabledDesktopRuntime()
}

export function setDesktopRuntime(runtime: DesktopRuntime | null) {
  cached = runtime ? normalizeDesktopRuntime(runtime) : null
}

export function desktopShareEnabled(runtime = readDesktopRuntime()) {
  if (!runtime.enabled) return true
  return runtime.shareEnabled === true
}

export function desktopAdminEnabled(runtime = readDesktopRuntime()) {
  if (!runtime.enabled) return true
  return runtime.adminEnabled === true
}

export function desktopRemoteEnabled(runtime = readDesktopRuntime()) {
  if (!runtime.enabled) return true
  return runtime.mode === 'remote'
}

export async function loadDesktopRuntime(fetchImpl: typeof fetch = fetch): Promise<DesktopRuntime> {
  if (inflight) return inflight
  inflight = fetchImpl('/api/desktop/runtime')
    .then(async (response) => {
      if (response.status === 404) {
        const next = isDesktopShell() ? desktopEnabledPlaceholder() : disabledDesktopRuntime()
        cached = next
        return next
      }
      if (!response.ok) throw new Error(`Desktop runtime HTTP ${response.status}`)
      const payload = await response.json() as { ok?: boolean, data?: Partial<DesktopRuntime> }
      if (!payload?.ok || !payload.data) throw new Error('Desktop runtime payload is invalid.')
      const next = normalizeDesktopRuntime(payload.data)
      cached = next
      return next
    })
    .catch(() => {
      if (cached) return cached
      if (isDesktopShell()) return desktopEnabledPlaceholder()
      return disabledDesktopRuntime()
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

function desktopEnabledPlaceholder(): DesktopRuntime {
  return {
    enabled: true,
    mode: 'local',
    remoteOrigin: null,
    remoteEmail: null,
    shareEnabled: false,
    adminEnabled: false,
    teamEnabled: false,
    unlimited: true,
    linkedAt: null,
    unlockRequired: false,
    unlocked: true,
  }
}

function normalizeDesktopRuntime(value: Partial<DesktopRuntime> | undefined): DesktopRuntime {
  const enabled = Boolean(value?.enabled)
  if (!enabled) return disabledDesktopRuntime()
  return {
    enabled: true,
    mode: value?.mode === 'remote' ? 'remote' : 'local',
    remoteOrigin: typeof value?.remoteOrigin === 'string' ? value.remoteOrigin : null,
    remoteEmail: typeof value?.remoteEmail === 'string' ? value.remoteEmail : null,
    shareEnabled: value?.shareEnabled === true,
    adminEnabled: false,
    teamEnabled: false,
    unlimited: value?.unlimited !== false && value?.mode !== 'remote',
    linkedAt: typeof value?.linkedAt === 'string' ? value.linkedAt : null,
    unlockRequired: value?.unlockRequired === true,
    unlocked: value?.unlockRequired === true ? value?.unlocked === true : true,
  }
}
