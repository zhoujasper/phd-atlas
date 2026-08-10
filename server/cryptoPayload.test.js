import { describe, expect, it } from 'vitest'
import {
  decryptPayload,
  encryptPayload,
  runtimeCryptoDiagnostics,
  setRuntimeCryptoConfig,
} from './crypto.js'

describe('large payload crypto', () => {
  it.each(['aes-256-gcm', 'chacha20-poly1305'])(
    'round-trips bounded UTF-8 JSON directly through base64 with %s',
    (algorithm) => {
      setRuntimeCryptoConfig({ algorithm })
      const source = JSON.stringify({
        marker: 'large-crypto-payload',
        ascii: 'x'.repeat((2 * 1024 * 1024) + 17),
        unicode: '导师申请😀'.repeat(1024),
      })
      const encrypted = encryptPayload(source)
      expect(decryptPayload(encrypted)).toBe(source)
      const damaged = `${encrypted.slice(0, -4)}AAAA`
      expect(decryptPayload(damaged)).toBe(damaged)
    },
  )

  it('reuses the derived key when storage reapplies an unchanged policy', () => {
    const passwordBinding = `stable-runtime-profile-${Date.now()}`
    setRuntimeCryptoConfig({ algorithm: 'aes-256-gcm', passwordBinding })
    const configured = runtimeCryptoDiagnostics()
    const ciphertext = encryptPayload('{"policy":"stable"}')

    setRuntimeCryptoConfig({ algorithm: 'aes-256-gcm', passwordBinding })
    setRuntimeCryptoConfig({ algorithm: 'aes-256-gcm', passwordBinding })

    const reused = runtimeCryptoDiagnostics()
    expect(reused.keyDerivations).toBe(configured.keyDerivations)
    expect(reused.profileChanges).toBe(configured.profileChanges)
    expect(reused.reusedConfigurations).toBe(configured.reusedConfigurations + 2)
    expect(decryptPayload(ciphertext)).toBe('{"policy":"stable"}')
    setRuntimeCryptoConfig({})
  })
})
