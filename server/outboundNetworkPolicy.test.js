import { describe, expect, it, vi } from 'vitest'
import {
  isPublicNetworkAddress,
  normalizeNetworkHost,
  resolvePinnedNetworkTarget,
} from './outboundNetworkPolicy.js'

describe('outbound network policy', () => {
  it('accepts hostnames and IP literals but rejects URL and control syntax', () => {
    expect(normalizeNetworkHost(' Mail.Example.COM. ')).toBe('mail.example.com')
    expect(normalizeNetworkHost('[2001:4860:4860::8888]')).toBe('2001:4860:4860::8888')
    expect(normalizeNetworkHost('https://mail.example.com')).toBe('')
    expect(normalizeNetworkHost('user@mail.example.com')).toBe('')
    expect(normalizeNetworkHost('mail.example.com\r\nX-Test: yes')).toBe('')
  })

  it('classifies private, loopback, link-local, documentation, and multicast ranges as non-public', () => {
    for (const address of [
      '0.0.0.0',
      '10.0.0.1',
      '100.64.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '192.168.1.1',
      '198.51.100.2',
      '224.0.0.1',
      '::1',
      '64:ff9b::7f00:1',
      '2001:db8::1',
      'fc00::1',
      'fe80::1',
      'ff02::1',
    ]) {
      expect(isPublicNetworkAddress(address), address).toBe(false)
    }
    expect(isPublicNetworkAddress('8.8.8.8')).toBe(true)
    expect(isPublicNetworkAddress('2001:4860:4860::8888')).toBe(true)
  })

  it('validates every DNS answer and pins a public address while retaining TLS SNI', async () => {
    const lookup = vi.fn(async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '2001:4860:4860::8888', family: 6 },
    ])
    await expect(resolvePinnedNetworkTarget('mail.example.com', {
      enforcePublic: true,
      lookup,
    })).resolves.toEqual({
      address: '8.8.8.8',
      family: 4,
      host: 'mail.example.com',
      servername: 'mail.example.com',
      pinned: true,
    })
    expect(lookup).toHaveBeenCalledWith('mail.example.com', { all: true, verbatim: true })
  })

  it('rejects mixed public/private DNS answers and direct private targets', async () => {
    const lookup = vi.fn(async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ])
    await expect(resolvePinnedNetworkTarget('rebind.example.com', {
      enforcePublic: true,
      lookup,
    })).rejects.toMatchObject({ code: 'OUTBOUND_HOST_NOT_PUBLIC' })
    await expect(resolvePinnedNetworkTarget('169.254.169.254', {
      enforcePublic: true,
    })).rejects.toMatchObject({ code: 'OUTBOUND_HOST_NOT_PUBLIC' })
  })

  it('allows an operator-authorized private mail host by exact normalized name', async () => {
    await expect(resolvePinnedNetworkTarget('Internal-Mail.example', {
      enforcePublic: true,
      privateHostAllowlist: 'internal-mail.example',
      lookup: async () => [{ address: '10.20.30.40', family: 4 }],
    })).resolves.toMatchObject({
      address: '10.20.30.40',
      host: 'internal-mail.example',
      servername: 'internal-mail.example',
      pinned: true,
    })
  })

  it('keeps local development usable without performing a second DNS lookup', async () => {
    const lookup = vi.fn()
    await expect(resolvePinnedNetworkTarget('localhost', {
      enforcePublic: false,
      lookup,
    })).resolves.toMatchObject({
      address: 'localhost',
      host: 'localhost',
      servername: 'localhost',
      pinned: false,
    })
    expect(lookup).not.toHaveBeenCalled()
  })
})
