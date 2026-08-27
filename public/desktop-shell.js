(() => {
  const fromElectron = /\bElectron\b/i.test(String(navigator.userAgent || ''))
  const previous = window.phdAtlasDesktop || { enabled: false }
  window.phdAtlasDesktop = previous
  if (fromElectron || previous.enabled) window.phdAtlasDesktop.enabled = true
})()
