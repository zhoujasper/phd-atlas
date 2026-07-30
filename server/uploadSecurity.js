import path from 'node:path'

const MAX_ARCHIVE_ENTRIES = 5_000
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 250 * 1024 * 1024
const MAX_ARCHIVE_ENTRY_BYTES = 100 * 1024 * 1024
const MAX_IMAGE_DIMENSION = 25_000
const MAX_IMAGE_PIXELS = 50_000_000
const ZIP_EOCD_SIGNATURE = 0x06054b50
const ZIP_CENTRAL_SIGNATURE = 0x02014b50
const ZIP_LOCAL_SIGNATURE = 0x04034b50
const INBOUND_VIRUS_TEST_MARKER = 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE'

const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif',
  '.doc', '.docx', '.rtf', '.txt', '.md', '.tex',
  '.xls', '.xlsx', '.csv', '.json',
  '.zip', '.rar', '.7z',
])

const DANGEROUS_INBOUND_EXTENSIONS = new Set([
  '.action', '.apk', '.app', '.application', '.appref-ms',
  '.bat', '.cmd', '.com', '.cpl',
  '.deb', '.desktop', '.dll', '.dmg',
  '.docm', '.dotm',
  '.exe',
  '.gadget',
  '.hta',
  '.inf', '.ins', '.iso', '.isp',
  '.jar', '.js', '.jse',
  '.lnk',
  '.mde', '.msc', '.msi', '.msp', '.mst',
  '.pif', '.potm', '.ppam', '.ppsm', '.pptm',
  '.ps1', '.ps1xml', '.ps2', '.ps2xml', '.psc1', '.psc2',
  '.reg', '.rpm',
  '.scf', '.scr', '.sct', '.sh', '.sldm', '.sys',
  '.url',
  '.vb', '.vbe', '.vbs',
  '.ws', '.wsc', '.wsf', '.wsh',
  '.xlam', '.xll', '.xlsm', '.xltm',
])

const DANGEROUS_INBOUND_MIME_TYPES = new Set([
  'application/java-archive',
  'application/javascript',
  'application/vnd.microsoft.portable-executable',
  'application/x-dosexec',
  'application/x-executable',
  'application/x-java-archive',
  'application/x-ms-shortcut',
  'application/x-msdownload',
  'application/x-sharedlib',
  'text/javascript',
])

function accepted() {
  return { ok: true }
}

function rejected(reason) {
  return { ok: false, reason }
}

function startsWithBytes(buffer, bytes) {
  return buffer.length >= bytes.length
    && bytes.every((value, index) => buffer[index] === value)
}

export function hasDangerousInboundAttachmentName(filename) {
  const normalized = String(filename ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[.\s]+$/u, '')
  return DANGEROUS_INBOUND_EXTENSIONS.has(path.extname(normalized))
}

export function hasDangerousInboundAttachmentMime(mimeType) {
  const normalized = String(mimeType ?? '').split(';')[0].trim().toLowerCase()
  return DANGEROUS_INBOUND_MIME_TYPES.has(normalized)
}

export function hasInboundVirusTestMarker(content) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content ?? '')
  return buffer.toString('latin1').includes(INBOUND_VIRUS_TEST_MARKER)
}

function safeImageDimensions(width, height) {
  return Number.isInteger(width)
    && Number.isInteger(height)
    && width > 0
    && height > 0
    && width <= MAX_IMAGE_DIMENSION
    && height <= MAX_IMAGE_DIMENSION
    && width * height <= MAX_IMAGE_PIXELS
}

function pngDimensions(buffer) {
  if (buffer.length < 24) return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function gifDimensions(buffer) {
  if (buffer.length < 10) return null
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
}

function jpegDimensions(buffer) {
  let offset = 2
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1
    const marker = buffer[offset]
    offset += 1
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > buffer.length) return null
    const segmentLength = buffer.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > buffer.length) return null
    if (
      [
        0xc0, 0xc1, 0xc2, 0xc3,
        0xc5, 0xc6, 0xc7,
        0xc9, 0xca, 0xcb,
        0xcd, 0xce, 0xcf,
      ].includes(marker)
    ) {
      if (segmentLength < 7) return null
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5),
      }
    }
    offset += segmentLength
  }
  return null
}

function readUInt24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16)
}

