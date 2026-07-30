import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import net from 'node:net'
import { withAbortDeadline } from './abortDeadline.js'

const DEFAULT_ALIAS_DOMAINS = new Set(['gmail.com', 'googlemail.com'])

function envList(value) {
  return new Set(
    String(value ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  )
}

function normalizeIp(value) {
  return String(value ?? '')
    .trim()
    .replace(/^\[|\]$/g, '')
    .split('%')[0]
    .replace(/^::ffff:/i, '')
}

function expandIpv6(value) {
  let address = normalizeIp(value).toLowerCase()
  const embeddedIpv4 = address.match(/(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1]
  if (embeddedIpv4) {
    const parts = embeddedIpv4.split('.').map(Number)
    if (parts.some((part) => part < 0 || part > 255)) return null
    address = address.slice(0, -embeddedIpv4.length)
      + ((parts[0] << 8) | parts[1]).toString(16)
      + ':'
      + ((parts[2] << 8) | parts[3]).toString(16)
  }
  const split = address.split('::')
  if (split.length > 2) return null
  const left = split[0] ? split[0].split(':') : []
  const right = split[1] ? split[1].split(':') : []
  const missing = 8 - left.length - right.length
  if ((split.length === 1 && missing !== 0) || missing < 0) return null
  const parts = [...left, ...Array(missing).fill('0'), ...right]
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null
  return parts.map((part) => Number.parseInt(part, 16))
}

export function clientAddress(value) {
  const normalized = normalizeIp(value)
  if (net.isIP(normalized)) return normalized.toLowerCase()
  return 'unknown'
}

export function clientNetwork(value, options = {}) {
  const address = clientAddress(value)
  const version = net.isIP(address)
  if (version === 4) {
    const prefix = Math.max(8, Math.min(32, Number(options.ipv4Prefix ?? 32)))
    const octets = address.split('.').map(Number)
    let remaining = prefix
    const masked = octets.map((octet) => {
      const bits = Math.max(0, Math.min(8, remaining))
      remaining -= bits
      return octet & (bits === 0 ? 0 : (0xff << (8 - bits)) & 0xff)
    })
    return `${masked.join('.')}/${prefix}`
  }
  if (version === 6) {
    const prefix = Math.max(32, Math.min(128, Number(options.ipv6Prefix ?? 56)))
    const parts = expandIpv6(address)
    if (!parts) return 'unknown'
    let remaining = prefix
    const masked = parts.map((part) => {
      const bits = Math.max(0, Math.min(16, remaining))
      remaining -= bits
      return part & (bits === 0 ? 0 : (0xffff << (16 - bits)) & 0xffff)
    })
    return `${masked.map((part) => part.toString(16)).join(':')}/${prefix}`
  }
  return 'unknown'
}

export function canonicalRegistrationEmail(value, options = {}) {
  const email = String(value ?? '').trim().toLowerCase().normalize('NFKC')
  const separator = email.lastIndexOf('@')
  if (separator <= 0 || separator === email.length - 1) return email
  let local = email.slice(0, separator)
  let domain = email.slice(separator + 1)
  const aliasDomains = options.aliasDomains
    ? new Set(options.aliasDomains)
    : new Set([...DEFAULT_ALIAS_DOMAINS, ...envList(process.env.REGISTRATION_ALIAS_DOMAINS)])
  const normalizedDomain = domain === 'googlemail.com' ? 'gmail.com' : domain
  if (aliasDomains.has(domain) || aliasDomains.has(normalizedDomain)) {
    local = local.split('+')[0]
    if (normalizedDomain === 'gmail.com') local = local.replaceAll('.', '')
    domain = normalizedDomain
  }
  return `${local}@${domain}`
}

export function emailDomain(value) {
  const email = canonicalRegistrationEmail(value)
  const separator = email.lastIndexOf('@')
  return separator > 0 ? email.slice(separator + 1) : ''
}

export function registrationEmailPolicy(value, env = process.env) {
  const domain = emailDomain(value)
  const allowed = envList(env.REGISTRATION_ALLOWED_EMAIL_DOMAINS)
  const blocked = envList(env.REGISTRATION_BLOCKED_EMAIL_DOMAINS)
  if (!domain || blocked.has(domain)) return { allowed: false, domain }
  if (allowed.size > 0 && !allowed.has(domain)) return { allowed: false, domain }
  return { allowed: true, domain }
}

export function abuseDigest(secret, ...parts) {
  return createHmac('sha256', String(secret))
    .update(parts.map((part) => String(part ?? '')).join('\u001f'))
    .digest('hex')
}

function tokenDigest(token) {
  return createHash('sha256').update(String(token ?? '')).digest('hex')
}

function verifierDigest(secret, kind, subject, context, answer) {
  return abuseDigest(
    secret,
    'security-challenge-v1',
    kind,
    subject,
    context,
    String(answer ?? '').trim().toLowerCase(),
  )
}

export async function issueSecurityChallenge(options) {
  const nowMs = Number(options.nowMs ?? Date.now())
  const token = randomBytes(32).toString('base64url')
  await options.create({
    id: options.id ?? `challenge_${randomUUID()}`,
    kind: options.kind,
    tokenHash: tokenDigest(token),
    subjectHash: abuseDigest(options.secret, 'subject', options.kind, options.subject ?? ''),
    contextHash: abuseDigest(options.secret, 'context', options.kind, options.context ?? ''),
    verifierHash: verifierDigest(
      options.secret,
      options.kind,
      options.subject ?? '',
      options.context ?? '',
      options.answer,
    ),
    maxAttempts: options.maxAttempts ?? 5,
    createdAtMs: nowMs,
    notBeforeAtMs: nowMs + Number(options.minimumAgeMs ?? 0),
    expiresAtMs: nowMs + Number(options.ttlMs ?? 10 * 60_000),
    metadata: options.metadata ?? {},
  })
  return token
}

export async function claimSecurityChallengeAnswer(options) {
  return options.claim({
    kind: options.kind,
    tokenHash: tokenDigest(options.token),
    subjectHash: abuseDigest(options.secret, 'subject', options.kind, options.subject ?? ''),
    contextHash: abuseDigest(options.secret, 'context', options.kind, options.context ?? ''),
    verifierHash: verifierDigest(
      options.secret,
      options.kind,
      options.subject ?? '',
      options.context ?? '',
      options.answer,
    ),
    nowMs: options.nowMs ?? Date.now(),
  })
}

export function turnstileConfiguration(env = process.env) {
  const siteKey = String(env.TURNSTILE_SITE_KEY ?? '').trim()
  const secretKey = String(env.TURNSTILE_SECRET_KEY ?? '').trim()
  return {
    configured: Boolean(siteKey && secretKey),
    required: env.TURNSTILE_REQUIRED === '1',
    siteKey,
    secretKey,
  }
}

export async function verifyTurnstileToken(options) {
  const token = String(options.token ?? '').trim()
  if (!token || token.length > 2048 || !options.secretKey) return { ok: false, reason: 'invalid-input' }
  const body = new URLSearchParams({
    secret: options.secretKey,
    response: token,
    idempotency_key: randomUUID(),
  })
  if (options.remoteIp && options.remoteIp !== 'unknown') body.set('remoteip', options.remoteIp)
  try {
    return await withAbortDeadline(async (signal) => {
      const response = await (options.fetchImpl ?? fetch)(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
          signal,
        },
      )
      if (!response.ok) return { ok: false, reason: 'provider-error' }
      const result = await response.json()
      if (!result?.success) return { ok: false, reason: 'rejected', errorCodes: result?.['error-codes'] ?? [] }
      if (options.expectedAction && result.action !== options.expectedAction) {
        return { ok: false, reason: 'action-mismatch' }
      }
      if (options.expectedHostname && result.hostname !== options.expectedHostname) {
        return { ok: false, reason: 'hostname-mismatch' }
      }
      return { ok: true }
    }, { timeoutMs: options.timeoutMs ?? 5_000 })
  } catch {
    return { ok: false, reason: 'provider-unavailable' }
  }
}

export async function enforceMinimumDuration(startedAtMs, minimumMs, jitterMs = 0) {
  const target = Number(minimumMs) + (jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0)
  const remaining = target - (Date.now() - Number(startedAtMs))
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))
}
