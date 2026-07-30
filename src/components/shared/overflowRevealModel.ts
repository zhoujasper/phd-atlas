const OVERFLOW_EPSILON = 1
export const OVERFLOW_REVEAL_HOVER_DELAY_MS = 1000
export const OVERFLOW_REVEAL_POINTER_FOCUS_SUPPRESSION_MS = 700

export const OVERFLOW_REVEAL_INTENT_SELECTOR = [
  '[data-overflow-reveal="auto"]',
  '[data-overflow-reveal="always"]',
  '[data-overflow-full-text]',
].join(',')

export const OVERFLOW_REVEAL_EXCLUDED_SELECTOR = [
  'input',
  'textarea',
  'select',
  'button',
  'a[href]',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[contenteditable]:not([contenteditable="false"])',
  '[data-overflow-reveal="off"]',
  '.overflow-reveal',
  '[data-global-overflow-reveal]',
].join(',')

function clippedOverflow(value: string) {
  return value === 'hidden' || value === 'clip'
}

function normalizedOverflowText(value: string | null | undefined) {
  return (value ?? '')
    .replace(/\u00ad/g, '')
    .trim()
}

function closestOverflowAttribute(element: HTMLElement, name: string) {
  return element.closest<HTMLElement>(`[${name}]`)?.getAttribute(name) ?? null
}

function completeTitleForEllipsizedText(element: HTMLElement, renderedText: string) {
  if (!/(?:\u2026|\.{3})\s*$/.test(renderedText)) return ''
  const visiblePrefix = renderedText.replace(/(?:\u2026|\.{3})\s*$/, '').trimEnd()
  if (visiblePrefix.length < 4) return ''

  const title = normalizedOverflowText(element.getAttribute('title'))
  return title.length > renderedText.length && title.startsWith(visiblePrefix)
    ? title
    : ''
}

export function overflowRevealText(element: HTMLElement) {
  const override = closestOverflowAttribute(element, 'data-overflow-full-text')
  if (override !== null) return normalizedOverflowText(override)

  const innerText = typeof element.innerText === 'string' ? element.innerText : ''
  const renderedText = normalizedOverflowText(innerText || element.textContent)
  return completeTitleForEllipsizedText(element, renderedText) || renderedText
}

/**
 * Detect whether this exact element is clipping text right now. This lower-level
 * check intentionally ignores the global opt-in/exclusion contract so the
 * explicit OverflowReveal component can reuse the same geometry rules.
 */
export function hasVisualTextTruncation(
  element: HTMLElement,
  allowNonstandardClip = false,
) {
  if (!element.isConnected) return false
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

  return allowNonstandardClip
    ? clippedHorizontally || clippedVertically
    : (ellipsis && (clippedHorizontally || clippedVertically))
      || (nowrapClip && clippedHorizontally)
      || (lineClamped && clippedVertically)
}

/**
 * The document-level reveal is deliberately opt-in. CSS overflow can come from
 * decorative pseudo-elements, clipped animation layers, or compact controls,
 * so geometry alone is not evidence that a full-text preview is desirable.
 */
export function isElementVisuallyTruncated(element: HTMLElement) {
  if (
    !element.isConnected
    || element.closest(OVERFLOW_REVEAL_EXCLUDED_SELECTOR)
  ) {
    return false
  }

  const intent = element.closest<HTMLElement>(OVERFLOW_REVEAL_INTENT_SELECTOR)
  if (!intent) return false

  return hasVisualTextTruncation(
    element,
    intent.getAttribute('data-overflow-reveal') === 'always',
  )
}
