const FLASH_CLASS = 'field-invalid-flash'
const FLASH_MS = 1600

const activeTimers = new Map<Element, number>()

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Points at the field a rejected save named.
 *
 * A toast that says "check the supervisor lab link" still leaves the reader
 * hunting for it, so the field itself is scrolled into view and outlined until
 * the eye has had time to land on it. Fields opt in with `data-field-path`
 * matching the server's error path; anything unannotated simply does nothing.
 */
export function flashInvalidField(path: string | null | undefined) {
  if (!path || typeof document === 'undefined') return false
  const selector = `[data-field-path="${CSS.escape(path)}"]`
  const target = document.querySelector<HTMLElement>(selector)
  if (!target) return false

  const previous = activeTimers.get(target)
  if (previous !== undefined) {
    window.clearTimeout(previous)
    target.classList.remove(FLASH_CLASS)
    // Restart the animation rather than letting the second failure land on an
    // element that is already mid-flash and appear to do nothing.
    void target.offsetWidth
  }

  target.classList.add(FLASH_CLASS)
  activeTimers.set(
    target,
    window.setTimeout(() => {
      activeTimers.delete(target)
      target.classList.remove(FLASH_CLASS)
    }, FLASH_MS),
  )

  if (typeof target.scrollIntoView === 'function') {
    target.scrollIntoView({
      block: 'center',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    })
  }
  const focusable = target.querySelector<HTMLElement>('input, textarea, select, [contenteditable="true"]')
  focusable?.focus({ preventScroll: true })
  return true
}
