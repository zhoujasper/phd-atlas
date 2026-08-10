import {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useImperativeHandle,
  useRef,
  type ChangeEvent,
  type CSSProperties,
} from 'react'
import type {
  MarkdownTextareaController,
  MarkdownTextareaProps,
  MarkdownTextareaReplaceResult,
  MarkdownTextareaSelection,
} from './MarkdownTextarea'
import { createRecoverableModuleLoader } from '../../lazyModuleRecovery'
import { MarkdownContent } from './MarkdownContent'
import { detectRichTextFormat, richTextToPlainText } from './richText'

const MarkdownEditor = lazy(createRecoverableModuleLoader(() => import('./MarkdownTextarea').then((module) => ({
  default: module.MarkdownTextarea,
}))))

const MARKDOWN_BLOCK_LINE = /^\s{0,3}(?:#{1,6}\s|>|[-*+]\s|\d+[.)]\s|```|~~~|\|)|^\s*<\/?[a-z][^>]*>\s*$/i

function preservePreviewSoftBreaks(value: string) {
  const lines = value.split('\n')
  let fence = ''
  return lines.map((line, index) => {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/)
    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      fence = fence === marker ? '' : marker
      return line
    }
    const next = lines[index + 1]
    if (
      fence
      || next === undefined
      || !line.trim()
      || !next.trim()
      || MARKDOWN_BLOCK_LINE.test(line)
      || MARKDOWN_BLOCK_LINE.test(next)
      || /(?:\\| {2,})$/.test(line)
    ) return line
    return `${line}\\`
  }).join('\n')
}

/**
 * Source mode stays interactive while the Lexical editor bundle loads. Visual
 * mode uses a safe rendered, read-only fallback so raw HTML/Markdown never
 * flashes as textarea source before the full editor is ready.
 */
