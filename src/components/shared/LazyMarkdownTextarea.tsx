import { forwardRef, lazy, Suspense } from 'react'
import type { MarkdownTextareaProps } from './MarkdownTextarea'

const MarkdownEditor = lazy(() => import('./MarkdownTextarea').then((module) => ({
  default: module.MarkdownTextarea,
})))

/**
 * Keeps text entry interactive while the Lexical editor bundle loads. The native
 * textarea writes through the same controlled value/onChange pair, so switching
 * to the full editor never drops keystrokes or moves data into a second state.
 */
export const LazyMarkdownTextarea = forwardRef<HTMLTextAreaElement, MarkdownTextareaProps>(
  function LazyMarkdownTextarea(props, forwardedRef) {
    const {
      className = '',
      defaultMode: _defaultMode,
      previewClassName: _previewClassName,
      ...fallbackProps
    } = props

    return (
      <Suspense
        fallback={(
          <textarea
            {...fallbackProps}
            ref={forwardedRef}
            className={`markdown-textarea-lazy-fallback ${className}`.trim()}
            data-editor-loading="true"
          />
        )}
      >
        <MarkdownEditor {...props} ref={forwardedRef} />
      </Suspense>
    )
  },
)
