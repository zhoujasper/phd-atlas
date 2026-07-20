import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nContext, type I18nContextValue } from '../hooks/useI18n'
import { FileDropzone } from './FileDropzone'

const messages: Record<string, string> = {
  'fileUpload.releaseToAdd': 'Release to add the files',
  'fileUpload.chooseFiles': 'Choose files',
  'fileUpload.chooseFile': 'Choose file',
  'fileUpload.defaultMultipleHint': 'Up to {count} files · {size} each',
  'fileUpload.defaultSingleHint': 'One file · {size}',
  'fileUpload.filesTooLarge': '{names} exceed {size}.',
  'fileUpload.filesWrongType': '{names} do not match {types}.',
  'fileUpload.singleFileOnly': 'One file only.',
  'fileUpload.tooManyFiles': 'Up to {count} files.',
  'fileUpload.supportedTypes': 'supported files',
}

const i18n: I18nContextValue = {
  lang: 'en',
  t: {},
  tx: (path, fallback) => messages[path] ?? fallback ?? path,
  format: (template, values) => Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  ),
}

function renderDropzone(props: Partial<React.ComponentProps<typeof FileDropzone>> = {}) {
  const onFiles = props.onFiles ?? vi.fn()
  render(
    <I18nContext.Provider value={i18n}>
      <FileDropzone title="Add attachments" onFiles={onFiles} {...props} />
    </I18nContext.Provider>,
  )
  return { onFiles }
}

describe('FileDropzone', () => {
  it('accepts several files from one drag-and-drop action', () => {
    const { onFiles } = renderDropzone({ allowedTypes: ['.pdf'] })
    const dropzone = screen.getByRole('button', { name: /Add attachments/i })
    const files = [new File(['a'], 'a.pdf'), new File(['b'], 'b.pdf')]

    fireEvent.drop(dropzone, { dataTransfer: { files, dropEffect: 'none' } })

    expect(onFiles).toHaveBeenCalledTimes(1)
    expect(onFiles).toHaveBeenCalledWith(files)
  })

  it('rejects an oversized file individually while keeping valid files', () => {
    const { onFiles } = renderDropzone({ allowedTypes: ['.pdf'], maxFileSize: 2 })
    const dropzone = screen.getByRole('button', { name: /Add attachments/i })
    const large = new File(['large'], 'large.pdf')
    const small = new File(['x'], 'small.pdf')

    fireEvent.drop(dropzone, { dataTransfer: { files: [large, small], dropEffect: 'none' } })

    expect(onFiles).toHaveBeenCalledWith([small])
    expect(screen.getByRole('alert')).toHaveTextContent('large.pdf')
  })
})