export const LazyMarkdownTextarea = forwardRef<HTMLTextAreaElement, MarkdownTextareaProps>(
  function LazyMarkdownTextarea(props, forwardedRef) {
    const {
      className = '',
      controllerRef,
      defaultMode = 'visual',
      preservePlainLineBreaks = false,
      previewClassName = '',
      ...fallbackProps
    } = props
    const disabled = props.disabled ?? false
    const maxLength = props.maxLength
    const onChange = props.onChange
    const readOnly = props.readOnly ?? false
    const loadedControllerRef = useRef<MarkdownTextareaController | null>(null)
    const sourceFallbackRef = useRef<HTMLTextAreaElement | null>(null)
    const visualFallbackRef = useRef<HTMLDivElement | null>(null)
    const pendingFocusRef = useRef<{ requested: boolean; options?: { atEnd?: boolean } }>({ requested: false })
    const pendingInsertionsRef = useRef<string[]>([])
    const setSourceFallbackRef = useCallback((node: HTMLTextAreaElement | null) => {
      sourceFallbackRef.current = node
      if (typeof forwardedRef === 'function') forwardedRef(node)
      else if (forwardedRef) forwardedRef.current = node
    }, [forwardedRef])
    const setLoadedController = useCallback((controller: MarkdownTextareaController | null) => {
      loadedControllerRef.current = controller
      if (!controller) return
      if (pendingFocusRef.current.requested) {
        controller.focus(pendingFocusRef.current.options)
        pendingFocusRef.current = { requested: false }
      }
      const insertions = pendingInsertionsRef.current
      pendingInsertionsRef.current = []
      insertions.forEach((text) => controller.insertText(text))
    }, [])

    const replaceSourceFallbackRange = useCallback((
      range: MarkdownTextareaSelection | null,
      text: string,
    ): MarkdownTextareaReplaceResult | null => {
      const source = sourceFallbackRef.current
      if (
        defaultMode !== 'source'
        || !source
        || disabled
        || readOnly
        || (range && range.mode !== 'source')
      ) return null
      const start = range?.start ?? source.selectionStart ?? source.value.length
      const end = range?.end ?? source.selectionEnd ?? start
      if (start < 0 || end < start || end > source.value.length) return null
      const nextValue = source.value.slice(0, start) + text + source.value.slice(end)
      if (typeof maxLength === 'number' && nextValue.length > maxLength) return null
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      if (setter) setter.call(source, nextValue)
      else source.value = nextValue
      onChange({ target: source, currentTarget: source } as ChangeEvent<HTMLTextAreaElement>)
      const nextCaret = start + text.length
      source.focus()
      source.setSelectionRange(nextCaret, nextCaret)
      return {
        value: nextValue,
        selection: { mode: 'source', start, end: nextCaret },
      }
    }, [defaultMode, disabled, maxLength, onChange, readOnly])

    useImperativeHandle(controllerRef, () => ({
      getMode: () => loadedControllerRef.current?.getMode() ?? defaultMode,
      getValue: () => loadedControllerRef.current?.getValue()
        ?? sourceFallbackRef.current?.value
        ?? props.value,
      getSelection: () => {
        const controller = loadedControllerRef.current
        if (controller) return controller.getSelection()
        const source = sourceFallbackRef.current
        if (defaultMode !== 'source' || !source) return null
        return {
          mode: 'source',
          start: source.selectionStart ?? source.value.length,
          end: source.selectionEnd ?? source.selectionStart ?? source.value.length,
        }
      },
      focus: (options) => {
        const controller = loadedControllerRef.current
        if (controller) {
          controller.focus(options)
          return
        }
        if (defaultMode === 'source') {
          const source = sourceFallbackRef.current
          source?.focus()
          if (source && options?.atEnd) {
            const end = source.value.length
            source.setSelectionRange(end, end)
          }
          return
        }
        pendingFocusRef.current = { requested: true, options }
        visualFallbackRef.current?.focus()
      },
      insertText: (text) => {
        if (!text || disabled || readOnly) return
        const controller = loadedControllerRef.current
        if (controller) {
          controller.insertText(text)
          return
        }
        const source = sourceFallbackRef.current
        if (defaultMode === 'source' && source) {
          replaceSourceFallbackRange(null, text)
          return
        }
        pendingInsertionsRef.current.push(text)
      },
      replaceRange: (range, text) => {
        const controller = loadedControllerRef.current
        if (controller) return controller.replaceRange(range, text)
        return replaceSourceFallbackRange(range, text)
      },
    }), [defaultMode, disabled, props.value, readOnly, replaceSourceFallbackRange])

    const contentMinHeight = Math.max(56, Number(props.rows ?? 3) * 21 + 18)
    const fallbackStyle = {
      ...props.style,
      '--markdown-editor-content-min-height': `${contentMinHeight}px`,
      '--markdown-editor-min-height': `${contentMinHeight}px`,
    } as CSSProperties
    const fallbackFormat = detectRichTextFormat(props.value)
    const fallbackValue = preservePlainLineBreaks && fallbackFormat === 'markdown'
      ? preservePreviewSoftBreaks(props.value)
      : props.value
    const fallback = defaultMode === 'source'
      ? (
          <textarea
            {...fallbackProps}
            ref={setSourceFallbackRef}
            className={`markdown-textarea-lazy-fallback ${className}`.trim()}
            data-editor-loading="true"
          />
        )
      : (
          <div
            className={`markdown-textarea visual-mode ${props.disabled ? 'is-disabled' : ''} ${props.readOnly ? 'is-readonly' : ''} ${className}`.trim()}
            data-editor-loading="true"
            data-format={fallbackFormat}
            style={fallbackStyle}
          >
            <div className="markdown-editor-stage">
              <div
                id={props.id}
                ref={visualFallbackRef}
                className={`markdown-fidelity-layer ${previewClassName}`.trim()}
                role="textbox"
                aria-label={props['aria-label'] ?? props.placeholder}
                aria-labelledby={props['aria-labelledby']}
                aria-describedby={props['aria-describedby']}
                aria-invalid={props['aria-invalid']}
                aria-required={props.required}
                aria-readonly="true"
                aria-disabled={props.disabled}
                aria-multiline="true"
                aria-busy="true"
                data-editor-loading="true"
                tabIndex={-1}
              >
                {props.value.trim()
                  ? <MarkdownContent value={fallbackValue} format={fallbackFormat} />
                  : <span className="markdown-editor-placeholder">{props.placeholder ?? ''}</span>}
              </div>
              {props.required ? (
                <textarea
                  className="markdown-lazy-required-proxy"
                  value={richTextToPlainText(props.value)}
                  required
                  readOnly
                  hidden
                  aria-hidden="true"
                  tabIndex={-1}
                />
              ) : null}
            </div>
          </div>
        )

    return (
      <Suspense fallback={fallback}>
        <MarkdownEditor {...props} controllerRef={setLoadedController} ref={forwardedRef} />
      </Suspense>
    )
  },
)
