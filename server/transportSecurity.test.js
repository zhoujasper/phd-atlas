import { randomBytes } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { describe, expect, it } from 'vitest'
import {
  hasVerifiedSessionBearer,
  isHttpsRequest,
  requestBodyAdmissionKey,
  verifiedSessionBearerSubject,
} from './index.js'

describe('transport and pre-authentication security boundaries', () => {
  it('uses Express secure state and ignores a raw forwarded-proto header', () => {
    expect(isHttpsRequest({ secure: false, get: () => 'https' })).toBe(false)
    expect(isHttpsRequest({ secure: true, get: () => 'http' })).toBe(true)
  })

  it('does not widen anonymous network limits for malformed, expired, or wrongly scoped Bearer text', () => {
    const secret = randomBytes(48).toString('base64url')
    const valid = jwt.sign(
      { scope: 'app', authVersion: 0 },
      secret,
      {
        algorithm: 'HS256',
        issuer: 'phd-atlas',
        audience: 'phd-atlas-api',
        subject: 'test-user',
        expiresIn: '5m',
      },
    )
    const expired = jwt.sign(
      { scope: 'app', authVersion: 0 },
      secret,
      {
        algorithm: 'HS256',
        issuer: 'phd-atlas',
        audience: 'phd-atlas-api',
        subject: 'test-user',
        expiresIn: -1,
      },
    )
    const wrongAudience = jwt.sign(
      { scope: 'app', authVersion: 0 },
      secret,
      {
        algorithm: 'HS256',
        issuer: 'phd-atlas',
        audience: 'not-the-api',
        subject: 'test-user',
        expiresIn: '5m',
      },
    )
    const wrongSessionScope = jwt.sign(
      { scope: 'password-reset', authVersion: 0 },
      secret,
      {
        algorithm: 'HS256',
        issuer: 'phd-atlas',
        audience: 'phd-atlas-api',
        subject: 'test-user',
        expiresIn: '5m',
      },
    )
    const missingSubject = jwt.sign(
      { scope: 'app', authVersion: 0 },
      secret,
      {
        algorithm: 'HS256',
        issuer: 'phd-atlas',
        audience: 'phd-atlas-api',
        expiresIn: '5m',
      },
    )

    expect(hasVerifiedSessionBearer(`Bearer ${valid}`, secret)).toBe(true)
    expect(hasVerifiedSessionBearer('Bearer not-a-jwt', secret)).toBe(false)
    expect(hasVerifiedSessionBearer(`Bearer ${expired}`, secret)).toBe(false)
    expect(hasVerifiedSessionBearer(`Bearer ${wrongAudience}`, secret)).toBe(false)
    expect(hasVerifiedSessionBearer(`Bearer ${wrongSessionScope}`, secret)).toBe(false)
    expect(hasVerifiedSessionBearer(`Bearer ${missingSubject}`, secret)).toBe(false)
    expect(hasVerifiedSessionBearer('Basic ignored', secret)).toBe(false)
  })

  it('separates valid session principals behind one NAT without trusting forged bearer text', () => {
    const secret = randomBytes(48).toString('base64url')
    const sign = (subject, extraClaims = {}) => jwt.sign(
      { scope: 'app', authVersion: 0, ...extraClaims },
      secret,
      {
        algorithm: 'HS256',
        issuer: 'phd-atlas',
        audience: 'phd-atlas-api',
        subject,
        expiresIn: '5m',
      },
    )
    const userA = sign('user-a')
    const userB = sign('user-b')
    const impersonated = sign('student-a', { act: { sub: 'admin-a' } })

    expect(verifiedSessionBearerSubject(`Bearer ${userA}`, secret)).toBe('user-a')
    expect(verifiedSessionBearerSubject(`Bearer ${impersonated}`, secret)).toBe('admin-a')
    expect(verifiedSessionBearerSubject('Bearer invented', secret)).toBe('')

    const request = (authorization, ip) => ({
      get: (name) => name === 'authorization' ? authorization : undefined,
      ip,
      socket: { remoteAddress: ip },
    })
    const sameNat = '203.0.113.20'
    expect(requestBodyAdmissionKey(request(`Bearer ${userA}`, sameNat), secret))
      .toBe('session:user-a')
    expect(requestBodyAdmissionKey(request(`Bearer ${userB}`, sameNat), secret))
      .toBe('session:user-b')
    expect(requestBodyAdmissionKey(request('Bearer invented', sameNat), secret))
      .toBe(`network:${sameNat}/32`)
  })
})
