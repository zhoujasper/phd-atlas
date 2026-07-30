export type RichTextFormat = 'plain' | 'markdown' | 'html'

export function detectRichTextFormat(value: string): RichTextFormat
export function plainTextToSafeHtml(value: string): string
export function markdownToSafeHtml(value: string): string
export function sanitizeRichHtml(value: string): string
export function richTextToSafeHtml(value: string, format?: RichTextFormat): string
export function richTextToPlainText(value: string, format?: RichTextFormat): string
export function richTextNeedsFidelityPreview(value: string, format?: RichTextFormat): boolean
export function renderSafeRichTextEmailHtml(contentHtml: string): string
export function renderRichTextEmail(value: string, format?: RichTextFormat): {
  format: RichTextFormat
  contentHtml: string
  text: string
  html: string
}
export function renderStoredRichTextEmail(communication: {
  summary?: string
  bodyFormat?: RichTextFormat
  bodyHtml?: string
  bodyText?: string
}): {
  format: RichTextFormat
  contentHtml: string
  text: string
  html: string
}
