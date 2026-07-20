type SnapshotPayload = {
  version: 2
  userId: string
  savedAt: string
  data: unknown
}

type SnapshotWorkerRequest = {
  id: number
  key: string
  userId: string
  secret: string
  payload: SnapshotPayload
}

function hexToBytes(hex: string) {
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < hex.length; index += 2) {
    bytes[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

globalThis.addEventListener('message', async (event: MessageEvent<SnapshotWorkerRequest>) => {
  const { id, key, userId, secret, payload } = event.data
  try {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      hexToBytes(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const message = JSON.stringify({ scope: 'snapshot', userId, payload })
    const digest = bytesToHex(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message)))
    const serialized = JSON.stringify({
      ...payload,
      integrity: {
        algorithm: 'hmac-sha256-json-v2',
        digest,
      },
    })
    globalThis.postMessage({ id, key, serialized })
  } catch (error) {
    globalThis.postMessage({
      id,
      key,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})

export {}
