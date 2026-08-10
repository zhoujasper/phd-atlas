/**
 * Couples a transport-owned admission lease to every async handler that was
 * synchronously dispatched under it. Transport closure alone cannot release
 * uncancellable database/backup/SMTP/native work; the final handler promise
 * must settle as well.
 */
export function createAdmissionWorkTracker({ release, onRelease = () => {} } = {}) {
  if (typeof release !== 'function') throw new TypeError('release is required.')
  if (typeof onRelease !== 'function') throw new TypeError('onRelease must be a function.')

  let dispatchFinished = false
  let transportSettled = false
  let pending = 0
  let released = false

  const maybeRelease = () => {
    if (released || !dispatchFinished || !transportSettled || pending > 0) return false
    released = true
    release()
    onRelease()
    return true
  }

  return {
    track(promise) {
      if (released) throw new Error('Cannot track work after admission release.')
      pending += 1
      Promise.resolve(promise).then(
        () => {
          pending = Math.max(0, pending - 1)
          maybeRelease()
        },
        () => {
          pending = Math.max(0, pending - 1)
          maybeRelease()
        },
      )
    },
    finishDispatch() {
      dispatchFinished = true
      maybeRelease()
    },
    settleTransport() {
      transportSettled = true
      maybeRelease()
    },
    snapshot: () => ({ dispatchFinished, transportSettled, pending, released }),
  }
}
