import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  collectDesktopReleaseArtifacts,
  normalizeDesktopReleasePlatform,
  prepareDesktopReleaseArtifacts,
} from './prepare-release-artifacts.mjs'

describe('desktop release artifacts', () => {
  it('normalizes only supported native runner platforms', () => {
    expect(normalizeDesktopReleasePlatform('win32')).toBe('windows')
    expect(normalizeDesktopReleasePlatform('darwin')).toBe('macos')
    expect(() => normalizeDesktopReleasePlatform('linux')).toThrow(/Unsupported/)
  })

  it('creates checksum pairs for the complete Windows artifact set', async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'phd-atlas-desktop-assets-'))
    try {
      await writeFile(path.join(outputDirectory, 'PhDAtlas-0.1.3-win-x64-setup.exe'), 'setup')
      await writeFile(path.join(outputDirectory, 'PhDAtlas-0.1.3-win-x64-portable.exe'), 'portable')
      const receipt = await prepareDesktopReleaseArtifacts({
        outputDirectory,
        platform: 'windows',
        version: '0.1.3',
      })
      expect(receipt.arch).toBe('x64')
      expect(receipt.artifacts.map((entry) => entry.name)).toEqual([
        'PhDAtlas-0.1.3-win-x64-portable.exe',
        'PhDAtlas-0.1.3-win-x64-setup.exe',
      ])
      const checksum = await readFile(
        path.join(outputDirectory, 'PhDAtlas-0.1.3-win-x64-setup.exe.sha256'),
        'utf8',
      )
      expect(checksum).toMatch(/^[0-9a-f]{64}  PhDAtlas-0\.1\.3-win-x64-setup\.exe\n$/u)
    } finally {
      await rm(outputDirectory, { recursive: true, force: true })
    }
  })

  it('fails when one macOS target or a single native architecture is missing', async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'phd-atlas-desktop-assets-'))
    try {
      await writeFile(path.join(outputDirectory, 'PhDAtlas-0.1.3-mac-arm64.dmg'), 'dmg')
      await expect(collectDesktopReleaseArtifacts({
        outputDirectory,
        platform: 'macos',
        version: '0.1.3',
      })).rejects.toThrow(/Expected dmg and zip/)
      await writeFile(path.join(outputDirectory, 'PhDAtlas-0.1.3-mac-x64.zip'), 'zip')
      await expect(collectDesktopReleaseArtifacts({
        outputDirectory,
        platform: 'macos',
        version: '0.1.3',
      })).rejects.toThrow(/Expected one macos desktop architecture/)
    } finally {
      await rm(outputDirectory, { recursive: true, force: true })
    }
  })
})
