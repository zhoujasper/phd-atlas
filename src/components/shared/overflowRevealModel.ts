const OVERFLOW_EPSILON = 1
export const OVERFLOW_REVEAL_HOVER_DELAY_MS = 500

export const OVERFLOW_REVEAL_EXCLUDED_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
  '[data-overflow-reveal="off"]',
  '.overflow-reveal',
  '[data-global-overflow-reveal]',
].join(',')

function clippedOverflow(value: string) {
  return value === 'hidden' || value === 'clip'
}

export function overflowRevealText(element: HTMLElement) {
  const override = element.getAttribute('data-overflow-full-text')
  if (override !== null) return override.trim()

  const innerText = typeof element.innerText === 'string' ? element.innerText : ''
  return (innerText || element.textContent || '')
    .replace(/\u00ad/g, '')
    .trim()
}

export function overflowRevealCopyValue(element: HTMLElement, text: string) {
  return (element.getAttribute('data-overflow-copy-value') ?? text).trim()
}

/**
 * Detect only text that is visually clipped right now. Ordinary layout shells
 * with overflow:hidden are deliberately excluded unless they also opt into a
 * text truncation pattern (ellipsis, line-clamp, or nowrap clipping).
 */
export function isElementVisuallyTruncated(element: HTMLElement) {
  if (
    !element.isConnected
    || element.closest(OVERFLOW_REVEAL_EXCLUDED_SELECTOR)
  ) {
    return false
  }
  if (!overflowRevealText(element)) return false

  const style = window.getComputedStyle(element)
  const inlineStyle = element.style
  if (style.display === 'none' || style.visibility === 'hidden') return false

  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false

  const clippedHorizontally = element.scrollWidth > element.clientWidth + OVERFLOW_EPSILON
  const clippedVertically = element.scrollHeight > element.clientHeight + OVERFLOW_EPSILON
  if (!clippedHorizontally && !clippedVertically) return false

  const overflowX = style.overflowX || style.overflow || inlineStyle.overflowX || inlineStyle.overflow
  const lineClampValue = style.webkitLineClamp
    || style.getPropertyValue('-webkit-line-clamp')
    || inlineStyle.webkitLineClamp
    || inlineStyle.getPropertyValue('-webkit-line-clamp')
    || '0'
  const lineClamp = Number.parseInt(lineClampValue, 10)
  const textOverflow = style.textOverflow || inlineStyle.textOverflow
  const whiteSpace = style.whiteSpace || inlineStyle.whiteSpace
  const ellipsis = textOverflow === 'ellipsis'
  const nowrapClip = (
    whiteSpace === 'nowrap'
    || whiteSpace === 'pre'
  ) && clippedOverflow(overflowX)
  const lineClamped = Number.isFinite(lineClamp) && lineClamp > 0 && clippedVertically
  const forced = element.getAttribute('data-overflow-reveal') === 'always'

  return forced
    ? clippedHorizontally || clippedVertically
    : (ellipsis && (clippedHorizontally || clippedVertically))
      || (nowrapClip && clippedHorizontally)
      || (lineClamped && clippedVertically)
}
