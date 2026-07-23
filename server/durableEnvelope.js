import { Buffer } from 'node:buffer'
import { decryptSecretWithProfile, encryptSecretWithProfile } from './crypto.js'

export const EXTERNAL_STATE_MAGIC = Buffer.from('PHDSTATE1\n', 'utf8')
export const BACKUP_ENVELOPE_MAGIC = Buffer.from('PHDBACKUP1\n', 'utf8')

export function encodeDurableEnvelope(payload, magic, policy) {
  const plain = Buffer.isBuffer(payload) ? payload : Buffer.from(payload ?? '')
  if (!policy?.encryptionAtRest) return plain
  const algorithm = String(policy.encryptionAlgorithm || 'aes-256-gcm')
  const passwordBinding = String(policy.passwordBinding || '')
  const ciphertext = encryptSecretWithProfile(plain.toString('base64'), { algorithm, passwordBinding })
  return Buffer.concat([
    magic,
    Buffer.from(JSON.stringify({ version: 1, algorithm, passwordBinding, ciphertext }), 'utf8'),
  ])
}

export function decodeDurableEnvelope(payload, magic, label) {
  const source = Buffer.isBuffer(payload) ? payload : Buffer.from(payload ?? '')
  if (!source.subarray(0, magic.length).equals(magic)) {
    return { plain: source, encrypted: false, profile: null }
  }
  let envelope
  try {
    envelope = JSON.parse(source.subarray(magic.length).toString('utf8'))
  } catch {
    throw new Error(`Encrypted ${label} has an invalid envelope.`)
  }
  const profile = {
    algorithm: String(envelope.algorithm || 'aes-256-gcm'),
    passwordBinding: String(envelope.passwordBinding || ''),
  }
  const plain = decryptSecretWithProfile(String(envelope.ciphertext || ''), profile)
  if (!plain) throw new Error(`Encrypted ${label} could not be authenticated.`)
  return { plain: Buffer.from(plain, 'base64'), encrypted: true, profile }
}

export function encodeExternalStatePayload(payload, policy) {
  return encodeDurableEnvelope(payload, EXTERNAL_STATE_MAGIC, policy)
}

export function decodeExternalStatePayload(payload) {
  return decodeDurableEnvelope(payload, EXTERNAL_STATE_MAGIC, 'external database state').plain
}

export function encodeBackupPayload(payload, policy) {
  return encodeDurableEnvelope(payload, BACKUP_ENVELOPE_MAGIC, policy)
}

export function decodeBackupPayload(payload) {
  return decodeDurableEnvelope(payload, BACKUP_ENVELOPE_MAGIC, 'backup')
}
