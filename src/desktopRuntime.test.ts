import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  desktopAdminEnabled,
  desktopRemoteEnabled,
  desktopShareEnabled,
  isDesktopShell,
  loadDesktopRuntime,
  readDesktopRuntime,
  setDesktopRuntime,
} from './desktopRuntime'

describe('desktop runtime UI gates', () => {
  afterEach(() => {
    setDesktopRuntime(null)
    if (typeof window !== 'undefined') delete window.phdAtlasDesktop
  })

  it('treats a missing desktop runtime route as local desktop when the shell is already marked', async () => {
    window.phdAtlasDesktop = { enabled: true }
    setDesktopRuntime(null)
    const fetchImpl = vi.fn(async () => new Response('Not found', { status: 404 }))
    const runtime = await loadDesktopRuntime(fetchImpl)
    expect(runtime.enabled).toBe(true)
    expect(runtime.mode).toBe('local')
    expect(isDesktopShell()).toBe(true)
    expect(readDesktopRuntime().enabled).toBe(true)
  })

  it('loads connected runtime from the desktop API instead of a stale preload snapshot', async () => {
    window.phdAtlasDesktop = {
      enabled: true,
      mode: 'local',
      shareEnabled: false,
      unlimited: true,
    }
    setDesktopRuntime(null)
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      data: {
        enabled: true,
        mode: 'remote',
        remoteOrigin: 'https://phd.example.com',
        remoteEmail: 'user@example.com',
        shareEnabled: true,
        adminEnabled: false,
        teamEnabled: false,
        unlimited: false,
        linkedAt: '2026-08-22T00:00:00.000Z',
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    const runtime = await loadDesktopRuntime(fetchImpl)
    expect(fetchImpl).toHaveBeenCalledWith('/api/desktop/runtime')
    expect(runtime.mode).toBe('remote')
    expect(runtime.shareEnabled).toBe(true)
    expect(runtime.unlimited).toBe(false)
    expect(runtime.remoteOrigin).toBe('https://phd.example.com')
    expect(readDesktopRuntime().mode).toBe('remote')
  })

  it('hides share and admin only in the unlinked desktop app', () => {
    setDesktopRuntime({
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
    })
    expect(desktopShareEnabled()).toBe(false)
    expect(desktopAdminEnabled()).toBe(false)
    expect(desktopRemoteEnabled()).toBe(false)

    setDesktopRuntime({
      enabled: true,
      mode: 'remote',
      remoteOrigin: 'https://phd.example.com',
      remoteEmail: 'user@example.com',
      shareEnabled: true,
      adminEnabled: false,
      teamEnabled: false,
      unlimited: false,
      linkedAt: '2026-08-22T00:00:00.000Z',
      unlockRequired: true,
      unlocked: true,
    })
    expect(desktopShareEnabled()).toBe(true)
    expect(desktopAdminEnabled()).toBe(false)
    expect(desktopRemoteEnabled()).toBe(true)
    expect(readDesktopRuntime().remoteOrigin).toBe('https://phd.example.com')

    setDesktopRuntime(null)
    expect(desktopShareEnabled()).toBe(true)
    expect(desktopAdminEnabled()).toBe(true)
  })

  it('keeps collaboration and administrator surfaces out of the desktop shell and gates share on the live Dossier action', () => {
    const app = readFileSync('src/App.tsx', 'utf8')
    const routes = readFileSync('src/RootRoutes.tsx', 'utf8')
    const settings = readFileSync('src/components/screens/SettingsScreen.tsx', 'utf8')
    expect(app).toContain('desktopShareEnabled(desktopRuntime)')
    expect(app).toContain('desktopRemoteEnabled(desktopRuntime)')
    expect(app).toContain('canShareApplication={canShareInCurrentTeam}')
    expect(app).toContain('canDeliverMail={desktopRemoteEnabled(desktopRuntime)}')
    expect(settings).toContain('desktopLocalOnly')
    expect(settings).toContain('settings.planDesktopLocal')
    expect(settings).toContain('desktopLocalOnly ? null')
    expect(routes).toContain('desktopAdminEnabled(desktopRuntime)')
    expect(routes).toContain('isAdminRoute && allowAdminRoute')
    expect(settings).toContain('desktopRuntime?.enabled && !desktopRuntime.shareEnabled ? null')
    expect(app).toContain('createDesktopSession')
    expect(app).toContain("import('./components/screens/DesktopUnlockScreen')")
    expect(app).toContain('DesktopUnlockScreen')
    expect(settings).toContain('DesktopUnlockSettings')
    expect(readFileSync('desktop/preload.cjs', 'utf8')).not.toContain('shareEnabled: false')
    expect(readFileSync('desktop/main.mjs', 'utf8')).toContain('resolveDesktopNodeBinary')
    expect(readFileSync('desktop/main.mjs', 'utf8')).toContain('resolveDesktopNodeWorkspace')
    expect(readFileSync('desktop/main.mjs', 'utf8')).not.toContain("ELECTRON_RUN_AS_NODE: '1'")
    expect(readFileSync('desktop/electron-builder.yml', 'utf8')).toContain('server/**/*')
    expect(readFileSync('desktop/electron-builder.yml', 'utf8')).toContain('node_modules/**/*')
    expect(readFileSync('desktop/electron-builder.yml', 'utf8')).toContain('\nmac:')
    expect(readFileSync('desktop/electron-builder.yml', 'utf8')).not.toContain('win32-x64.zip')
    expect(readFileSync('desktop/electron-builder.yml', 'utf8')).toContain('identity: "-"')
    expect(readFileSync('desktop/electron-builder.yml', 'utf8')).not.toContain('identity: null')
    expect(readFileSync('desktop/main.mjs', 'utf8')).toContain("titleBarStyle: isMac ? 'hiddenInset'")
    expect(readFileSync('desktop/main.mjs', 'utf8')).toContain('installNativeMacMenu')
    expect(readFileSync('desktop/main.mjs', 'utf8')).toContain('splash.html')
    expect(readFileSync('desktop/preload.cjs', 'utf8')).toContain('platform: process.platform')
    expect(readFileSync('desktop/main.mjs', 'utf8')).toContain("preload: join(desktopRoot, 'preload.cjs')")
    expect(readFileSync('src/App.tsx', 'utf8')).toContain('if (!runtime.enabled)')
    expect(readFileSync('src/App.tsx', 'utf8')).toContain('if (!isDesktopShell())')
    expect(readFileSync('src/App.tsx', 'utf8')).toContain('desktopShell || desktopRuntime.enabled ? (')
    expect(readFileSync('src/App.tsx', 'utf8')).not.toContain('desktopGate !== \'open\'')
    expect(readFileSync('index.html', 'utf8')).toContain('/desktop-shell.js')
    expect(readFileSync('public/desktop-shell.js', 'utf8')).toContain('fromElectron')
    expect(readFileSync('public/boot-variant.js', 'utf8')).toContain('desktopShell')
    expect(readFileSync('src/main.tsx', 'utf8')).toContain('disableServiceWorkerForDesktop')
    expect(readFileSync('package.json', 'utf8')).toContain('desktop/sign-mac-app.mjs')
    expect(readFileSync('package.json', 'utf8')).toContain('desktop/write-portable-layout.mjs')
  })
})
