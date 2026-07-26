export const TEAM_LOGO_MAX_FILE_BYTES = 10 * 1024 * 1024
export const TEAM_LOGO_ACCEPT = [
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

const TEAM_LOGO_MAX_WIDTH = 1024
const TEAM_LOGO_MAX_HEIGHT = 512
const TEAM_LOGO_MAX_DATA_URL_LENGTH = 560_000
const TEAM_LOGO_MAX_SOURCE_DIMENSION = 16_384
const TEAM_LOGO_MAX_SOURCE_PIXELS = 40_000_000
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const
const GIF_87A_SIGNATURE = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] as const
const GIF_89A_SIGNATURE = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] as const

const TEAM_LOGO_MIME_ALIASES = new Map([
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

const TEAM_LOGO_EXTENSION_TYPES = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['webp', 'image/webp'],
  ['avif', 'image/avif'],
  ['bmp', 'image/bmp'],
  ['svg', 'image/svg+xml'],
  ['ico', 'image/x-icon'],
])

export type TeamLogoErrorReason = 'file-type' | 'file-size' | 'invalid-image'

export class TeamLogoError extends Error {
  readonly reason: TeamLogoErrorReason

  constructor(reason: TeamLogoErrorReason) {
    super(reason)
    this.name = 'TeamLogoError'
    this.reason = reason
  }
}

export function hasGifSignature(buffer: ArrayBuffer) {
  if (buffer.byteLength < GIF_87A_SIGNATURE.length) return false
  const bytes = new Uint8Array(buffer)
  return [GIF_87A_SIGNATURE, GIF_89A_SIGNATURE].some((signature) => (
    signature.every((value, index) => bytes[index] === value)
  ))
}

export function resolveTeamLogoMimeType(fileName: string, declaredType: string) {
  const normalizedDeclaredType = declaredType.trim().toLowerCase()
  const extension = fileName.trim().toLowerCase().match(/\.([^.]+)$/)?.[1] ?? ''

  if (normalizedDeclaredType === 'image/gif' || extension === 'gif') return null

  return TEAM_LOGO_MIME_ALIASES.get(normalizedDeclaredType)
    ?? TEAM_LOGO_EXTENSION_TYPES.get(extension)
    ?? null
}

export function readTeamLogoPngDimensions(buffer: ArrayBuffer) {
  if (buffer.byteLength < 24) return null
  const bytes = new Uint8Array(buffer)
  if (PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) return null
  if (
    bytes[12] !== 0x49
    || bytes[13] !== 0x48
    || bytes[14] !== 0x44
    || bytes[15] !== 0x52
  ) return null

  const view = new DataView(buffer)
  if (view.getUint32(8) !== 13) return null
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  if (width < 1 || height < 1) return null
  return { width, height }
}

export function fitTeamLogoDimensions(
  width: number,
  height: number,
  maxWidth = TEAM_LOGO_MAX_WIDTH,
  maxHeight = TEAM_LOGO_MAX_HEIGHT,
) {
  if (
    !Number.isFinite(width)
    || !Number.isFinite(height)
    || width <= 0
    || height <= 0
  ) return { width: 1, height: 1 }

  const scale = Math.min(1, maxWidth / width, maxHeight / height)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function readFileAsDataUrl(file: File, mimeType: string) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new TeamLogoError('invalid-image'))
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.readAsDataURL(file.slice(0, file.size, mimeType))
  })
}

function decodeImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new TeamLogoError('invalid-image'))
    image.src = source
  })
}

function renderLogoPng(image: HTMLImageElement, width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new TeamLogoError('invalid-image')
  context.clearRect(0, 0, width, height)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0, width, height)
  return canvas.toDataURL('image/png')
}

export async function normalizeTeamLogoFile(file: File) {
  if (!file.size || file.size > TEAM_LOGO_MAX_FILE_BYTES) {
    throw new TeamLogoError('file-size')
  }

  const mimeType = resolveTeamLogoMimeType(file.name, file.type)
  if (!mimeType) throw new TeamLogoError('file-type')

  const header = await file.slice(0, 24).arrayBuffer()
  if (hasGifSignature(header)) throw new TeamLogoError('file-type')

  if (mimeType === 'image/png') {
    const dimensions = readTeamLogoPngDimensions(header)
    if (!dimensions) throw new TeamLogoError('file-type')
    if (
      dimensions.width > TEAM_LOGO_MAX_SOURCE_DIMENSION
      || dimensions.height > TEAM_LOGO_MAX_SOURCE_DIMENSION
      || dimensions.width * dimensions.height > TEAM_LOGO_MAX_SOURCE_PIXELS
    ) {
      throw new TeamLogoError('file-size')
    }
  }

  const image = await decodeImage(await readFileAsDataUrl(file, mimeType))
  if (!image.naturalWidth || !image.naturalHeight) {
    throw new TeamLogoError('invalid-image')
  }
  if (
    image.naturalWidth > TEAM_LOGO_MAX_SOURCE_DIMENSION
    || image.naturalHeight > TEAM_LOGO_MAX_SOURCE_DIMENSION
    || image.naturalWidth * image.naturalHeight > TEAM_LOGO_MAX_SOURCE_PIXELS
  ) {
    throw new TeamLogoError('file-size')
  }

  const fitted = fitTeamLogoDimensions(image.naturalWidth, image.naturalHeight)
  const initialScale = Math.min(
    fitted.width / image.naturalWidth,
    fitted.height / image.naturalHeight,
  )

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const scale = initialScale * (0.78 ** attempt)
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))
    const dataUrl = renderLogoPng(image, width, height)
    if (
      dataUrl.startsWith('data:image/png;base64,')
      && dataUrl.length <= TEAM_LOGO_MAX_DATA_URL_LENGTH
    ) {
      return dataUrl
    }
  }

  throw new TeamLogoError('file-size')
}
