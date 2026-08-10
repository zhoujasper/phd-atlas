import {
  decryptSecretWithProfile,
  encryptSecretWithProfile,
  isEncryptedPayload,
} from './crypto.js'
import { parentPort } from 'node:worker_threads'

const PAYLOAD_PREFIX = 'payload:'

function toJson(value) {
  return typeof value === 'string' ? value : JSON.stringify(value ?? {})
}

function fromJson(value) {
  if (!value) return {}
  return JSON.parse(value)
}

function encryptPayloadWithProfile(plaintext, profile = {}) {
  if (!plaintext) return ''
  return PAYLOAD_PREFIX + encryptSecretWithProfile(plaintext, {
    algorithm: profile.algorithm,
    passwordBinding: profile.passwordBinding,
  })
}

function decryptPayloadWithProfile(value, profile = {}) {
  if (!value) return ''
  if (!value.startsWith(PAYLOAD_PREFIX)) return value
  return decryptSecretWithProfile(value.slice(PAYLOAD_PREFIX.length), {
    algorithm: profile.algorithm,
    passwordBinding: profile.passwordBinding,
  })
}

function encode(value, policy = {}) {
  const json = toJson(value)
  if (!policy.encryptionAtRest) {
    if (isEncryptedPayload(json)) return decryptPayloadWithProfile(json, policy)
    return json
  }
  if (isEncryptedPayload(json)) return json
  return encryptPayloadWithProfile(json, policy)
}

function decode(value) {
  if (!value) return {}
  const plain = isEncryptedPayload(value)
    ? decryptPayloadWithProfile(value, {})
    : value
  return fromJson(plain)
}

parentPort.on('message', (message) => {
  try {
    const result = message.operation === 'encode'
      ? encode(message.value, message.policy)
      : decode(message.value)
    parentPort.postMessage({ id: message.id, result })
  } catch (error) {
    parentPort.postMessage({
      id: message.id,
      error: {
        message: String(error?.message ?? error).slice(0, 4_096),
        code: error?.code ?? 'PAYLOAD_WORKER_FAILED',
      },
    })
  }
})
