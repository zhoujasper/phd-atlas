import { lazy, Suspense } from 'react'
import { StandaloneProviders } from './components/StandaloneProviders'
import { LaunchScreen } from './components/shared/LaunchScreen'
import { PUBLIC_EDITION } from './edition'

const App = lazy(() => import('./App'))
const AdminApp = lazy(() => import('./admin/AdminApp').then((m) => ({ default: m.AdminApp })))
const ResetPassword = lazy(() =>
  import('./components/screens/ResetPassword').then((m) => ({ default: m.ResetPassword })),
)
const ShareViewer = lazy(() =>
  import('./components/screens/ShareViewer').then((m) => ({ default: m.ShareViewer })),
)
const AssetUploadViewer = lazy(() =>
  import('./components/screens/AssetUploadViewer').then((m) => ({ default: m.AssetUploadViewer })),
)
const UpgradeProScreen = lazy(() =>
  import('./components/screens/UpgradeProScreen').then((m) => ({ default: m.UpgradeProScreen })),
)
const TeamInviteScreen = lazy(() =>
  import('./components/screens/TeamInviteScreen').then((m) => ({ default: m.TeamInviteScreen })),
)
const TeamJoinScreen = lazy(() =>
  import('./components/screens/TeamJoinScreen').then((m) => ({ default: m.TeamJoinScreen })),
)

function RouteFallback() {
  // Route-shaped skeleton while the main app chunk loads — message is language-agnostic
  // until i18n mounts inside App.
  return <LaunchScreen message="PhD Atlas" detail="Loading workspace…" />
}

export function RootRoutes() {
  const isAdminRoute = window.location.pathname.startsWith('/admin')
  const isShareRoute = window.location.pathname.startsWith('/share/')
  const isAssetUploadRoute = window.location.pathname.startsWith('/asset-upload/')
  const isResetRoute = window.location.pathname.startsWith('/reset-password/')
  const isUpgradeRoute = ['/upgrade-pro', '/pro', '/membership'].includes(window.location.pathname)
  const isTeamInviteRoute = !PUBLIC_EDITION && window.location.pathname.startsWith('/team/accept-invite/')
  const isTeamJoinRoute = !PUBLIC_EDITION && window.location.pathname.startsWith('/team/join/')

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
      ) : isUpgradeRoute ? (
        <StandaloneProviders>
          <UpgradeProScreen />
        </StandaloneProviders>
      ) : isResetRoute ? (
        <StandaloneProviders>
          <ResetPassword token={decodeURIComponent(window.location.pathname.split('/reset-password/')[1] ?? '')} />
        </StandaloneProviders>
      ) : isAdminRoute ? (
        <AdminApp />
      ) : (
        <App />
      )}
    </Suspense>
  )
}
