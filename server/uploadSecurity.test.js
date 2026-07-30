import { describe, expect, it } from 'vitest'
import {
  inspectZipArchive,
  validateInboundAttachmentContent,
  validateUploadContent,
} from './uploadSecurity.js'

function zipBuffer(entries) {
  const localParts = []
  const centralParts = []
  let localOffset = 0
  for (const { name, content = Buffer.alloc(0), flags = 0, method = 0, declaredSize } of entries) {
    const nameBuffer = Buffer.from(name)
    const body = Buffer.from(content)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(declaredSize ?? body.length, 22)
    local.writeUInt16LE(nameBuffer.length, 26)
    const localRecord = Buffer.concat([local, nameBuffer, body])
    localParts.push(localRecord)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(declaredSize ?? body.length, 24)
    central.writeUInt16LE(nameBuffer.length, 28)
    central.writeUInt32LE(localOffset, 42)
    centralParts.push(Buffer.concat([central, nameBuffer]))
    localOffset += localRecord.length
  }
  const directory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(localOffset, 16)
  return Buffer.concat([...localParts, directory, end])
}

describe('upload content validation', () => {
  it('requires exact signatures for binary formats instead of trusting MIME metadata', () => {
    expect(validateUploadContent({
      filename: 'proposal.pdf',
      buffer: Buffer.from('%PDF-1.7\n'),
    })).toEqual({ ok: true })
    expect(validateUploadContent({
      filename: 'proposal.pdf',
      buffer: Buffer.from('<html>not a pdf</html>'),
    })).toMatchObject({ ok: false, reason: 'invalid-pdf' })
    expect(validateUploadContent({
      filename: 'archive.7z',
      buffer: Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]),
    })).toEqual({ ok: true })
  })

  it('rejects implausibly large image dimensions before browser preview decoding', () => {
    const png = Buffer.alloc(24)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png)
    png.writeUInt32BE(100_000, 16)
    png.writeUInt32BE(100_000, 20)
    expect(validateUploadContent({ filename: 'pixel-bomb.png', buffer: png }))
      .toMatchObject({ ok: false, reason: 'invalid-or-oversized-image' })
  })

  it('accepts structurally identified Office packages', () => {
    const docx = zipBuffer([
      { name: '[Content_Types].xml', content: '<Types />' },
      { name: 'word/document.xml', content: '<document />' },
    ])
    const xlsx = zipBuffer([
      { name: '[Content_Types].xml', content: '<Types />' },
      { name: 'xl/workbook.xml', content: '<workbook />' },
    ])
    expect(validateUploadContent({ filename: 'cv.docx', buffer: docx })).toEqual({ ok: true })
    expect(validateUploadContent({ filename: 'tracking.xlsx', buffer: xlsx })).toEqual({ ok: true })
    expect(validateUploadContent({ filename: 'renamed.docx', buffer: xlsx }))
      .toMatchObject({ ok: false, reason: 'invalid-docx-package' })
  })

  it('rejects traversal, encryption, active content, and excessive declared expansion in ZIP containers', () => {
    expect(inspectZipArchive(zipBuffer([{ name: '../escape.txt', content: 'x' }])))
      .toMatchObject({ ok: false, reason: 'unsafe-zip-path' })
    expect(inspectZipArchive(zipBuffer([{ name: 'secret.txt', content: 'x', flags: 1 }])))
      .toMatchObject({ ok: false, reason: 'unsafe-zip-entry' })
    expect(inspectZipArchive(zipBuffer([
      { name: '[Content_Types].xml', content: '<Types />' },
      { name: 'word/document.xml', content: '<document />' },
      { name: 'word/vbaProject.bin', content: 'macro' },
    ]), 'docx')).toMatchObject({ ok: false, reason: 'active-office-content' })
    expect(inspectZipArchive(zipBuffer([{
      name: 'huge.txt',
      content: 'x',
      declaredSize: 101 * 1024 * 1024,
    }]))).toMatchObject({ ok: false, reason: 'unsafe-zip-entry' })
  })

  it('rejects binary files disguised as text while allowing ordinary UTF-8 documents', () => {
    expect(validateUploadContent({ filename: 'notes.md', buffer: Buffer.from('# Notes\nSafe text') }))
      .toEqual({ ok: true })
    expect(validateUploadContent({ filename: 'notes.txt', buffer: Buffer.from([0, 1, 2, 3, 4]) }))
      .toMatchObject({ ok: false, reason: 'binary-text-file' })
  })

  it('applies active-preview validation to inbound email attachments', () => {
    const pptx = zipBuffer([
      { name: '[Content_Types].xml', content: '<Types />' },
      { name: 'ppt/presentation.xml', content: '<presentation />' },
    ])
    expect(validateInboundAttachmentContent({
      filename: 'slides.pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      buffer: pptx,
    })).toEqual({ ok: true })
    expect(validateInboundAttachmentContent({
      filename: 'diagram.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg><script>alert(1)</script></svg>'),
    })).toMatchObject({ ok: false, reason: 'unsafe-svg' })
    expect(validateInboundAttachmentContent({
      filename: 'unknown',
      mimeType: 'application/pdf',
      buffer: Buffer.from('<html>renamed</html>'),
    })).toMatchObject({ ok: false, reason: 'invalid-pdf' })
  })

  it('blocks executable, shortcut, script, macro, MIME-spoofed, and antivirus-test mail attachments', () => {
    for (const filename of ['installer.exe', 'shortcut.lnk', 'script.js', 'proposal.docm']) {
      expect(validateInboundAttachmentContent({
        filename,
        mimeType: 'application/octet-stream',
        buffer: Buffer.from('payload'),
      })).toMatchObject({ ok: false, reason: 'unsafe-executable-extension' })
    }
    expect(validateInboundAttachmentContent({
      filename: 'attachment',
      mimeType: 'application/x-msdownload',
      buffer: Buffer.from('payload'),
    })).toMatchObject({ ok: false, reason: 'unsafe-executable-mime' })
    expect(validateInboundAttachmentContent({
      filename: 'note.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE'),
    })).toMatchObject({ ok: false, reason: 'malware-test-marker' })
  })
})
