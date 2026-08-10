import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export const RELEASE_REPOSITORY = 'zhoujasper/phd-atlas'
export const MAX_RELEASE_PACKAGE_BYTES = 100 * 1024 * 1024

const GITHUB_API_ROOT = 'https://api.github.com'
const RELEASE_CACHE_TTL_MS = 5 * 60_000
const MAX_JSON_BYTES = 1024 * 1024
const MAX_CHECKSUM_BYTES = 4 * 1024
const DEFAULT_RELEASE_DOWNLOAD_TIMEOUT_MS = 15 * 60_000
const DEFAULT_OFFICIAL_DOWNLOAD_GRACE_MS = 1_800
const DEFAULT_SOURCE_PROBE_TIMEOUT_MS = 4_500
const DEFAULT_SOURCE_RESPONSE_TIMEOUT_MS = 12_000
const DEFAULT_DOWNLOAD_STALL_TIMEOUT_MS = 12_000
const MAX_RELEASE_TAG_LENGTH = 100
const MAX_RELEASE_ASSET_NAME_LENGTH = 255
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'api.github.com',
  'github.com',
  'release-assets.githubusercontent.com',
])
export const RELEASE_DOWNLOAD_MIRRORS = Object.freeze([
  { id: 'gh-proxy', host: 'gh-proxy.com', prefix: 'https://gh-proxy.com/' },
  { id: 'ghproxy-net', host: 'ghproxy.net', prefix: 'https://ghproxy.net/' },
  { id: 'ghpull', host: 'ghpull.com', prefix: 'https://ghpull.com/' },
])

let releaseCache = null
let releaseCheckInFlight = null

function releaseError(code, message, status = 502) {
  const error = new Error(message)
  error.code = code
  error.status = status
  return error
}

function assertAllowedGithubUrl(value) {
  const url = value instanceof URL ? value : new URL(String(value))
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.port
    || !ALLOWED_DOWNLOAD_HOSTS.has(url.hostname)
  ) {
    throw releaseError('UPDATE_DOWNLOAD_FAILED', 'The Release download redirected to an untrusted address.')
  }
  return url
}

function isAllowedMirrorHost(hostname, mirrorHost) {
  return hostname === mirrorHost || hostname.endsWith(`.${mirrorHost}`)
}

function assertAllowedReleaseDownloadUrl(value, source) {
  const url = value instanceof URL ? value : new URL(String(value))
  const mirrorHost = source?.kind === 'mirror' ? source.host : ''
  const allowedHost = ALLOWED_DOWNLOAD_HOSTS.has(url.hostname)
    || (mirrorHost && isAllowedMirrorHost(url.hostname, mirrorHost))
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.port
    || !allowedHost
  ) {
    throw releaseError('UPDATE_DOWNLOAD_FAILED', 'The Release download redirected to an untrusted address.')
  }
  return url
}

function emitUpdateStatus(options, status) {
  try {
    options.onStatus?.({
      at: new Date().toISOString(),
      ...status,
    })
  } catch {
    // Progress reporting must never be able to interrupt a verified update.
  }
}

