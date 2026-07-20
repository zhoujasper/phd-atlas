import { useMemo } from 'react'
import { richTextToSafeHtml } from './richText'

export function MarkdownContent({ value, className = '' }: { value: string; className?: string }) {
  const html = useMemo(() => richTextToSafeHtml(value), [value])
  if (!value.trim()) return null

  return (
    <div
      className={`markdown-content ${className}`.trim()}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
