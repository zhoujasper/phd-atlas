import { describe, expect, it, vi } from 'vitest'
import {
  hydrateApplicationSchoolLogo,
  readReferencedSchoolLogoAssets,
  referencedSchoolLogoAssetKeys,
  SCHOOL_LOGO_ASSET_QUERY_BATCH_SIZE,
} from './storage.js'

describe('application school logo asset reads', () => {
  it('collects only unique logo assets that still need hydration', () => {
    const unresolvedKey = 'a'.repeat(64)
    const embeddedKey = 'b'.repeat(64)
    const payloads = [
      { school: { logo: { assetKey: unresolvedKey } } },
      { school: { logo: { assetKey: unresolvedKey } } },
      { school: { logo: { assetKey: embeddedKey, dataUrl: 'data:image/png;base64,embedded' } } },
      { school: { logo: { assetKey: '' } } },
      { school: { logo: { assetKey: 42 } } },
      { school: {} },
    ]

    expect(referencedSchoolLogoAssetKeys(payloads)).toEqual([unresolvedKey])
  })

  it('does not touch the asset table when no application needs a stored logo', () => {
    const database = {
      prepare: vi.fn(() => {
        throw new Error('school_logo_assets must not be scanned')
      }),
    }
    const payloads = [
      { school: { name: 'No logo' } },
      { school: { logo: { dataUrl: 'data:image/png;base64,inline' } } },
      { school: { logo: { assetKey: 'c'.repeat(64), dataUrl: 'data:image/png;base64,inline' } } },
    ]

    expect(readReferencedSchoolLogoAssets(database, payloads)).toEqual(new Map())
    expect(database.prepare).not.toHaveBeenCalled()
  })

  it('queries only referenced keys in SQLite-safe batches and leaves a large unused asset unread', () => {
    const referencedKeys = Array.from(
      { length: SCHOOL_LOGO_ASSET_QUERY_BATCH_SIZE + 1 },
      (_, index) => index.toString(16).padStart(64, '0'),
    )
    const unusedKey = 'f'.repeat(64)
    const largeUnusedDataUrl = `data:image/png;base64,${'A'.repeat(4 * 1024 * 1024)}`
    const availableAssets = new Map([
      ...referencedKeys.map((key, index) => [key, `data:image/png;base64,referenced-${index}`]),
      [unusedKey, largeUnusedDataUrl],
    ])
    const preparedSql = []
    const queriedBatches = []
    const database = {
      prepare: vi.fn((sql) => {
        preparedSql.push(sql)
        return {
          all: (...assetKeys) => {
            queriedBatches.push(assetKeys)
            return assetKeys.map((assetKey) => ({
              asset_key: assetKey,
              data_url: availableAssets.get(assetKey),
            }))
          },
        }
      }),
    }

    const assets = readReferencedSchoolLogoAssets(
      database,
      referencedKeys.map((assetKey) => ({ school: { logo: { assetKey } } })),
    )

    expect(database.prepare).toHaveBeenCalledTimes(2)
    expect(preparedSql.every((sql) => (
      sql.startsWith('SELECT asset_key, data_url FROM school_logo_assets WHERE asset_key IN (')
    ))).toBe(true)
    expect(queriedBatches.map((batch) => batch.length)).toEqual([
      SCHOOL_LOGO_ASSET_QUERY_BATCH_SIZE,
      1,
    ])
    expect(queriedBatches.flat()).toEqual(referencedKeys)
    expect(queriedBatches.flat()).not.toContain(unusedKey)
    expect(assets.size).toBe(referencedKeys.length)
    expect(assets.has(unusedKey)).toBe(false)
    expect([...assets.values()]).not.toContain(largeUnusedDataUrl)
  })

  it('preserves logo hydration output and never replaces an embedded data URL', () => {
    const assetKey = 'd'.repeat(64)
    const storedDataUrl = 'data:image/png;base64,stored'
    const unresolvedPayload = {
      school: {
        name: 'Hydrated University',
        logo: {
          assetKey,
          source: 'website',
          sourceUrl: 'https://example.edu/logo.png',
        },
      },
      program: 'PhD',
    }
    const assets = new Map([[assetKey, storedDataUrl]])

    expect(hydrateApplicationSchoolLogo(unresolvedPayload, assets)).toEqual({
      ...unresolvedPayload,
      school: {
        ...unresolvedPayload.school,
        logo: {
          ...unresolvedPayload.school.logo,
          dataUrl: storedDataUrl,
        },
      },
    })
    expect(unresolvedPayload.school.logo.dataUrl).toBeUndefined()

    const embeddedPayload = {
      school: {
        logo: {
          assetKey,
          dataUrl: 'data:image/png;base64,embedded',
        },
      },
    }
    expect(hydrateApplicationSchoolLogo(embeddedPayload, assets)).toBe(embeddedPayload)
    expect(hydrateApplicationSchoolLogo(unresolvedPayload, new Map())).toBe(unresolvedPayload)
  })
})