function githubHeaders(accept, currentVersion = 'unknown') {
  return {
    Accept: accept,
    'User-Agent': `PhD-Atlas/${String(currentVersion).slice(0, 80)}`,
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

async function discardResponseBody(response) {
  if (!response?.body) return
  await response.body.cancel().catch(() => undefined)
}

async function fetchGithub(url, {
  accept = 'application/vnd.github+json',
  currentVersion,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15_000,
  redirects = 3,
} = {}) {
  let current = assertAllowedGithubUrl(url)
  for (let attempt = 0; attempt <= redirects; attempt += 1) {
    let response
    try {
      response = await fetchImpl(current, {
        method: 'GET',
        headers: githubHeaders(accept, currentVersion),
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      throw releaseError(
        'UPDATE_DOWNLOAD_FAILED',
        error?.name === 'TimeoutError'
          ? 'The GitHub Release request timed out.'
          : 'Could not connect to the GitHub Release service.',
      )
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location || attempt === redirects) {
        await discardResponseBody(response)
        throw releaseError('UPDATE_DOWNLOAD_FAILED', 'The GitHub Release download used too many redirects.')
      }
      await discardResponseBody(response)
      current = assertAllowedGithubUrl(new URL(location, current))
      continue
    }
    if (!response.ok) {
      const status = response.status === 404 ? 404 : 502
      await discardResponseBody(response)
      throw releaseError(
        response.status === 404 ? 'UPDATE_RELEASE_NOT_FOUND' : 'UPDATE_CHECK_FAILED',
        `GitHub Release request failed with status ${response.status}.`,
        status,
      )
    }
    return response
  }
  throw releaseError('UPDATE_DOWNLOAD_FAILED', 'The GitHub Release download could not be resolved.')
}

async function fetchReleaseDownload(source, {
  currentVersion,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_RELEASE_DOWNLOAD_TIMEOUT_MS,
  responseTimeoutMs = timeoutMs,
  range,
  redirects = 4,
} = {}) {
  let current = assertAllowedReleaseDownloadUrl(source.url, source)
  for (let attempt = 0; attempt <= redirects; attempt += 1) {
    let response
    const responseController = new AbortController()
    const responseTimer = setTimeout(
      () => responseController.abort(),
      Math.max(1, Math.min(timeoutMs, responseTimeoutMs)),
    )
    responseTimer.unref?.()
    try {
      response = await fetchImpl(current, {
        method: 'GET',
        headers: {
          ...githubHeaders('application/octet-stream', currentVersion),
          ...(range ? { Range: range } : {}),
        },
        redirect: 'manual',
        signal: AbortSignal.any([
          AbortSignal.timeout(timeoutMs),
          responseController.signal,
        ]),
      })
    } catch (error) {
      throw releaseError(
        'UPDATE_DOWNLOAD_FAILED',
        error?.name === 'TimeoutError' || error?.name === 'AbortError'
          ? 'The Release update source timed out.'
          : 'Could not connect to the Release update source.',
      )
    } finally {
      clearTimeout(responseTimer)
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location || attempt === redirects) {
        await discardResponseBody(response)
        throw releaseError('UPDATE_DOWNLOAD_FAILED', 'The Release update source used too many redirects.')
      }
      await discardResponseBody(response)
      current = assertAllowedReleaseDownloadUrl(new URL(location, current), source)
      continue
    }
    if (!response.ok) {
      await discardResponseBody(response)
      throw releaseError(
        'UPDATE_DOWNLOAD_FAILED',
        `Release update source ${source.id} failed with status ${response.status}.`,
      )
    }
    return response
  }
  throw releaseError('UPDATE_DOWNLOAD_FAILED', 'The Release update source could not be resolved.')
}

async function readBoundedBody(response, limit, code) {
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(declared) && declared > limit) {
    await discardResponseBody(response)
    throw releaseError(code, 'The GitHub Release response exceeded the allowed size.')
  }
  if (!response.body) throw releaseError(code, 'The GitHub Release response was empty.')
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      let chunk
      try {
        chunk = await reader.read()
      } catch {
        throw releaseError(code, 'The GitHub Release response was interrupted.')
      }
      const { done, value } = chunk
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel().catch(() => undefined)
        throw releaseError(code, 'The GitHub Release response exceeded the allowed size.')
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, size)
}

async function fetchGithubJson(apiPath, options = {}) {
  const response = await fetchGithub(`${GITHUB_API_ROOT}${apiPath}`, options)
  const body = await readBoundedBody(response, MAX_JSON_BYTES, 'UPDATE_CHECK_FAILED')
  try {
    return JSON.parse(body.toString('utf8'))
  } catch {
    throw releaseError('UPDATE_CHECK_FAILED', 'GitHub returned an invalid Release response.')
  }
}

export function parseSemver(value) {
  const match = String(value ?? '').trim().match(
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/,
  )
  if (!match) return null
  const core = match.slice(1, 4)
  if (core.some((part) => part.length > 1 && part.startsWith('0'))) return null
  const prerelease = match[4] ? match[4].split('.') : []
  const build = match[5] ? match[5].split('.') : []
  if (
    prerelease.some((part) => (
      !part
      || (/^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))
    ))
    || build.some((part) => !part)
  ) {
    return null
  }
  return {
    value: `${core[0]}.${core[1]}.${core[2]}${match[4] ? `-${match[4]}` : ''}${match[5] ? `+${match[5]}` : ''}`,
    major: BigInt(core[0]),
    minor: BigInt(core[1]),
    patch: BigInt(core[2]),
    prerelease,
    build,
  }
}

