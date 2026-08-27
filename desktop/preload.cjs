const { contextBridge } = require('electron')

// Sandboxed preloads must be CommonJS. This only marks the renderer as the
// desktop shell; live mode still comes from GET /api/desktop/runtime.
contextBridge.exposeInMainWorld('phdAtlasDesktop', {
  enabled: true,
  platform: process.platform,
})