function webpDimensions(buffer) {
  if (buffer.length < 30) return null
  const chunk = buffer.toString('ascii', 12, 16)
  if (chunk === 'VP8X') {
    return {
      width: readUInt24LE(buffer, 24) + 1,
      height: readUInt24LE(buffer, 27) + 1,
    }
  }
  if (chunk === 'VP8 ' && buffer.toString('hex', 23, 26) === '9d012a') {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    }
  }
  if (chunk === 'VP8L' && buffer[20] === 0x2f && buffer.length >= 25) {
    return {
      width: 1 + buffer[21] + ((buffer[22] & 0x3f) << 8),
      height: 1 + ((buffer[22] & 0xc0) >> 6) + (buffer[23] << 2) + ((buffer[24] & 0x0f) << 10),
    }
  }
  return null
}

function validateImage(buffer, kind) {
  let dimensions
  if (kind === 'png') dimensions = pngDimensions(buffer)
  if (kind === 'gif') dimensions = gifDimensions(buffer)
  if (kind === 'jpeg') dimensions = jpegDimensions(buffer)
  if (kind === 'webp') dimensions = webpDimensions(buffer)
  return dimensions && safeImageDimensions(dimensions.width, dimensions.height)
    ? accepted()
    : rejected('invalid-or-oversized-image')
}

function isProbablyText(buffer) {
  if (buffer.length === 0) return true
  if (
    startsWithBytes(buffer, [0xff, 0xfe])
    || startsWithBytes(buffer, [0xfe, 0xff])
  ) {
    return true
  }
  let suspicious = 0
  for (const byte of buffer) {
    if (byte === 0) return false
    if (byte < 0x20 && ![0x09, 0x0a, 0x0c, 0x0d].includes(byte)) suspicious += 1
  }
  return suspicious <= Math.max(4, Math.floor(buffer.length / 100))
}

function findZipEndRecord(buffer) {
  const minimum = Math.max(0, buffer.length - 22 - 65_535)
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== ZIP_EOCD_SIGNATURE) continue
    const commentLength = buffer.readUInt16LE(offset + 20)
    if (offset + 22 + commentLength === buffer.length) return offset
  }
  return -1
}

function hasControlCharacter(value) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x1f || codePoint === 0x7f
  })
}

function safeArchivePath(value) {
  const normalized = String(value ?? '').replaceAll('\\', '/')
  if (
    !normalized
    || normalized.startsWith('/')
    || hasControlCharacter(normalized)
    || /^[a-z]:/i.test(normalized)
  ) {
    return ''
  }
  const parts = normalized.split('/').filter(Boolean)
  if (parts.some((part) => part === '.' || part === '..')) return ''
  return parts.join('/')
}

