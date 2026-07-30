import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  matchSchoolLogoCatalog,
  resolveSchoolLogoCatalogAsset,
  schoolLogoCatalogInfo,
} from './schoolLogoCatalog.js'

const SERVER_ROOT = dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(readFileSync(
  resolve(SERVER_ROOT, 'school-logo-catalog', 'catalog.json'),
  'utf8',
))

describe('school logo catalog', () => {
  it('ships at least 225 distinct bounded square-ready PNG marks', () => {
    expect(manifest.entryCount).toBeGreaterThanOrEqual(225)
    expect(manifest.assetCount).toBeGreaterThanOrEqual(225)
    expect(manifest.entries).toHaveLength(manifest.entryCount)
    expect(new Set(manifest.entries.map((entry) => entry.asset)).size).toBe(manifest.assetCount)
    expect(readdirSync(resolve(SERVER_ROOT, 'school-logo-catalog', 'assets'))).toHaveLength(
      manifest.assetCount,
    )
    expect(schoolLogoCatalogInfo()).toMatchObject({
      version: 'builtin-school-logo-v1',
      entryCount: manifest.entryCount,
    })

    const contentHashes = new Set()
    for (const entry of manifest.entries) {
      expect(entry.officialWebsite).toMatch(/^https:\/\//u)
      expect(entry.aliases.length).toBeGreaterThan(0)
      const bytes = readFileSync(resolve(SERVER_ROOT, 'school-logo-catalog', 'assets', entry.asset))
      contentHashes.add(createHash('sha256').update(bytes).digest('hex'))
      expect(bytes.length).toBeLessThanOrEqual(600_000)
      expect(bytes.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      )
      const width = bytes.readUInt32BE(16)
      const height = bytes.readUInt32BE(20)
      expect(width).toBeGreaterThanOrEqual(64)
      expect(height).toBeGreaterThanOrEqual(64)
      expect(width).toBeLessThanOrEqual(1_024)
      expect(height).toBeLessThanOrEqual(1_024)
      expect(width * height).toBeLessThanOrEqual(1_048_576)
    }
    expect(contentHashes.size).toBe(manifest.assetCount)
  })

  it('pins the official NUS mark and the light-surface-safe Chalmers, Technion, and Ulm marks', () => {
    expect(manifest.entries.find((entry) => entry.name === 'National University of Singapore'))
      .toMatchObject({
        assetSourceUrl: 'https://nus.edu.sg/images/default-source/identity-images/nus-vlogo-color.png',
        assetLicense: 'Official NUS vertical colour identity asset for nominative identification',
      })
    expect(manifest.entries.find((entry) => entry.name === 'Chalmers University of Technology'))
      .toMatchObject({
        assetSourceUrl: 'https://www.chalmers.se/apple-touch-icon.png',
        assetLicense: 'Official-domain identity icon presented on the official profile-purple field with compact padding',
      })
    expect(manifest.entries.find((entry) => entry.name === 'Technion – Israel Institute of Technology'))
      .toMatchObject({
        assetSourceUrl: 'https://marketing.technion.ac.il/plugging-in/download-technion/',
        assetLicense: 'Official Technion brand asset cropped to the identity symbol for compact display',
      })
    expect(manifest.entries.find((entry) => entry.name === 'Universität Ulm'))
      .toMatchObject({
        assetSourceUrl: 'https://wissenschaftsstadt.uni-ulm.de/mediawiki/index.php?title=Datei:Uni_Ulm_Logo_rund_schwarz_400x400.png',
        assetLicense: 'CC0 1.0',
      })
  })

  it.each([
    ['Stanford University Stress 002', 'Stanford University'],
    ['Université de Stanford — doctorat', 'Stanford University'],
    ['Стэнфордский университет PhD', 'Stanford University'],
    ['มหาวิทยาลัยสแตนฟอร์ด ปริญญาเอก', 'Stanford University'],
    ['MIT Stress 002', 'Massachusetts Institute of Technology'],
    ['マサチューセッツ工科大学 博士課程', 'Massachusetts Institute of Technology'],
    ['University of Toronto S. Engineering', 'University of Toronto'],
    ['多伦多大学 人工智能博士', 'University of Toronto'],
    ['토론토 대학교 박사', 'University of Toronto'],
    ['剑桥大学 计算机科学', 'University of Cambridge'],
    ['University of Amsterdam PhD', 'University of Amsterdam'],
    ['HKUST Stress 010', 'Hong Kong University of Science and Technology'],
    ['NUS Computer Science PhD', 'National University of Singapore'],
    ['新加坡国立大学 计算机博士', 'National University of Singapore'],
    ['シンガポール国立大学 博士課程', 'National University of Singapore'],
    ['싱가포르 국립대학교 박사', 'National University of Singapore'],
    ['清华大学 计算机博士', 'Tsinghua University'],
    ['NYU Computer Science PhD', 'New York University'],
    ['UCLA Bioengineering PhD', 'University of California, Los Angeles'],
    ['Georgia Tech Robotics PhD', 'Georgia Institute of Technology'],
    ['爱丁堡大学 Informatics PhD', 'The University of Edinburgh'],
    ['UW–Madison Chemistry PhD', 'University of Wisconsin-Madison'],
  ])('matches %s through normalized multilingual aliases', (schoolName, canonicalName) => {
    expect(matchSchoolLogoCatalog(schoolName)?.name).toBe(canonicalName)
  })

  it('does not treat a bare city or company name as a university match', () => {
    expect(matchSchoolLogoCatalog('Cambridge Analytica')).toBeNull()
    expect(matchSchoolLogoCatalog('Toronto')).toBeNull()
  })

  it('returns the bundled mark without a network request', async () => {
    const resolved = await resolveSchoolLogoCatalogAsset('多倫多大學 PhD')
    expect(resolved).toMatchObject({
      found: true,
      catalogHit: true,
      candidateKind: 'builtin-site-icon-v1',
      websiteUrl: 'https://www.utoronto.ca/',
    })
    expect(resolved.dataUrl).toMatch(/^data:image\/png;base64,/u)
  })
})
