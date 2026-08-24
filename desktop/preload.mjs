import { contextBridge } from 'electron'

// Only advertise that this renderer is the desktop shell. Live mode, quotas,
// and share availability come from GET /api/desktop/runtime after the API starts.
contextBridge.exposeInMainWorld('phdAtlasDesktop', {
  enabled: true,
})