export function inspectZipArchive(buffer, expectedKind = 'zip') {
  try {
    if (
      buffer.length < 22
      || ![
        ZIP_LOCAL_SIGNATURE,
        ZIP_EOCD_SIGNATURE,
        0x08074b50,
      ].includes(buffer.readUInt32LE(0))
    ) {
      return rejected('invalid-zip-signature')
    }
    const endOffset = findZipEndRecord(buffer)
    if (endOffset < 0) return rejected('missing-zip-directory')

    const diskNumber = buffer.readUInt16LE(endOffset + 4)
    const directoryDisk = buffer.readUInt16LE(endOffset + 6)
    const diskEntries = buffer.readUInt16LE(endOffset + 8)
    const entryCount = buffer.readUInt16LE(endOffset + 10)
    const directorySize = buffer.readUInt32LE(endOffset + 12)
    const directoryOffset = buffer.readUInt32LE(endOffset + 16)
    if (
      diskNumber !== 0
      || directoryDisk !== 0
      || diskEntries !== entryCount
      || entryCount > MAX_ARCHIVE_ENTRIES
      || [entryCount, diskEntries].includes(0xffff)
      || [directorySize, directoryOffset].includes(0xffffffff)
      || directoryOffset + directorySize > endOffset
    ) {
      return rejected('unsupported-zip-directory')
    }

    let offset = directoryOffset
    let totalUncompressed = 0
    const names = new Set()
    const localOffsets = new Set()
    for (let index = 0; index < entryCount; index += 1) {
      if (offset + 46 > endOffset || buffer.readUInt32LE(offset) !== ZIP_CENTRAL_SIGNATURE) {
        return rejected('corrupt-zip-directory')
      }
      const flags = buffer.readUInt16LE(offset + 8)
      const method = buffer.readUInt16LE(offset + 10)
      const compressedSize = buffer.readUInt32LE(offset + 20)
      const uncompressedSize = buffer.readUInt32LE(offset + 24)
      const nameLength = buffer.readUInt16LE(offset + 28)
      const extraLength = buffer.readUInt16LE(offset + 30)
      const commentLength = buffer.readUInt16LE(offset + 32)
      const entryDisk = buffer.readUInt16LE(offset + 34)
      const localOffset = buffer.readUInt32LE(offset + 42)
      const nextOffset = offset + 46 + nameLength + extraLength + commentLength
      if (
        nextOffset > endOffset
        || entryDisk !== 0
        || (flags & 0x0001) !== 0
        || (flags & 0x0040) !== 0
        || ![0, 8].includes(method)
        || [compressedSize, uncompressedSize, localOffset].includes(0xffffffff)
        || uncompressedSize > MAX_ARCHIVE_ENTRY_BYTES
        || localOffset + 30 > directoryOffset
        || localOffsets.has(localOffset)
        || buffer.readUInt32LE(localOffset) !== ZIP_LOCAL_SIGNATURE
      ) {
        return rejected('unsafe-zip-entry')
      }
      localOffsets.add(localOffset)

      const localFlags = buffer.readUInt16LE(localOffset + 6)
      const localMethod = buffer.readUInt16LE(localOffset + 8)
      const localNameLength = buffer.readUInt16LE(localOffset + 26)
      const localExtraLength = buffer.readUInt16LE(localOffset + 28)
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength
      if (
        localMethod !== method
        || (localFlags & 0x0001) !== 0
        || dataOffset + compressedSize > directoryOffset
      ) {
        return rejected('corrupt-zip-entry')
      }

      const encoding = (flags & 0x0800) !== 0 ? 'utf8' : 'latin1'
      const name = safeArchivePath(buffer.toString(encoding, offset + 46, offset + 46 + nameLength))
      if (!name) return rejected('unsafe-zip-path')
      const normalizedName = name.toLowerCase()
      if (names.has(normalizedName)) return rejected('duplicate-zip-path')
      names.add(normalizedName)
      if (
        normalizedName === 'vbaproject.bin'
        || normalizedName.endsWith('/vbaproject.bin')
        || normalizedName.includes('/activex/')
      ) {
        return rejected('active-office-content')
      }

      totalUncompressed += uncompressedSize
      if (!Number.isSafeInteger(totalUncompressed) || totalUncompressed > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
        return rejected('oversized-zip-expansion')
      }
      offset = nextOffset
    }
    if (offset !== directoryOffset + directorySize) return rejected('corrupt-zip-directory-size')

    if (expectedKind === 'docx' && !(
      names.has('[content_types].xml')
      && names.has('word/document.xml')
    )) {
      return rejected('invalid-docx-package')
    }
    if (expectedKind === 'xlsx' && !(
      names.has('[content_types].xml')
      && names.has('xl/workbook.xml')
    )) {
      return rejected('invalid-xlsx-package')
    }
    if (expectedKind === 'pptx' && !(
      names.has('[content_types].xml')
      && names.has('ppt/presentation.xml')
    )) {
      return rejected('invalid-pptx-package')
    }
    if (expectedKind === 'ods' && !(
      names.has('mimetype')
      && names.has('content.xml')
    )) {
      return rejected('invalid-ods-package')
    }
    return accepted()
  } catch {
    return rejected('corrupt-zip')
  }
}

export function validateUploadContent({ buffer, filename }) {
  const content = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? '')
  const extension = path.extname(String(filename ?? '')).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(extension)) return rejected('unsupported-extension')

  if (extension === '.pdf') {
    return startsWithBytes(content, [0x25, 0x50, 0x44, 0x46, 0x2d])
      ? accepted()
      : rejected('invalid-pdf')
  }
  if (extension === '.jpg' || extension === '.jpeg') {
    if (!startsWithBytes(content, [0xff, 0xd8, 0xff])) return rejected('invalid-jpeg')
    return validateImage(content, 'jpeg')
  }
  if (extension === '.png') {
    if (!startsWithBytes(content, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
      return rejected('invalid-png')
    }
    return validateImage(content, 'png')
  }
  if (extension === '.gif') {
    const signature = content.toString('ascii', 0, 6)
    if (!['GIF87a', 'GIF89a'].includes(signature)) return rejected('invalid-gif')
    return validateImage(content, 'gif')
  }
  if (extension === '.webp') {
    if (
      content.length < 12
      || content.toString('ascii', 0, 4) !== 'RIFF'
      || content.toString('ascii', 8, 12) !== 'WEBP'
    ) {
      return rejected('invalid-webp')
    }
    return validateImage(content, 'webp')
  }
  if (extension === '.doc' || extension === '.xls') {
    return startsWithBytes(content, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
      ? accepted()
      : rejected('invalid-ole-document')
  }
  if (extension === '.docx') return inspectZipArchive(content, 'docx')
  if (extension === '.xlsx') return inspectZipArchive(content, 'xlsx')
  if (extension === '.zip') return inspectZipArchive(content, 'zip')
  if (extension === '.rar') {
    return (
      startsWithBytes(content, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00])
      || startsWithBytes(content, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00])
    ) ? accepted() : rejected('invalid-rar')
  }
  if (extension === '.7z') {
    return startsWithBytes(content, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])
      ? accepted()
      : rejected('invalid-7z')
  }
  if (extension === '.rtf') {
    const prefix = content.subarray(0, 32).toString('latin1').replace(/^\ufeff?\s*/, '')
    return prefix.startsWith('{\\rtf') ? accepted() : rejected('invalid-rtf')
  }
  return isProbablyText(content) ? accepted() : rejected('binary-text-file')
}

