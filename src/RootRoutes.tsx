import { lazy, Suspense } from 'react'
import { StandaloneProviders } from './components/StandaloneProviders'
import { LaunchScreen } from './components/shared/LaunchScreen'
import { PUBLIC_EDITION } from './edition'
import { AdminAccessGate } from './admin/AdminAccessGate'
import { createRecoverableModuleLoader } from './lazyModuleRecovery'
import { desktopAdminEnabled, readDesktopRuntime } from './desktopRuntime'

const App = lazy(createRecoverableModuleLoader(() => import('./App')))
const AdminApp = lazy(createRecoverableModuleLoader(() => import('./admin/AdminApp').then((m) => ({ default: m.AdminApp }))))
const ResetPassword = lazy(createRecoverableModuleLoader(() =>
  import('./components/screens/ResetPassword').then((m) => ({ default: m.ResetPassword })),
))
const ShareViewer = lazy(createRecoverableModuleLoader(() =>
  import('./components/screens/ShareViewer').then((m) => ({ default: m.ShareViewer })),
))
const AssetUploadViewer = lazy(createRecoverableModuleLoader(() =>
  import('./components/screens/AssetUploadViewer').then((m) => ({ default: m.AssetUploadViewer })),
))
const UpgradeProScreen = lazy(createRecoverableModuleLoader(() =>
  import('./components/screens/UpgradeProScreen').then((m) => ({ default: m.UpgradeProScreen })),
))
const TeamInviteScreen = lazy(createRecoverableModuleLoader(() =>
  import('./components/screens/TeamInviteScreen').then((m) => ({ default: m.TeamInviteScreen })),
))
const TeamJoinScreen = lazy(createRecoverableModuleLoader(() =>
  import('./components/screens/TeamJoinScreen').then((m) => ({ default: m.TeamJoinScreen })),
))

function RouteFallback() {
  // Route-shaped skeleton while the main app chunk loads — message is language-agnostic
  // until i18n mounts inside App.
  return <LaunchScreen message="PhD Atlas" />
}

export function RootRoutes() {
  const desktopRuntime = readDesktopRuntime()
  const isAdminRoute = window.location.pathname.startsWith('/admin')
  const isShareRoute = window.location.pathname.startsWith('/share/')
  const isAssetUploadRoute = window.location.pathname.startsWith('/asset-upload/')
  const isResetRoute = window.location.pathname.startsWith('/reset-password/')
  const isUpgradeRoute = ['/upgrade-pro', '/pro', '/membership'].includes(window.location.pathname)
  const isTeamInviteRoute = !PUBLIC_EDITION && window.location.pathname.startsWith('/team/accept-invite/')
  const isTeamJoinRoute = !PUBLIC_EDITION && window.location.pathname.startsWith('/team/join/')
  const allowAdminRoute = desktopAdminEnabled(desktopRuntime)
  const allowUpgradeRoute = !desktopRuntime.enabled || !desktopRuntime.unlimited

  return (
    <Suspense fallback={<RouteFallback />}>
      {isShareRoute ? (
        <StandaloneProviders>
          <ShareViewer token={decodeURIComponent(window.location.pathname.split('/share/')[1] ?? '')} />
        </StandaloneProviders>
      ) : isAssetUploadRoute ? (
        <StandaloneProviders>
          <AssetUploadViewer token={decodeURIComponent(window.location.pathname.split('/asset-upload/')[1] ?? '')} />
        </StandaloneProviders>
      ) : isTeamInviteRoute ? (
        <StandaloneProviders>
          <TeamInviteScreen token={decodeURIComponent(window.location.pathname.split('/team/accept-invite/')[1] ?? '')} />
        </StandaloneProviders>
      ) : isTeamJoinRoute ? (
        <StandaloneProviders>
          <TeamJoinScreen code={decodeURIComponent(window.location.pathname.split('/team/join/')[1] ?? '')} />
        </StandaloneProviders>
      ) : isUpgradeRoute && allowUpgradeRoute ? (
        <StandaloneProviders>
          <UpgradeProScreen />
        </StandaloneProviders>
      ) : isResetRoute ? (
        <StandaloneProviders>
          <ResetPassword token={decodeURIComponent(window.location.pathname.split('/reset-password/')[1] ?? '')} />
        </StandaloneProviders>
      ) : isAdminRoute && allowAdminRoute ? (
        <StandaloneProviders>
          <AdminAccessGate>
            <AdminApp />
          </AdminAccessGate>
        </StandaloneProviders>
      ) : (
        <App />
      )}
    </Suspense>
  )
}
