import { AlertTriangle } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../hooks/useI18n'

type ValidatableElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
type PromptPlacement = 'bottom' | 'top'

type PromptState = {
  message: string
  placement: PromptPlacement
  style: CSSProperties
}

type StoredA11yState = {
  element: ValidatableElement
  describedBy: string | null
  invalid: string | null
}

const VIEWPORT_MARGIN = 16
const PROMPT_MAX_WIDTH = 360
const PROMPT_MIN_WIDTH = 240
const PROMPT_ESTIMATED_HEIGHT = 88
const PROMPT_GAP = 8
const PROMPT_ARROW_MARGIN = 18

function isValidatableElement(target: EventTarget | null): target is ValidatableElement {
  return target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function cleanFieldLabel(value: string | null | undefined) {
  return (value ?? '')
    .replace(/\s*\*\s*$/u, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

function labelledByText(element: ValidatableElement) {
  const labelledBy = element.getAttribute('aria-labelledby')
  if (!labelledBy) return ''
  return labelledBy
    .split(/\s+/u)
    .map((id) => cleanFieldLabel(document.getElementById(id)?.textContent))
    .filter(Boolean)
    .join(' ')
}

function getFieldLabel(element: ValidatableElement, fallback: string) {
  const ariaLabel = cleanFieldLabel(element.getAttribute('aria-label'))
  if (ariaLabel) return ariaLabel

  const ariaLabelledBy = labelledByText(element)
  if (ariaLabelledBy) return ariaLabelledBy

  const label = element.labels?.[0] ?? null
  const labelSpan = label?.querySelector('span')
  const labelText = cleanFieldLabel(labelSpan?.textContent ?? label?.textContent)
  if (labelText) return labelText

  const placeholder = cleanFieldLabel(element.getAttribute('placeholder'))
  return placeholder || fallback
}

function getInputType(element: ValidatableElement) {
  return element instanceof HTMLInputElement ? element.type : ''
}

function getLengthLimit(element: ValidatableElement, key: 'minLength' | 'maxLength') {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
    ? element[key]
    : -1
}

function getNumericLimit(element: ValidatableElement, key: 'min' | 'max') {
  return element instanceof HTMLInputElement ? element[key] : ''
}

function addDescription(element: ValidatableElement, descriptionId: string) {
  const describedBy = element.getAttribute('aria-describedby')
  const ids = new Set((describedBy ?? '').split(/\s+/u).filter(Boolean))
  ids.add(descriptionId)
  element.setAttribute('aria-describedby', Array.from(ids).join(' '))
}

function positionForElement(element: ValidatableElement): Pick<PromptState, 'placement' | 'style'> {
  const rect = element.getBoundingClientRect()
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || PROMPT_MAX_WIDTH
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 640
  const width = Math.min(PROMPT_MAX_WIDTH, Math.max(PROMPT_MIN_WIDTH, viewportWidth - VIEWPORT_MARGIN * 2))
  const maxLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN)
  const left = clamp(rect.left, VIEWPORT_MARGIN, maxLeft)
  const anchorX = rect.left + clamp(rect.width / 2, 20, Math.max(20, rect.width - 20))
  const arrowLeft = clamp(anchorX - left, PROMPT_ARROW_MARGIN, width - PROMPT_ARROW_MARGIN)
  const showAbove = rect.bottom + PROMPT_GAP + PROMPT_ESTIMATED_HEIGHT > viewportHeight &&
    rect.top > PROMPT_ESTIMATED_HEIGHT + PROMPT_GAP
  const placement: PromptPlacement = showAbove ? 'top' : 'bottom'
  const top = showAbove ? rect.top - PROMPT_GAP : rect.bottom + PROMPT_GAP

  return {
    placement,
    style: {
      '--validation-left': `${left}px`,
      '--validation-top': `${top}px`,
      '--validation-width': `${width}px`,
      '--validation-arrow-left': `${arrowLeft}px`,
    } as CSSProperties,
  }
}

export function FormValidationPrompt() {
  const { tx, format } = useI18n()
  const promptId = useId()
  const [prompt, setPrompt] = useState<PromptState | null>(null)
  const activeElementRef = useRef<ValidatableElement | null>(null)
  const storedA11yRef = useRef<StoredA11yState | null>(null)
  const invalidCycleTargetRef = useRef<ValidatableElement | null>(null)

  const restoreElementState = useCallback((element: ValidatableElement | null) => {
    const stored = storedA11yRef.current
    if (!element || !stored || stored.element !== element) return

    if (stored.describedBy) {
      element.setAttribute('aria-describedby', stored.describedBy)
    } else {
      element.removeAttribute('aria-describedby')
    }

    if (stored.invalid) {
      element.setAttribute('aria-invalid', stored.invalid)
    } else {
      element.removeAttribute('aria-invalid')
    }

    delete element.dataset.atlasValidationActive
    storedA11yRef.current = null
  }, [])

  const hidePrompt = useCallback(() => {
    restoreElementState(activeElementRef.current)
    activeElementRef.current = null
    setPrompt(null)
  }, [restoreElementState])

  const validationMessage = useCallback((element: ValidatableElement) => {
    const field = getFieldLabel(element, tx('formValidation.fieldFallback'))
    const validity = element.validity

    if (validity.customError && element.validationMessage) return element.validationMessage
    if (validity.valueMissing) return format(tx('formValidation.required'), { field })
    if (validity.typeMismatch && getInputType(element) === 'email') {
      return format(tx('formValidation.email'), { field })
    }
    if (validity.typeMismatch && getInputType(element) === 'url') {
      return format(tx('formValidation.url'), { field })
    }
    if (validity.tooShort) {
      return format(tx('formValidation.tooShort'), { field, count: getLengthLimit(element, 'minLength') })
    }
    if (validity.tooLong) {
      return format(tx('formValidation.tooLong'), { field, count: getLengthLimit(element, 'maxLength') })
    }
    if (validity.rangeUnderflow) {
      return format(tx('formValidation.rangeUnderflow'), { field, count: getNumericLimit(element, 'min') })
    }
    if (validity.rangeOverflow) {
      return format(tx('formValidation.rangeOverflow'), { field, count: getNumericLimit(element, 'max') })
    }
    if (validity.patternMismatch) return format(tx('formValidation.pattern'), { field })
    if (validity.badInput || validity.stepMismatch) return format(tx('formValidation.badInput'), { field })
    return format(tx('formValidation.generic'), { field })
  }, [format, tx])

  const showPrompt = useCallback((element: ValidatableElement) => {
    if (activeElementRef.current !== element) {
      restoreElementState(activeElementRef.current)
      storedA11yRef.current = {
        element,
        describedBy: element.getAttribute('aria-describedby'),
        invalid: element.getAttribute('aria-invalid'),
      }
    }

    activeElementRef.current = element
    element.dataset.atlasValidationActive = 'true'
    element.setAttribute('aria-invalid', 'true')
    addDescription(element, promptId)

    const nextPosition = positionForElement(element)
    setPrompt({
      message: validationMessage(element),
      placement: nextPosition.placement,
      style: nextPosition.style,
    })
  }, [promptId, restoreElementState, validationMessage])

  useEffect(() => {
    function handleInvalid(event: Event) {
      if (!isValidatableElement(event.target)) return
      event.preventDefault()

      const element = event.target
      if (invalidCycleTargetRef.current && invalidCycleTargetRef.current !== element) return

      invalidCycleTargetRef.current = element
      window.setTimeout(() => {
        invalidCycleTargetRef.current = null
      }, 0)

      showPrompt(element)
      element.focus({ preventScroll: false })
    }

    function handleInput(event: Event) {
      if (!isValidatableElement(event.target)) return
      const element = event.target
      if (element.dataset.atlasValidationActive !== 'true') return

      if (element.validity.valid) {
        if (activeElementRef.current === element) {
          hidePrompt()
        } else {
          restoreElementState(element)
        }
        return
      }

      if (activeElementRef.current === element) {
        const nextPosition = positionForElement(element)
        setPrompt({
          message: validationMessage(element),
          placement: nextPosition.placement,
          style: nextPosition.style,
        })
      }
    }

    function handleFocusIn(event: Event) {
      if (!isValidatableElement(event.target)) {
        hidePrompt()
        return
      }
      if (activeElementRef.current && activeElementRef.current !== event.target) hidePrompt()
    }

    function repositionPrompt() {
      const element = activeElementRef.current
      if (!element || !element.isConnected) {
        hidePrompt()
        return
      }
      const nextPosition = positionForElement(element)
      setPrompt((current) => current
        ? { ...current, placement: nextPosition.placement, style: nextPosition.style }
        : current)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && activeElementRef.current) hidePrompt()
    }

    document.addEventListener('invalid', handleInvalid, true)
    document.addEventListener('input', handleInput, true)
    document.addEventListener('change', handleInput, true)
    document.addEventListener('focusin', handleFocusIn, true)
    window.addEventListener('resize', repositionPrompt)
    window.addEventListener('scroll', repositionPrompt, true)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('invalid', handleInvalid, true)
      document.removeEventListener('input', handleInput, true)
      document.removeEventListener('change', handleInput, true)
      document.removeEventListener('focusin', handleFocusIn, true)
      window.removeEventListener('resize', repositionPrompt)
      window.removeEventListener('scroll', repositionPrompt, true)
      window.removeEventListener('keydown', handleKeyDown)
      restoreElementState(activeElementRef.current)
    }
  }, [hidePrompt, restoreElementState, showPrompt, validationMessage])

  if (!prompt) return null

  return createPortal(
    <div
      id={promptId}
      className="atlas-validation-popover"
      data-placement={prompt.placement}
      role="alert"
      aria-live="assertive"
      style={prompt.style}
    >
      <span className="atlas-validation-icon" aria-hidden="true">
        <AlertTriangle size={14} />
      </span>
      <span className="atlas-validation-copy">
        <strong>{tx('formValidation.title')}</strong>
        <span>{prompt.message}</span>
      </span>
    </div>,
    document.body,
  )
}