function safeSvgDocument(content) {
  const text = content.toString('utf8').replace(/^\uFEFF/u, '').trim()
  return text.length > 0
    && /<svg(?:\s|>)/iu.test(text.slice(0, 1_000))
    && !/<(?:script|foreignObject|iframe|object|embed)\b/iu.test(text)
    && !/\son[a-z]+\s*=/iu.test(text)
    && !/<!ENTITY|<\?xml-stylesheet/iu.test(text)
    && !/(?:href|src)\s*=\s*["']\s*(?!#|data:image\/)[^"']+["']/iu.test(text)
    && !/url\(\s*["']?(?!#)[^)]+\)/iu.test(text)
}

const MAIL_MIME_EXTENSION = new Map([
  ['application/pdf', '.pdf'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['image/bmp', '.bmp'],
  ['image/svg+xml', '.svg'],
  ['application/msword', '.doc'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  ['application/vnd.ms-excel', '.xls'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pptx'],
  ['application/vnd.oasis.opendocument.spreadsheet', '.ods'],
  ['application/rtf', '.rtf'],
  ['text/rtf', '.rtf'],
  ['application/zip', '.zip'],
  ['application/x-zip-compressed', '.zip'],
  ['application/vnd.rar', '.rar'],
  ['application/x-rar-compressed', '.rar'],
  ['application/x-7z-compressed', '.7z'],
])

/**
 * Mail can carry formats that the manual uploader does not advertise. Validate
 * every format the browser can actively decode; unknown formats remain
 * download-only and still pass the executable-extension/EICAR boundary.
 */
export function validateInboundAttachmentContent({ buffer, filename, mimeType }) {
  const content = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? '')
  if (hasDangerousInboundAttachmentName(filename)) return rejected('unsafe-executable-extension')
  if (hasDangerousInboundAttachmentMime(mimeType)) return rejected('unsafe-executable-mime')
  if (hasInboundVirusTestMarker(content)) return rejected('malware-test-marker')
  const extension = path.extname(String(filename ?? '')).toLowerCase()
  if (ALLOWED_EXTENSIONS.has(extension)) {
    return validateUploadContent({ buffer: content, filename })
  }
  if (extension === '.pptx') return inspectZipArchive(content, 'pptx')
  if (extension === '.ods') return inspectZipArchive(content, 'ods')
  if (extension === '.bmp') {
    if (!startsWithBytes(content, [0x42, 0x4d]) || content.length < 26) return rejected('invalid-bmp')
    return safeImageDimensions(
      Math.abs(content.readInt32LE(18)),
      Math.abs(content.readInt32LE(22)),
    ) ? accepted() : rejected('invalid-or-oversized-image')
  }
  if (extension === '.svg') {
    return safeSvgDocument(content) ? accepted() : rejected('unsafe-svg')
  }
  if (['.xml', '.yaml', '.yml', '.log'].includes(extension)) {
    return isProbablyText(content) ? accepted() : rejected('binary-text-file')
  }

  const normalizedMime = String(mimeType ?? '').split(';')[0].trim().toLowerCase()
  const inferredExtension = MAIL_MIME_EXTENSION.get(normalizedMime)
  if (inferredExtension) {
    return validateInboundAttachmentContent({
      buffer: content,
      filename: `attachment${inferredExtension}`,
      mimeType: '',
    })
  }
  if (normalizedMime.startsWith('text/')) {
    return isProbablyText(content) ? accepted() : rejected('binary-text-file')
  }
  return accepted()
}

export const uploadSecurityLimits = {
  maxArchiveEntries: MAX_ARCHIVE_ENTRIES,
  maxArchiveUncompressedBytes: MAX_ARCHIVE_UNCOMPRESSED_BYTES,
  maxArchiveEntryBytes: MAX_ARCHIVE_ENTRY_BYTES,
  maxImageDimension: MAX_IMAGE_DIMENSION,
  maxImagePixels: MAX_IMAGE_PIXELS,
}
