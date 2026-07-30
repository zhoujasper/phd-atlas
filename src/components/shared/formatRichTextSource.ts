import type { RichTextFormat } from './richText'

const formatterOptions = {
  printWidth: 88,
  proseWrap: 'preserve' as const,
  tabWidth: 2,
  useTabs: false,
}

export async function formatRichTextSource(value: string, format: RichTextFormat) {
  if (!value.trim() || format === 'plain') return value

  const prettier = await import('prettier/standalone')
  const plugin = format === 'html'
    ? await import('prettier/plugins/html')
    : await import('prettier/plugins/markdown')
  const formatted = await prettier.format(value, {
    ...formatterOptions,
    parser: format,
    plugins: [plugin.default],
    ...(format === 'html' ? { htmlWhitespaceSensitivity: 'css' as const } : {}),
  })

  return formatted.replace(/\r\n/g, '\n').replace(/\n$/, '')
}
