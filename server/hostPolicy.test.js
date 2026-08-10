import { describe, expect, it } from 'vitest'
import {
  configuredAllowedHosts,
  normalizeHttpHost,
  trustedQaLoopbackRequestHost,
  trustedRequestHost,
} from './hostPolicy.js'

describe('HTTP Host policy', () => {
  it('always derives a fail-closed production host from the canonical base URL', () => {
    const allowed = configuredAllowedHosts({
      baseUrl: 'https://PhD.Example.com:8443',
    })
    expect([...allowed]).toEqual(['phd.example.com:8443'])
    expect(trustedRequestHost('phd.example.com:8443', {
      production: true,
      allowedHosts: allowed,
    })).toBe('phd.example.com:8443')
    expect(trustedRequestHost('attacker.example', {
      production: true,
      allowedHosts: allowed,
    })).toBe('')
  })

  it('merges exact explicit hosts and CORS origins without wildcard matching', () => {
    const allowed = configuredAllowedHosts({
      allowedHosts: 'api.example.com, [2001:db8::5]:4317',
      baseUrl: 'https://app.example.com',
      corsOrigin: 'https://frontend.example.com,https://second.example.com',
    })
    expect(allowed).toEqual(new Set([
      'api.example.com',
      '[2001:db8::5]:4317',
      'app.example.com',
      'frontend.example.com',
      'second.example.com',
    ]))
    expect(trustedRequestHost('evil.api.example.com', {
      production: true,
      allowedHosts: allowed,
    })).toBe('')
  })

  it('rejects credential, path, control, and invalid-port syntax', () => {
    expect(normalizeHttpHost('user@example.com')).toBe('')
    expect(normalizeHttpHost('example.com/path')).toBe('')
    expect(normalizeHttpHost('example.com\r\nx: y')).toBe('')
    expect(normalizeHttpHost('example.com:99999')).toBe('')
  })

  it('allows an ephemeral Host port only across an explicitly enabled loopback QA listener', () => {
    expect(trustedQaLoopbackRequestHost('127.0.0.1:54321', {
      enabled: true,
      remoteAddress: '127.0.0.1',
      listenerAddress: '127.0.0.1',
    })).toBe('127.0.0.1:54321')
    expect(trustedQaLoopbackRequestHost('localhost:54321', {
      enabled: true,
      remoteAddress: '::ffff:127.0.0.1',
      listenerAddress: '127.0.0.1',
    })).toBe('localhost:54321')

    const common = {
      remoteAddress: '127.0.0.1',
      listenerAddress: '127.0.0.1',
    }
    expect(trustedQaLoopbackRequestHost('127.0.0.1:54321', common)).toBe('')
    expect(trustedQaLoopbackRequestHost('example.com:54321', { ...common, enabled: true })).toBe('')
    expect(trustedQaLoopbackRequestHost('127.0.0.1:54321', {
      ...common,
      enabled: true,
      remoteAddress: '203.0.113.10',
    })).toBe('')
    expect(trustedQaLoopbackRequestHost('127.0.0.1:54321', {
      ...common,
      enabled: true,
      listenerAddress: '0.0.0.0',
    })).toBe('')
  })
})
