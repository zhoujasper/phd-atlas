import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/loading.css'
import './styles/ai.css'
import './styles/onboarding.css'
import './styles/settings.css'
import './styles/mail-actions.css'
import './styles/surface-polish.css'
import './styles/discover.css'
import './styles/dossier-collapsed.css'
import './styles/application-transfer.css'
import './styles/dashboard-guidance.css'
import './styles/school-logo.css'
import './styles/mobile.css'
import { RootRoutes } from './RootRoutes'
import { registerServiceWorker } from './serviceWorker'
// Capture beforeinstallprompt before the lazy App chunk loads — browsers may
// fire it during SW activation while the main shell is still hydrating.
import { capturePwaInstallPrompt } from './components/hooks/usePwaInstall'

capturePwaInstallPrompt()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootRoutes />
  </StrictMode>,
)

registerServiceWorker()