export function compareSemver(leftValue, rightValue) {
  const left = parseSemver(leftValue)
  const right = parseSemver(rightValue)
  if (!left || !right) throw new TypeError('compareSemver requires valid semantic versions.')
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0
    return left.prerelease.length === 0 ? 1 : -1
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index]
    const rightPart = right.prerelease[index]
    if (leftPart === undefined || rightPart === undefined) {
      if (leftPart === rightPart) return 0
      return leftPart === undefined ? -1 : 1
    }
    if (leftPart === rightPart) continue
    const leftNumeric = /^\d+$/.test(leftPart)
    const rightNumeric = /^\d+$/.test(rightPart)
    if (leftNumeric && rightNumeric) return BigInt(leftPart) > BigInt(rightPart) ? 1 : -1
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return leftPart > rightPart ? 1 : -1
  }
  return 0
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizedAsset(asset) {
  return {
    id: Number(asset?.id),
    name: String(asset?.name ?? ''),
    size: Number(asset?.size ?? 0),
    digest: typeof asset?.digest === 'string' ? asset.digest : '',
  }
}

function isSafeReleaseAssetName(value) {
  return Boolean(
    value
    && value.length <= MAX_RELEASE_ASSET_NAME_LENGTH
    && !value.includes('/')
    && !value.includes('\\')
    && !value.includes('\0'),
  )
}

export function releaseCandidateFromGithub(release) {
  if (!release || release.draft) return null
  const parsed = parseSemver(release.tag_name)
  if (!parsed || String(release.tag_name) !== `v${parsed.value}`) return null
  const isPrerelease = parsed.prerelease.length > 0
  // Channel selection is a security boundary. Reject inconsistent GitHub
  // metadata instead of allowing a prerelease tag marked as stable to reach a
  // stable installation.
  if (Boolean(release.prerelease) !== isPrerelease) return null
  const assets = Array.isArray(release.assets) ? release.assets.map(normalizedAsset) : []
  const packagePattern = new RegExp(`^phd-atlas-update-${escapeRegex(parsed.value)}-.+\\.tar\\.gz$`)
  const packageAssets = assets.filter((asset) => (
    Number.isSafeInteger(asset.id)
    && asset.id > 0
    && isSafeReleaseAssetName(asset.name)
    && packagePattern.test(asset.name)
  ))
  if (packageAssets.length !== 1) return null
  const [packageAsset] = packageAssets
  if (
    !packageAsset
    || !Number.isSafeInteger(packageAsset.size)
    || packageAsset.size < 1
    || packageAsset.size > MAX_RELEASE_PACKAGE_BYTES
  ) return null
  const checksumAssets = assets.filter((asset) => (
    Number.isSafeInteger(asset.id)
    && asset.id > 0
    && asset.name === `${packageAsset.name}.sha256`
  ))
  if (checksumAssets.length !== 1) return null
  const [checksumAsset] = checksumAssets
  if (
    !checksumAsset
    || !Number.isSafeInteger(checksumAsset.size)
    || checksumAsset.size < 1
    || checksumAsset.size > MAX_CHECKSUM_BYTES
  ) return null
  const deltaPattern = new RegExp(
    `^phd-atlas-delta-(.+)-to-${escapeRegex(parsed.value)}-release\\.tar\\.gz$`,
  )
  const deltaAssetsByVersion = new Map()
  for (const asset of assets) {
    const match = deltaPattern.exec(asset.name)
    if (!match) continue
    const fromVersion = parseSemver(match[1])
    if (
      !fromVersion
      || match[1] !== fromVersion.value
      || compareSemver(parsed.value, fromVersion.value) <= 0
      || !Number.isSafeInteger(asset.id)
      || asset.id <= 0
      || !isSafeReleaseAssetName(asset.name)
      || !Number.isSafeInteger(asset.size)
      || asset.size < 1
      || asset.size > MAX_RELEASE_PACKAGE_BYTES
      || deltaAssetsByVersion.has(fromVersion.value)
    ) return null
    const matchingChecksums = assets.filter((candidate) => (
      Number.isSafeInteger(candidate.id)
      && candidate.id > 0
      && candidate.name === `${asset.name}.sha256`
    ))
    if (
      matchingChecksums.length !== 1
      || !Number.isSafeInteger(matchingChecksums[0].size)
      || matchingChecksums[0].size < 1
      || matchingChecksums[0].size > MAX_CHECKSUM_BYTES
    ) return null
    deltaAssetsByVersion.set(fromVersion.value, {
      fromVersion: fromVersion.value,
      packageAsset: asset,
      checksumAsset: matchingChecksums[0],
    })
  }
  return {
    version: parsed.value,
    tagName: String(release.tag_name),
    name: String(release.name ?? release.tag_name),
    publishedAt: String(release.published_at ?? ''),
    htmlUrl: `https://github.com/${RELEASE_REPOSITORY}/releases/tag/${encodeURIComponent(String(release.tag_name))}`,
    prerelease: isPrerelease,
    packageAsset,
    checksumAsset,
    deltaAssets: [...deltaAssetsByVersion.values()]
      .sort((left, right) => compareSemver(left.fromVersion, right.fromVersion)),
  }
}

