const { contextBridge, ipcRenderer } = require('electron')

// Sandboxed preloads must be CommonJS. This only marks the renderer as the
// desktop shell; live mode still comes from GET /api/desktop/runtime.
contextBridge.exposeInMainWorld('phdAtlasDesktop', {
  enabled: true,
  platform: process.platform,
  language: process.argv.find((argument) => argument.startsWith('--phd-atlas-language='))?.split('=')[1],
  setLanguage(language) {
    ipcRenderer.send('desktop:set-language', language)
  },
  onPrepareQuit(prepare) {
    const listener = (_event, requestId) => {
      Promise.resolve().then(() => prepare()).then(
        (allowed) => ipcRenderer.send('desktop:quit-ready', { requestId, allowed: allowed === true }),
        () => ipcRenderer.send('desktop:quit-ready', { requestId, allowed: false }),
      )
    }
    ipcRenderer.on('desktop:prepare-quit', listener)
    ipcRenderer.send('desktop:quit-handler-ready')
    return () => {
      ipcRenderer.removeListener('desktop:prepare-quit', listener)
      ipcRenderer.send('desktop:quit-handler-ready', false)
    }
  },
})

ipcRenderer.on('desktop:locale', (_event, locale) => {
  if (window.location.protocol !== 'file:') return
  document.documentElement.lang = locale.language === 'zh' ? 'zh-CN' : locale.language
  document.getElementById('desktop-loading')?.setAttribute('aria-label', locale.loading)
})
