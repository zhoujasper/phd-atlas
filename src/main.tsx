import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/loading.css'
import './styles/surface-polish.css'
import mobileStylesheetUrl from './styles/mobile.css?url'
import { RootRoutes } from './RootRoutes'
import { startConnectivityMonitoring } from './connectivity'
import { registerServiceWorker } from './serviceWorker'
import { installLazyModuleRecovery } from './lazyModuleRecovery'
import { installResponsiveStylesheet } from './responsiveStylesheet'
import { AppErrorBoundary } from './components/shared/AppErrorBoundary'
// Capture beforeinstallprompt before the lazy App chunk loads — browsers may
// fire it during SW activation while the main shell is still hydrating.
import { capturePwaInstallPrompt } from './components/hooks/usePwaInstall'

capturePwaInstallPrompt()
installResponsiveStylesheet('mobile-product-shell', mobileStylesheetUrl, '(max-width: 820px)')
const stopLazyModuleRecovery = installLazyModuleRecovery()
const stopConnectivityMonitoring = startConnectivityMonitoring()
import.meta.hot?.dispose(stopConnectivityMonitoring)
import.meta.hot?.dispose(stopLazyModuleRecovery)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <RootRoutes />
    </AppErrorBoundary>
  </StrictMode>,
)

registerServiceWorker()
