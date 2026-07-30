import { promises as dns } from 'node:dns'
import net from 'node:net'
import { domainToASCII } from 'node:url'

const nonPublicIpv4 = new net.BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]) {
  nonPublicIpv4.addSubnet(network, prefix, 'ipv4')
}

const nonPublicIpv6 = new net.BlockList()
for (const [network, prefix] of [
  ['::', 96],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
]) {
  nonPublicIpv6.addSubnet(network, prefix, 'ipv6')
}

export class OutboundNetworkPolicyError extends Error {
  constructor(code, message, cause) {
    super(message)
    this.name = 'OutboundNetworkPolicyError'
    this.code = code
    this.cause = cause
  }
}

function hasForbiddenHostCharacter(value) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x20
      || codePoint === 0x7f
      || '/@?#\\'.includes(character)
  })
}

export function normalizeNetworkHost(value) {
  let host = String(value ?? '').trim()
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  if (
    !host
    || host.length > 253
    || hasForbiddenHostCharacter(host)
    || host.includes('%')
  ) {
    return ''
  }
  if (net.isIP(host)) return host.toLowerCase()
  host = host.replace(/\.$/, '')
  const ascii = domainToASCII(host).toLowerCase()
  if (!ascii || ascii.length > 253) return ''
  const labels = ascii.split('.')
  if (labels.some((label) => (
    label.length < 1
    || label.length > 63
    || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  ))) {
    return ''
  }
  return ascii
}

export function isPublicNetworkAddress(value) {
  const address = String(value ?? '').trim().toLowerCase()
  const family = net.isIP(address)
  if (family === 4) return !nonPublicIpv4.check(address, 'ipv4')
  if (family === 6) return !nonPublicIpv6.check(address, 'ipv6')
  return false
}

function normalizedHostAllowlist(value) {
  return new Set(
    String(value ?? '')
      .split(',')
      .map(normalizeNetworkHost)
      .filter(Boolean),
  )
}

/**
 * Resolve once, validate every returned address, and return one numeric address
 * for the caller to connect to directly. Keeping the original DNS name only as
 * TLS SNI closes the validation-to-connect DNS-rebinding window.
 */
export async function resolvePinnedNetworkTarget(value, options = {}) {
  const host = normalizeNetworkHost(value)
  if (!host) {
    throw new OutboundNetworkPolicyError('INVALID_OUTBOUND_HOST', 'The server host is invalid.')
  }

  const enforcePublic = options.enforcePublic ?? process.env.NODE_ENV === 'production'
  const family = net.isIP(host)
  if (!enforcePublic) {
    return {
      address: host,
      family: family || 0,
      host,
      servername: family ? undefined : host,
      pinned: Boolean(family),
    }
  }

  let records
  if (family) {
    records = [{ address: host, family }]
  } else {
    try {
      records = await (options.lookup ?? dns.lookup)(host, { all: true, verbatim: true })
    } catch (error) {
      throw new OutboundNetworkPolicyError(
        'OUTBOUND_HOST_UNRESOLVED',
        'The server host could not be resolved.',
        error,
      )
    }
  }

  const addresses = [...new Map(
    (Array.isArray(records) ? records : [records])
      .map((record) => {
        const address = String(record?.address ?? '').trim().toLowerCase()
        const resolvedFamily = net.isIP(address)
        return resolvedFamily ? [address, { address, family: resolvedFamily }] : null
      })
      .filter(Boolean),
  ).values()]
  if (addresses.length === 0 || addresses.length > 32) {
    throw new OutboundNetworkPolicyError(
      'OUTBOUND_HOST_UNRESOLVED',
      'The server host did not resolve to a usable address.',
    )
  }

  const privateHostAllowlist = options.privateHostAllowlist instanceof Set
    ? options.privateHostAllowlist
    : normalizedHostAllowlist(options.privateHostAllowlist)
  const explicitlyAllowed = privateHostAllowlist.has(host)
  if (!explicitlyAllowed && addresses.some(({ address }) => !isPublicNetworkAddress(address))) {
    throw new OutboundNetworkPolicyError(
      'OUTBOUND_HOST_NOT_PUBLIC',
      'The server host resolves to a private or reserved network address.',
    )
  }

  const selected = addresses[0]
  return {
    ...selected,
    host,
    servername: family ? undefined : host,
    pinned: true,
  }
}

export function resolveMailNetworkTarget(value, options = {}) {
  return resolvePinnedNetworkTarget(value, {
    ...options,
    privateHostAllowlist: options.privateHostAllowlist ?? process.env.MAIL_PRIVATE_HOST_ALLOWLIST,
  })
}
