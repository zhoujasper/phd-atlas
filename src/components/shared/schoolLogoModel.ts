/** Browser-side normalization and fallback helpers for persisted school logos. */
export const SCHOOL_LOGO_MAX_FILE_BYTES = 10 * 1024 * 1024
export const SCHOOL_LOGO_ACCEPT = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.avif',
  '.bmp',
  '.svg',
  '.ico',
].join(',')

const SCHOOL_LOGO_MAX_WIDTH = 512
const SCHOOL_LOGO_MAX_HEIGHT = 256
const SCHOOL_LOGO_MAX_DATA_URL_LENGTH = 250_000
const SCHOOL_LOGO_MAX_SOURCE_DIMENSION = 16_384
const SCHOOL_LOGO_MAX_SOURCE_PIXELS = 40_000_000
const GIF_87A_SIGNATURE = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] as const
const GIF_89A_SIGNATURE = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] as const

const MIME_ALIASES = new Map([
  ['image/png', 'image/png'],
  ['image/jpeg', 'image/jpeg'],
  ['image/jpg', 'image/jpeg'],
  ['image/pjpeg', 'image/jpeg'],
  ['image/webp', 'image/webp'],
  ['image/avif', 'image/avif'],
  ['image/bmp', 'image/bmp'],
  ['image/x-bmp', 'image/bmp'],
  ['image/x-ms-bmp', 'image/bmp'],
  ['image/svg+xml', 'image/svg+xml'],
  ['image/x-icon', 'image/x-icon'],
  ['image/vnd.microsoft.icon', 'image/x-icon'],
])

const EXTENSION_TYPES = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['webp', 'image/webp'],
  ['avif', 'image/avif'],
  ['bmp', 'image/bmp'],
  ['svg', 'image/svg+xml'],
  ['ico', 'image/x-icon'],
])

export type SchoolLogoErrorReason = 'file-type' | 'file-size' | 'invalid-image'

export class SchoolLogoError extends Error {
  readonly reason: SchoolLogoErrorReason

  constructor(reason: SchoolLogoErrorReason) {
    super(reason)
    this.name = 'SchoolLogoError'
    this.reason = reason
  }
}

export function schoolLogoInitials(schoolName: string) {
  const words = schoolName
    .trim()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .filter((word) => !['of', 'the', 'and', 'for'].includes(word.toLowerCase()))
  if (words.length === 0) return 'U'
  if (words.length === 1) return Array.from(words[0]).slice(0, 2).join('').toUpperCase()
  return `${Array.from(words[0])[0] ?? ''}${Array.from(words[words.length - 1])[0] ?? ''}`.toUpperCase()
}

export function resolveSchoolLogoMimeType(fileName: string, declaredType: string) {
  const normalizedDeclaredType = declaredType.trim().toLowerCase()
  const extension = fileName.trim().toLowerCase().match(/\.([^.]+)$/)?.[1] ?? ''
  if (normalizedDeclaredType === 'image/gif' || extension === 'gif') return null
  return MIME_ALIASES.get(normalizedDeclaredType)
    ?? EXTENSION_TYPES.get(extension)
    ?? null
}

export function hasSchoolLogoGifSignature(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  return [GIF_87A_SIGNATURE, GIF_89A_SIGNATURE].some((signature) => (
    bytes.length >= signature.length
    && signature.every((value, index) => bytes[index] === value)
  ))
}

export function fitSchoolLogoDimensions(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 1, height: 1 }
  }
  const scale = Math.min(1, SCHOOL_LOGO_MAX_WIDTH / width, SCHOOL_LOGO_MAX_HEIGHT / height)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function decodeImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const source = URL.createObjectURL(file)
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      URL.revokeObjectURL(source)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(source)
      reject(new SchoolLogoError('invalid-image'))
    }
    image.src = source
  })
}

function renderLogoPng(image: HTMLImageElement, width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new SchoolLogoError('invalid-image')
  context.clearRect(0, 0, width, height)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0, width, height)
  try {
    return canvas.toDataURL('image/png')
  } catch {
    throw new SchoolLogoError('invalid-image')
  }
}

export async function normalizeSchoolLogoFile(file: File) {
  if (!file.size || file.size > SCHOOL_LOGO_MAX_FILE_BYTES) {
    throw new SchoolLogoError('file-size')
  }
  const mimeType = resolveSchoolLogoMimeType(file.name, file.type)
  if (!mimeType) throw new SchoolLogoError('file-type')
  if (hasSchoolLogoGifSignature(await file.slice(0, 8).arrayBuffer())) {
    throw new SchoolLogoError('file-type')
  }

  try {
    const image = await decodeImage(file.slice(0, file.size, mimeType) as File)
    if (!image.naturalWidth || !image.naturalHeight) {
      throw new SchoolLogoError('invalid-image')
    }
    if (
      image.naturalWidth > SCHOOL_LOGO_MAX_SOURCE_DIMENSION
      || image.naturalHeight > SCHOOL_LOGO_MAX_SOURCE_DIMENSION
      || image.naturalWidth * image.naturalHeight > SCHOOL_LOGO_MAX_SOURCE_PIXELS
    ) {
      throw new SchoolLogoError('file-size')
    }

    const fitted = fitSchoolLogoDimensions(image.naturalWidth, image.naturalHeight)
    const initialScale = Math.min(
      fitted.width / image.naturalWidth,
      fitted.height / image.naturalHeight,
    )
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const scale = initialScale * (0.8 ** attempt)
      const width = Math.max(1, Math.round(image.naturalWidth * scale))
      const height = Math.max(1, Math.round(image.naturalHeight * scale))
      const dataUrl = renderLogoPng(image, width, height)
      if (
        dataUrl.startsWith('data:image/png;base64,')
        && dataUrl.length <= SCHOOL_LOGO_MAX_DATA_URL_LENGTH
      ) {
        return dataUrl
      }
    }
  } catch (error) {
    if (error instanceof SchoolLogoError) throw error
    throw new SchoolLogoError('invalid-image')
  }

  throw new SchoolLogoError('file-size')
}

export function schoolLogoFileFromDataUrl(dataUrl: string, fileName = 'school-logo') {
  const match = String(dataUrl || '').match(/^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/u)
  if (!match) throw new SchoolLogoError('invalid-image')
  const mimeType = String(match[1] || '').toLowerCase()
  if (!MIME_ALIASES.has(mimeType)) throw new SchoolLogoError('file-type')
  let bytes: Uint8Array
  try {
    const binary = atob(match[2])
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    throw new SchoolLogoError('invalid-image')
  }
  const extension = mimeType === 'image/svg+xml'
    ? 'svg'
    : mimeType === 'image/x-icon' || mimeType === 'image/vnd.microsoft.icon'
      ? 'ico'
      : mimeType.split('/')[1] || 'img'
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return new File([buffer], `${fileName}.${extension}`, { type: mimeType })
}

export async function normalizeRemoteSchoolLogoDataUrl(dataUrl: string) {
  return normalizeSchoolLogoFile(schoolLogoFileFromDataUrl(dataUrl))
}
