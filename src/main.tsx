import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/loading.css'
import './styles/surface-polish.css'
import './styles/desktop-mac.css'
import mobileStylesheetUrl from './styles/mobile.css?url'
import { RootRoutes } from './RootRoutes'
import { startConnectivityMonitoring } from './connectivity'
import { disableServiceWorkerForDesktop, registerServiceWorker } from './serviceWorker'
import { installLazyModuleRecovery } from './lazyModuleRecovery'
import { installResponsiveStylesheet } from './responsiveStylesheet'
import { AppErrorBoundary } from './components/shared/AppErrorBoundary'
// Capture beforeinstallprompt before the lazy App chunk loads — browsers may
// fire it during SW activation while the main shell is still hydrating.
import { capturePwaInstallPrompt } from './components/hooks/usePwaInstall'

capturePwaInstallPrompt()
if (typeof window !== 'undefined' && window.phdAtlasDesktop?.enabled && window.phdAtlasDesktop.platform === 'darwin') {
  document.documentElement.classList.add('desktop-mac')
  if (document.body && !document.querySelector('.desktop-mac-drag-strip')) {
    const strip = document.createElement('div')
    strip.className = 'desktop-mac-drag-strip'
    strip.setAttribute('aria-hidden', 'true')
    document.body.prepend(strip)
  }
}
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

if (window.phdAtlasDesktop?.enabled || /\bElectron\b/i.test(String(navigator.userAgent || ''))) {
  disableServiceWorkerForDesktop()
} else {
  registerServiceWorker()
}
