/**
 * Keep object URLs alive long enough for installed-app and browser download
 * managers to take ownership of larger export blobs before releasing memory.
 */
export const DOWNLOAD_URL_REVOKE_DELAY_MS = 60_000

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()

  globalThis.setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_REVOKE_DELAY_MS)
}
