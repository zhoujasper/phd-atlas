import { describe, expect, it, vi } from 'vitest'
import {
  canonicalRegistrationEmail,
  claimSecurityChallengeAnswer,
  clientNetwork,
  issueSecurityChallenge,
  verifyTurnstileToken,
} from './antiAbuse.js'

describe('anti-abuse identities', () => {
  it('collapses Gmail dot and plus aliases without rewriting unrelated providers', () => {
    expect(canonicalRegistrationEmail('J.Asp.er+batch@GoogleMail.com')).toBe('jasper@gmail.com')
    expect(canonicalRegistrationEmail('student+lab@example.edu')).toBe('student+lab@example.edu')
  })

  it('masks IPv6 clients while keeping an exact IPv4 identity by default', () => {
    expect(clientNetwork('192.0.2.18')).toBe('192.0.2.18/32')
    expect(clientNetwork('2001:db8:abcd:12ff::5')).toBe('2001:db8:abcd:1200:0:0:0:0/56')
  })
})

describe('opaque challenges', () => {
  it('stores only digests and supports one-time answer verification', async () => {
    let stored
    const token = await issueSecurityChallenge({
      secret: 'test-secret',
      kind: 'test',
      subject: 'subject',
      answer: '123456',
      create: async (record) => { stored = { ...record } },
    })
    expect(token).not.toContain('123456')
    expect(stored.verifierHash).not.toContain('123456')

    let consumed = false
    const claim = async (candidate) => {
      const ok = !consumed
        && candidate.tokenHash === stored.tokenHash
        && candidate.subjectHash === stored.subjectHash
        && candidate.contextHash === stored.contextHash
        && candidate.verifierHash === stored.verifierHash
      if (ok) consumed = true
      return { ok }
    }
    await expect(claimSecurityChallengeAnswer({
      secret: 'test-secret',
      kind: 'test',
      subject: 'subject',
      token,
      answer: '123456',
      claim,
    })).resolves.toEqual({ ok: true })
    await expect(claimSecurityChallengeAnswer({
      secret: 'test-secret',
      kind: 'test',
      subject: 'subject',
      token,
      answer: '123456',
      claim,
    })).resolves.toEqual({ ok: false })
  })
})

describe('Turnstile verification', () => {
  it('requires provider success, action, and hostname to match', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      action: 'signup',
      hostname: 'phd.example.com',
    }), { status: 200 }))
    await expect(verifyTurnstileToken({
      token: 'token',
      secretKey: 'secret',
      remoteIp: '192.0.2.4',
      expectedAction: 'signup',
      expectedHostname: 'phd.example.com',
      fetchImpl,
    })).resolves.toEqual({ ok: true })
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(String(fetchImpl.mock.calls[0][1].body)).toContain('remoteip=192.0.2.4')
  })

  it('fails closed when a Turnstile response declares more than 64 KiB', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', {
      status: 200,
      headers: { 'content-length': String((64 * 1024) + 1) },
    }))

    await expect(verifyTurnstileToken({
      token: 'token',
      secretKey: 'secret',
      fetchImpl,
    })).resolves.toEqual({ ok: false, reason: 'provider-unavailable' })
  })
})