export function selectReleaseUpdate(releases, currentVersion) {
  const current = parseSemver(currentVersion)
  if (!current) {
    throw releaseError('UPDATE_CHECK_FAILED', 'The installed PhD Atlas version is invalid.')
  }
  const candidates = (Array.isArray(releases) ? releases : [])
    .map(releaseCandidateFromGithub)
    .filter(Boolean)
    .filter((candidate) => current.prerelease.length > 0 || !candidate.prerelease)
    .sort((left, right) => compareSemver(right.version, left.version))
  return candidates.find((candidate) => compareSemver(candidate.version, currentVersion) > 0) ?? null
}

function selectedReleaseTransfer(candidate, deltaFromVersion = '') {
  const delta = candidate?.deltaAssets?.find((entry) => entry.fromVersion === deltaFromVersion)
  if (delta) {
    return {
      kind: 'delta',
      fromVersion: delta.fromVersion,
      packageAsset: delta.packageAsset,
      checksumAsset: delta.checksumAsset,
    }
  }
  return {
    kind: 'full',
    fromVersion: null,
    packageAsset: candidate.packageAsset,
    checksumAsset: candidate.checksumAsset,
  }
}

function publicReleaseInfo(candidate, deltaFromVersion = '') {
  if (!candidate) return null
  const transfer = selectedReleaseTransfer(candidate, deltaFromVersion)
  return {
    version: candidate.version,
    tagName: candidate.tagName,
    name: candidate.name,
    publishedAt: candidate.publishedAt,
    htmlUrl: candidate.htmlUrl,
    prerelease: candidate.prerelease,
    package: {
      name: transfer.packageAsset.name,
      size: transfer.packageAsset.size,
      kind: transfer.kind,
      fromVersion: transfer.fromVersion,
      fullSize: candidate.packageAsset.size,
    },
  }
}

export function clearReleaseUpdateCache() {
  releaseCache = null
}

export async function checkForReleaseUpdate(currentVersion, options = {}) {
  const now = Date.now()
  const requestedDeltaBase = parseSemver(options.deltaFromVersion)
  const deltaFromVersion = requestedDeltaBase
    && requestedDeltaBase.value === options.deltaFromVersion
    ? requestedDeltaBase.value
    : ''
  if (
    options.cache !== false
    && releaseCache?.currentVersion === currentVersion
    && releaseCache?.deltaFromVersion === deltaFromVersion
    && releaseCache.expiresAt > now
  ) {
    return releaseCache.result
  }
  if (
    options.cache !== false
    && releaseCheckInFlight?.currentVersion === currentVersion
    && releaseCheckInFlight?.deltaFromVersion === deltaFromVersion
  ) {
    return releaseCheckInFlight.promise
  }
  const check = (async () => {
    const releases = await fetchGithubJson(
      `/repos/${RELEASE_REPOSITORY}/releases?per_page=30`,
      { ...options, currentVersion },
    )
    const candidate = selectReleaseUpdate(releases, currentVersion)
    const result = {
      currentVersion,
      updateAvailable: Boolean(candidate),
      release: publicReleaseInfo(candidate, deltaFromVersion),
      checkedAt: new Date().toISOString(),
    }
    if (options.cache !== false) {
      releaseCache = {
        currentVersion,
        deltaFromVersion,
        expiresAt: Date.now() + RELEASE_CACHE_TTL_MS,
        result,
      }
    }
    return result
  })()
  if (options.cache === false) return check
  releaseCheckInFlight = { currentVersion, deltaFromVersion, promise: check }
  try {
    return await check
  } finally {
    if (releaseCheckInFlight?.promise === check) releaseCheckInFlight = null
  }
}

