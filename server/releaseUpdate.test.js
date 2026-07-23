import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  checkForReleaseUpdate,
  clearReleaseUpdateCache,
  compareSemver,
  downloadReleaseUpdate,
  parseSemver,
  releaseCandidateFromGithub,
  selectReleaseUpdate,
} from './releaseUpdate.js'

let tempRoot = ''

afterEach(async () => {
  vi.restoreAllMocks()
  clearReleaseUpdateCache()
  if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true })
  tempRoot = ''
})

function releaseFixture(version, overrides = {}) {
  const packageName = `phd-atlas-update-${version}-2026-07-23.tar.gz`
  return {
    id: 12,
    draft: false,
    prerelease: version.includes('-'),
    tag_name: `v${version}`,
    name: `PhD Atlas v${version}`,
    published_at: '2026-07-23T12:00:00Z',
    assets: [
      { id: 101, name: packageName, size: 128, digest: '' },
      { id: 102, name: `${packageName}.sha256`, size: 96, digest: '' },
    ],
    ...overrides,
  }
}

describe('Release update discovery', () => {
  it('orders numeric prerelease identifiers and stable releases using SemVer rules', () => {
    expect(compareSemver('0.1.0-beta.10', '0.1.0-beta.2')).toBe(1)
    expect(compareSemver('0.1.0', '0.1.0-beta.10')).toBe(1)
    expect(compareSemver('0.2.0-beta.1', '0.1.9')).toBe(1)
    expect(compareSemver('0.2.0+build.2', '0.2.0+build.1')).toBe(0)
    expect(compareSemver(
      '0.1.0-beta.100000000000000000000',
      '0.1.0-beta.99999999999999999999',
    )).toBe(1)
    expect(parseSemver('01.0.0')).toBeNull()
    expect(parseSemver('1.0.0-beta.01')).toBeNull()
    expect(parseSemver('1.0.0-beta..1')).toBeNull()
  })

  it('selects only a newer public Release with both package and checksum assets', () => {
    const invalid = releaseFixture('0.1.0-beta.4', {
      assets: [{ id: 1, name: 'source.tar.gz', size: 10 }],
    })
    const selected = selectReleaseUpdate([
      releaseFixture('0.1.0-beta.2'),
      releaseFixture('0.1.0-beta.3'),
      invalid,
    ], '0.1.0-beta.1')

    expect(selected?.version).toBe('0.1.0-beta.3')
    expect(releaseCandidateFromGithub(invalid)).toBeNull()
    const unsafeName = releaseFixture('0.1.0-beta.5')
    unsafeName.assets[0].name = `nested/${unsafeName.assets[0].name}`
    unsafeName.assets[1].name = `${unsafeName.assets[0].name}.sha256`
    expect(releaseCandidateFromGithub(unsafeName)).toBeNull()
    expect(selectReleaseUpdate([
      releaseFixture('0.1.1+build.1', { prerelease: false }),
    ], '0.1.0')?.version).toBe('0.1.1+build.1')
    expect(selectReleaseUpdate([releaseFixture('0.1.0-beta.1')], '0.1.0-beta.1')).toBeNull()
  })

  it('does not move a stable installation back onto a prerelease channel', () => {
    expect(selectReleaseUpdate([
      releaseFixture('0.2.0-beta.1'),
    ], '0.1.0')).toBeNull()
    expect(selectReleaseUpdate([
      releaseFixture('0.2.0'),
      releaseFixture('0.3.0-beta.1'),
    ], '0.1.0')?.version).toBe('0.2.0')
  })

  it('rejects releases whose GitHub prerelease flag contradicts the SemVer tag', () => {
    const prereleaseMarkedStable = releaseFixture('0.2.0-beta.1', { prerelease: false })
    const stableMarkedPrerelease = releaseFixture('0.2.0', { prerelease: true })

    expect(releaseCandidateFromGithub(prereleaseMarkedStable)).toBeNull()
    expect(releaseCandidateFromGithub(stableMarkedPrerelease)).toBeNull()
    expect(selectReleaseUpdate([prereleaseMarkedStable], '0.1.0')).toBeNull()
  })

  it('returns bounded public metadata from the repository Release feed', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(
      JSON.stringify([releaseFixture('0.1.0-beta.2')]),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))

    const result = await checkForReleaseUpdate('0.1.0-beta.1', {
      fetchImpl,
      cache: false,
    })

    expect(result).toMatchObject({
      currentVersion: '0.1.0-beta.1',
      updateAvailable: true,
      release: {
        version: '0.1.0-beta.2',
        tagName: 'v0.1.0-beta.2',
        package: { name: expect.stringContaining('0.1.0-beta.2') },
      },
    })
    expect(result.release.htmlUrl).toBe(
      'https://github.com/zhoujasper/phd-atlas/releases/tag/v0.1.0-beta.2',
    )
  })

  it('coalesces concurrent cached checks for the same installed version', async () => {
    let resolveFetch
    const fetchImpl = vi.fn(() => new Promise((resolve) => {
      resolveFetch = resolve
    }))

    const first = checkForReleaseUpdate('0.1.0-beta.1', { fetchImpl })
    const second = checkForReleaseUpdate('0.1.0-beta.1', { fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    resolveFetch(new Response(
      JSON.stringify([releaseFixture('0.1.0-beta.2')]),
      { status: 200 },
    ))

    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(firstResult).toEqual(secondResult)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('downloads the exact asset, accepts a path-prefixed checksum, and verifies SHA-256', async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-release-update-'))
    const payload = Buffer.alloc(128, 'a')
    const sha256 = createHash('sha256').update(payload).digest('hex')
    const release = releaseFixture('0.1.0-beta.2')
    release.assets[0].digest = `sha256:${sha256}`
    const checksum = `${sha256}  storage/update-packages/${release.assets[0].name}\n`
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(release), { status: 200 }))
      .mockResolvedValueOnce(new Response(checksum, { status: 200 }))
      .mockResolvedValueOnce(new Response(payload, {
        status: 200,
        headers: { 'content-length': String(payload.length) },
      }))

    const result = await downloadReleaseUpdate({
      tagName: 'v0.1.0-beta.2',
      currentVersion: '0.1.0-beta.1',
      destinationRoot: tempRoot,
      fetchImpl,
    })

    expect(result).toMatchObject({
      fileName: release.assets[0].name,
      size: payload.length,
      sha256,
      release: { version: '0.1.0-beta.2' },
    })
    expect(await fs.readFile(result.packagePath)).toEqual(payload)
  })

  it('retries partial filesystem writes without weakening the streamed checksum', async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-release-update-'))
    const payload = Buffer.alloc(128, 'p')
    const sha256 = createHash('sha256').update(payload).digest('hex')
    const release = releaseFixture('0.1.0-beta.2')
    const checksum = `${sha256}  ${release.assets[0].name}\n`
    const written = []
    const write = vi.fn(async (value, offset, length) => {
      const bytesWritten = Math.min(7, length)
      written.push(Buffer.from(value).subarray(offset, offset + bytesWritten))
      return { bytesWritten, buffer: value }
    })
    vi.spyOn(fs, 'open').mockResolvedValue({
      write,
      close: vi.fn().mockResolvedValue(undefined),
    })
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(release), { status: 200 }))
      .mockResolvedValueOnce(new Response(checksum, { status: 200 }))
      .mockResolvedValueOnce(new Response(payload, {
        status: 200,
        headers: { 'content-length': String(payload.length) },
      }))

    const result = await downloadReleaseUpdate({
      tagName: 'v0.1.0-beta.2',
      currentVersion: 'v0.1.0-beta.1',
      destinationRoot: tempRoot,
      fetchImpl,
    })

    expect(Buffer.concat(written)).toEqual(payload)
    expect(write).toHaveBeenCalledTimes(Math.ceil(payload.length / 7))
    expect(result.sha256).toBe(sha256)
  })

  it('rejects ambiguous checksum sidecars before downloading the package', async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-release-update-'))
    const release = releaseFixture('0.1.0-beta.2')
    const first = 'a'.repeat(64)
    const second = 'b'.repeat(64)
    const checksum = [
      `${first}  ${release.assets[0].name}`,
      `${second}  nested/${release.assets[0].name}`,
    ].join('\n')
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(release), { status: 200 }))
      .mockResolvedValueOnce(new Response(checksum, { status: 200 }))

    await expect(downloadReleaseUpdate({
      tagName: 'v0.1.0-beta.2',
      currentVersion: '0.1.0-beta.1',
      destinationRoot: tempRoot,
      fetchImpl,
    })).rejects.toMatchObject({ code: 'UPDATE_INTEGRITY_FAILED' })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(await fs.readdir(tempRoot)).toEqual([])
  })

  it('rejects a Release asset redirect outside the exact GitHub host allow-list', async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-release-update-'))
    const release = releaseFixture('0.1.0-beta.2')
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(release), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: 'https://127.0.0.1/private' },
      }))

    await expect(downloadReleaseUpdate({
      tagName: 'v0.1.0-beta.2',
      currentVersion: '0.1.0-beta.1',
      destinationRoot: tempRoot,
      fetchImpl,
    })).rejects.toMatchObject({ code: 'UPDATE_DOWNLOAD_FAILED' })
  })

  it('rejects oversized or non-canonical tags before making a GitHub request', async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phd-atlas-release-update-'))
    const fetchImpl = vi.fn()

    await expect(downloadReleaseUpdate({
      tagName: `v1.0.0-${'a'.repeat(200)}`,
      currentVersion: '0.1.0-beta.1',
      destinationRoot: tempRoot,
      fetchImpl,
    })).rejects.toMatchObject({ code: 'UPDATE_RELEASE_NOT_FOUND' })
    await expect(downloadReleaseUpdate({
      tagName: 'v1.0.0-beta.01',
      currentVersion: '0.1.0-beta.1',
      destinationRoot: tempRoot,
      fetchImpl,
    })).rejects.toMatchObject({ code: 'UPDATE_RELEASE_NOT_FOUND' })

    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
