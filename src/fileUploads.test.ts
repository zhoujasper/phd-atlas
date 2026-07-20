import { describe, expect, it } from 'vitest'
import {
  filesRejectedForReason,
  validateUploadFiles,
} from './fileUploads'

function file(name: string, size: number, type = '') {
  return new File([new Uint8Array(size)], name, { type })
}

describe('validateUploadFiles', () => {
  it('accepts multiple supported files in one selection', () => {
    const result = validateUploadFiles([
      file('cv.pdf', 1024, 'application/pdf'),
      file('portrait.png', 2048, 'image/png'),
      file('data.csv', 4096, 'text/csv'),
    ])

    expect(result.accepted.map((item) => item.name)).toEqual(['cv.pdf', 'portrait.png', 'data.csv'])
    expect(result.rejected).toEqual([])
  })

  it('checks the size of every file independently', () => {
    const result = validateUploadFiles([
      file('too-large.pdf', 11),
      file('small.pdf', 4),
      file('also-too-large.pdf', 12),
    ], {
      allowedTypes: ['.pdf'],
      maxFileSize: 10,
    })

    expect(result.accepted.map((item) => item.name)).toEqual(['small.pdf'])
    expect(filesRejectedForReason(result.rejected, 'size').map((item) => item.name)).toEqual([
      'too-large.pdf',
      'also-too-large.pdf',
    ])
  })

  it('uses the extension when a browser omits a known MIME type', () => {
    const result = validateUploadFiles([
      file('portrait.jpeg', 1),
      file('diagram.png', 1),
    ], {
      allowedTypes: ['image/jpeg', 'image/png'],
    })

    expect(result.accepted.map((item) => item.name)).toEqual(['portrait.jpeg', 'diagram.png'])
    expect(result.rejected).toEqual([])
  })

  it('filters every file against the configured types', () => {
    const result = validateUploadFiles([
      file('proposal.pdf', 1, 'application/pdf'),
      file('script.exe', 1, 'application/octet-stream'),
      file('notes.txt', 1, 'text/plain'),
    ], {
      allowedTypes: ['.pdf', 'text/plain'],
    })

    expect(result.accepted.map((item) => item.name)).toEqual(['proposal.pdf', 'notes.txt'])
    expect(filesRejectedForReason(result.rejected, 'type').map((item) => item.name)).toEqual(['script.exe'])
  })

  it('keeps archive and custom academic document formats available', () => {
    const result = validateUploadFiles([
      file('sources.zip', 1, 'application/zip'),
      file('paper.tex', 1, 'application/x-tex'),
      file('bundle.7z', 1, 'application/x-7z-compressed'),
    ])

    expect(result.accepted.map((item) => item.name)).toEqual(['sources.zip', 'paper.tex', 'bundle.7z'])
    expect(result.rejected).toEqual([])
  })

  it('keeps explicit single-file surfaces single', () => {
    const result = validateUploadFiles([
      file('upgrade.zip', 1),
      file('second.zip', 1),
    ], {
      allowedTypes: ['.zip'],
      multiple: false,
    })

    expect(result.accepted.map((item) => item.name)).toEqual(['upgrade.zip'])
    expect(filesRejectedForReason(result.rejected, 'single').map((item) => item.name)).toEqual(['second.zip'])
  })

  it('enforces a per-batch count without replacing size validation', () => {
    const result = validateUploadFiles([
      file('one.pdf', 1),
      file('two.pdf', 1),
      file('oversize.pdf', 20),
    ], {
      allowedTypes: ['.pdf'],
      maxFileSize: 10,
      maxFiles: 2,
    })

    expect(result.accepted.map((item) => item.name)).toEqual(['one.pdf', 'two.pdf'])
    expect(filesRejectedForReason(result.rejected, 'size').map((item) => item.name)).toEqual(['oversize.pdf'])
  })
})
