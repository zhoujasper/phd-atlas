/**
 * Normalize multiline text that may contain literal escape markers (`\n`, `\r\n`, `\r`)
 * from double-encoded i18n/JSON sources, plus real CR/LF sequences.
 * Safe for already-normalized content.
 */
export function normalizeEscapedMultiline(value: string): string {
  if (!value) return value
  return value
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}