function parseChecksumFile(value, expectedName) {
  const matches = []
  for (const line of String(value ?? '').split(/\r?\n/)) {
    const match = line.trim().match(/^([a-fA-F0-9]{64})\s+[*]?(.+)$/)
    if (!match) continue
    const listedName = path.posix.basename(match[2].replaceAll('\\', '/'))
    if (listedName === expectedName) matches.push(match[1].toLowerCase())
  }
  if (matches.length === 1) return matches[0]
  throw releaseError('UPDATE_INTEGRITY_FAILED', 'The Release checksum file is invalid.', 400)
}

async function writeAll(handle, value) {
  let offset = 0
  while (offset < value.byteLength) {
    const { bytesWritten } = await handle.write(
      value,
      offset,
      value.byteLength - offset,
      null,
    )
    if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0) {
      throw releaseError('UPDATE_DOWNLOAD_FAILED', 'The Release update package could not be stored.')
    }
    offset += bytesWritten
  }
}

async function downloadAssetBuffer(asset, currentVersion, options, limit) {
  const response = await fetchGithub(
    `${GITHUB_API_ROOT}/repos/${RELEASE_REPOSITORY}/releases/assets/${asset.id}`,
    {
      ...options,
      accept: 'application/octet-stream',
      currentVersion,
      timeoutMs: options.timeoutMs ?? 30_000,
    },
  )
  return readBoundedBody(response, limit, 'UPDATE_DOWNLOAD_FAILED')
}

function releasePackageSources(candidate, packageAsset) {
  const officialBrowserUrl = `https://github.com/${RELEASE_REPOSITORY}/releases/download/${encodeURIComponent(candidate.tagName)}/${encodeURIComponent(packageAsset.name)}`
  return [
    {
      id: 'github',
      kind: 'official',
      host: 'api.github.com',
      url: `${GITHUB_API_ROOT}/repos/${RELEASE_REPOSITORY}/releases/assets/${packageAsset.id}`,
    },
    ...RELEASE_DOWNLOAD_MIRRORS.map((mirror) => ({
      id: mirror.id,
      kind: 'mirror',
      host: mirror.host,
      url: `${mirror.prefix}${officialBrowserUrl}`,
    })),
  ]
}

async function probeReleaseDownloadSource(source, currentVersion, options, timeoutMs) {
  const startedAt = Date.now()
  const response = await fetchReleaseDownload(source, {
    currentVersion,
    fetchImpl: options.fetchImpl,
    timeoutMs,
    range: 'bytes=0-1',
  })
  if (!response.body) throw releaseError('UPDATE_DOWNLOAD_FAILED', 'The Release update source was empty.')
  const reader = response.body.getReader()
  const signature = []
  try {
    while (signature.length < 2) {
      const { done, value } = await readReleaseDownloadChunk(reader, timeoutMs)
      if (done) break
      for (const byte of value) {
        signature.push(byte)
        if (signature.length === 2) break
      }
    }
    await reader.cancel().catch(() => undefined)
  } finally {
    reader.releaseLock()
  }
  if (signature[0] !== 0x1f || signature[1] !== 0x8b) {
    throw releaseError('UPDATE_DOWNLOAD_FAILED', 'The Release update source did not return the expected package.')
  }
  return {
    ...source,
    latencyMs: Math.max(1, Date.now() - startedAt),
  }
}

async function rankReleaseDownloadSources(sources, currentVersion, options) {
  const results = await Promise.allSettled(sources.map((source) => (
    probeReleaseDownloadSource(
      source,
      currentVersion,
      options,
      options.sourceProbeTimeoutMs ?? DEFAULT_SOURCE_PROBE_TIMEOUT_MS,
    )
  )))
  const ranked = results
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value)
    .sort((left, right) => left.latencyMs - right.latencyMs)
  if (ranked.length === 0) {
    throw releaseError('UPDATE_DOWNLOAD_FAILED', 'GitHub and the configured Release mirrors were unreachable.')
  }
  return ranked
}

async function resolveReleaseDownloadSources(candidate, packageAsset, currentVersion, options) {
  const sources = releasePackageSources(candidate, packageAsset)
  const official = sources[0]
  const mirrors = sources.slice(1)
  emitUpdateStatus(options, { phase: 'probing', source: official.id })
  try {
    const result = await probeReleaseDownloadSource(
      official,
      currentVersion,
      options,
      options.officialGraceMs ?? DEFAULT_OFFICIAL_DOWNLOAD_GRACE_MS,
    )
    return {
      sources: [result],
      fallbackSources: mirrors,
    }
  } catch {
    emitUpdateStatus(options, { phase: 'probing', source: 'mirrors' })
    return {
      sources: await rankReleaseDownloadSources(mirrors, currentVersion, options),
      fallbackSources: [],
    }
  }
}

