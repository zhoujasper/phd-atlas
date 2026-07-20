(() => {
  let theme
  try {
    const stored = localStorage.getItem('phd-atlas-theme')
    const dark = stored === 'dark' || (
      stored !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches
    )
    theme = dark ? 'dark' : 'light'
  } catch {
    theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  document.documentElement.dataset.bootTheme = theme
  document.documentElement.dataset.theme = theme
})()
