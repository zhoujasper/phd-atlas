/**
 * The single browser-reload primitive. Callers must complete their safe-reload
 * preparation before reaching this function.
 */
let reloadCommitted = false

export function reloadPage() {
  if (reloadCommitted) return false
  reloadCommitted = true
  try {
    window.location.reload()
    return true
  } catch (error) {
    reloadCommitted = false
    throw error
  }
}