function readReleaseDownloadChunk(reader, timeoutMs) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(releaseError(
        'UPDATE_DOWNLOAD_STALLED',
        'The Release update source stopped making progress.',
      ))
    }, Math.max(1, timeoutMs))
    timer.unref?.()
  })
  return Promise.race([reader.read(), timeout]).finally(() => clearTimeout(timer))
}

async function downloadAssetFile(asset, currentVersion, destinationPath, options, source = null) {
  const response = source
    ? await fetchReleaseDownload(source, {
      currentVersion,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.downloadTimeoutMs ?? DEFAULT_RELEASE_DOWNLOAD_TIMEOUT_MS,
      responseTimeoutMs: options.sourceResponseTimeoutMs ?? DEFAULT_SOURCE_RESPONSE_TIMEOUT_MS,
    })
    : await fetchGithub(
      `${GITHUB_API_ROOT}/repos/${RELEASE_REPOSITORY}/releases/assets/${asset.id}`,
      {
        ...options,
        accept: 'application/octet-stream',
        currentVersion,
        timeoutMs: options.downloadTimeoutMs ?? DEFAULT_RELEASE_DOWNLOAD_TIMEOUT_MS,
      },
    )
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (
    (Number.isFinite(declared) && declared > MAX_RELEASE_PACKAGE_BYTES)
    || asset.size > MAX_RELEASE_PACKAGE_BYTES
  ) {
    await discardResponseBody(response)
    throw releaseError('UPDATE_DOWNLOAD_FAILED', 'The Release update package is too large.')
  }
  if (!response.body) throw releaseError('UPDATE_DOWNLOAD_FAILED', 'The Release update package was empty.')
  const handle = await fs.open(destinationPath, 'wx', 0o600)
  const reader = response.body.getReader()
  const hash = createHash('sha256')
  const stallTimeoutMs = options.downloadStallTimeoutMs ?? DEFAULT_DOWNLOAD_STALL_TIMEOUT_MS
  let size = 0
  let lastProgressAt = 0
  try {
    while (true) {
      let chunk
      try {
        chunk = await readReleaseDownloadChunk(reader, stallTimeoutMs)
      } catch (error) {
        await reader.cancel().catch(() => undefined)
        if (error?.code === 'UPDATE_DOWNLOAD_STALLED') throw error
        throw releaseError('UPDATE_DOWNLOAD_FAILED', 'The Release update download was interrupted.')
      }
      const { done, value } = chunk
      if (done) break
      size += value.byteLength
      if (size > MAX_RELEASE_PACKAGE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw releaseError('UPDATE_DOWNLOAD_FAILED', 'The Release update package is too large.')
      }
      hash.update(value)
      await writeAll(handle, value)
      if (Date.now() - lastProgressAt >= 120 || size === asset.size) {
        lastProgressAt = Date.now()
        emitUpdateStatus(options, {
          phase: 'downloading',
          source: source?.id ?? 'github',
          bytes: size,
          total: asset.size,
        })
      }
    }
  } finally {
    reader.releaseLock()
    await handle.close()
  }
  if (size !== asset.size) {
    throw releaseError('UPDATE_INTEGRITY_FAILED', 'The Release update package size did not match GitHub.', 400)
  }
  return { size, sha256: hash.digest('hex') }
}

async function releaseByTag(tagName, currentVersion, options) {
  const requestedTag = String(tagName ?? '')
  const parsedTag = requestedTag.length <= MAX_RELEASE_TAG_LENGTH
    ? parseSemver(requestedTag)
    : null
  if (!parsedTag || requestedTag !== `v${parsedTag.value}`) {
    throw releaseError('UPDATE_RELEASE_NOT_FOUND', 'The requested Release tag is invalid.', 404)
  }
  const release = await fetchGithubJson(
    `/repos/${RELEASE_REPOSITORY}/releases/tags/${encodeURIComponent(requestedTag)}`,
    { ...options, currentVersion },
  )
  const candidate = releaseCandidateFromGithub(release)
  if (!candidate || candidate.tagName !== requestedTag) {
    throw releaseError('UPDATE_RELEASE_NOT_FOUND', 'The requested Release does not contain a compatible update package.', 404)
  }
  return candidate
}

