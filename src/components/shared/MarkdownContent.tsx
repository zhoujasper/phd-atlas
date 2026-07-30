import { useMemo } from 'react'
import { richTextToSafeHtml, type RichTextFormat } from './richText'

export function MarkdownContent({
  value,
  className = '',
  format,
}: {
  value: string
  className?: string
  format?: RichTextFormat
}) {
  const html = useMemo(() => richTextToSafeHtml(value, format), [format, value])
  if (!value.trim()) return null

  return (
    <div
      className={`markdown-content ${className}`.trim()}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