export async function downloadReleaseUpdate({
  tagName,
  currentVersion,
  destinationRoot,
  deltaFromVersion = '',
  ...options
}) {
  emitUpdateStatus(options, { phase: 'resolving', source: 'github' })
  const candidate = await releaseByTag(tagName, currentVersion, options)
  const current = parseSemver(currentVersion)
  if (
    !current
    || compareSemver(candidate.version, currentVersion) <= 0
    || (current.prerelease.length === 0 && candidate.prerelease)
  ) {
    throw releaseError('UPDATE_NOT_AVAILABLE', 'The selected Release is not newer than the installed version.', 409)
  }
  const requestedDeltaBase = parseSemver(deltaFromVersion)
  const normalizedDeltaBase = requestedDeltaBase?.value === deltaFromVersion
    ? requestedDeltaBase.value
    : ''
  const transfer = selectedReleaseTransfer(candidate, normalizedDeltaBase)
  await fs.mkdir(destinationRoot, { recursive: true })
  const checksumBody = await downloadAssetBuffer(
    transfer.checksumAsset,
    currentVersion,
    options,
    MAX_CHECKSUM_BYTES,
  )
  const expectedSha256 = parseChecksumFile(checksumBody.toString('utf8'), transfer.packageAsset.name)
  if (transfer.packageAsset.digest?.startsWith('sha256:')) {
    const githubDigest = transfer.packageAsset.digest.slice('sha256:'.length).toLowerCase()
    if (githubDigest !== expectedSha256) {
      throw releaseError('UPDATE_INTEGRITY_FAILED', 'The Release asset and checksum metadata do not match.', 400)
    }
  }
  const suffix = randomBytes(8).toString('hex')
  const packagePath = path.join(destinationRoot, `release-update-${Date.now()}-${suffix}.tar.gz`)
  const useSourceSelection = options.sourceSelection === true
    || (options.sourceSelection !== false && !options.fetchImpl)
  try {
    const sourcePlan = useSourceSelection
      ? await resolveReleaseDownloadSources(candidate, transfer.packageAsset, currentVersion, options)
      : { sources: [null], fallbackSources: [] }
    let sources = sourcePlan.sources
    let fallbackSources = sourcePlan.fallbackSources
    let downloaded = null
    let selectedSource = null
    let lastError = null
    while (sources.length > 0 && !downloaded) {
      for (const source of sources) {
        await fs.rm(packagePath, { force: true }).catch(() => undefined)
        emitUpdateStatus(options, {
          phase: 'downloading',
          source: source?.id ?? 'github',
          bytes: 0,
          total: transfer.packageAsset.size,
        })
        try {
          const result = await downloadAssetFile(
            transfer.packageAsset,
            currentVersion,
            packagePath,
            options,
            source,
          )
          emitUpdateStatus(options, {
            phase: 'verifying',
            source: source?.id ?? 'github',
            bytes: result.size,
            total: transfer.packageAsset.size,
          })
          if (result.sha256 !== expectedSha256) {
            throw releaseError('UPDATE_INTEGRITY_FAILED', 'The downloaded update package checksum did not match.', 400)
          }
          downloaded = result
          selectedSource = source
          break
        } catch (error) {
          lastError = error
        }
      }
      if (downloaded || fallbackSources.length === 0) break
      await fs.rm(packagePath, { force: true }).catch(() => undefined)
      emitUpdateStatus(options, { phase: 'probing', source: 'mirrors' })
      sources = await rankReleaseDownloadSources(fallbackSources, currentVersion, options)
      fallbackSources = []
    }
    if (!downloaded) throw lastError ?? releaseError('UPDATE_DOWNLOAD_FAILED', 'The Release update package could not be downloaded.')
    return {
      packagePath,
      fileName: transfer.packageAsset.name,
      size: downloaded.size,
      sha256: downloaded.sha256,
      source: {
        id: selectedSource?.id ?? 'github',
        kind: selectedSource?.kind ?? 'official',
        host: selectedSource?.host ?? 'api.github.com',
      },
      transfer: {
        kind: transfer.kind,
        fromVersion: transfer.fromVersion,
      },
      release: publicReleaseInfo(candidate, transfer.fromVersion ?? ''),
    }
  } catch (error) {
    await fs.rm(packagePath, { force: true }).catch(() => undefined)
    throw error
  }
}
