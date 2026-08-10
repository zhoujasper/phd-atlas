import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import viteConfig, { resolveFrontendBuiltAt } from '../vite.config.ts'

const packageMetadata = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'))
const entryBudgetSource = readFileSync(
  path.join(process.cwd(), 'tools', 'verify-build-entry-budget.mjs'),
  'utf8',
)

describe('Vite workspace isolation', () => {
  it('uses the reproducible release timestamp in frontend build metadata', () => {
    const clock = () => new Date('2030-01-02T03:04:05.000Z')

    expect(resolveFrontendBuiltAt({
      SOURCE_DATE_EPOCH: '1700000000',
    }, clock)).toBe('2023-11-14T22:13:20.000Z')
    expect(resolveFrontendBuiltAt({
      SOURCE_DATE_EPOCH: '1700000000',
      VITE_FRONTEND_BUILT_AT: '2029-02-03T04:05:06.000Z',
    }, clock)).toBe('2029-02-03T04:05:06.000Z')
    expect(resolveFrontendBuiltAt({
      SOURCE_DATE_EPOCH: 'not-an-epoch',
    }, clock)).toBe('2030-01-02T03:04:05.000Z')
  })

  it('only scans the application HTML entry for dependencies', () => {
    expect(viteConfig.optimizeDeps?.entries).toEqual(['index.html'])
    expect(viteConfig.optimizeDeps?.force).not.toBe(true)
  })

  it('unwraps the CommonJS source editor before React renders it', () => {
    expect(viteConfig.optimizeDeps?.include).toContain('react-simple-code-editor')
    expect(viteConfig.optimizeDeps?.needsInterop).toContain('react-simple-code-editor')
  })

  it('does not watch disposable browser and test artifacts', () => {
    expect(viteConfig.server?.watch?.ignored).toContain('**/logs/tmp/**')
  })

  it('uses one deterministic development port', () => {
    expect(viteConfig.server?.host).toBe('::')
    expect(viteConfig.server?.port).toBe(5173)
    expect(viteConfig.server?.strictPort).toBe(true)
  })

  it('accepts bounded local development host aliases without disabling host checks', () => {
    const allowedHosts = viteConfig.server?.allowedHosts
    expect(Array.isArray(allowedHosts)).toBe(true)
    expect(allowedHosts).toEqual(expect.arrayContaining([
      'localhost',
      'phd-atlas.local',
      'phd-atlas-dev',
    ]))
    if (process.env.COMPUTERNAME) {
      expect(allowedHosts).toContain(process.env.COMPUTERNAME.toLocaleLowerCase())
    }
  })

  it('bounds full-suite workers for back-to-back source/public release checks', () => {
    expect(viteConfig.test?.maxWorkers).toBe(2)
  })

  it('keeps route-only feature dependencies out of the initial entry graph', () => {
    const output = viteConfig.build?.rollupOptions?.output
    expect(Array.isArray(output)).toBe(false)
    expect(output?.manualChunks).toBeUndefined()

    const groups = output?.codeSplitting?.groups
    expect(Array.isArray(groups)).toBe(true)
    expect(groups?.find((group) => group.name === 'react-vendor')?.priority).toBe(40)
    expect(groups?.find((group) => group.name === 'dnd-vendor')?.entriesAware).toBe(true)
    expect(groups?.find((group) => group.name === 'markdown-vendor')?.entriesAware).toBe(true)
  })

  it('does not let the ordinary product test filter skip the workspace-memory qualification', () => {
    expect(packageMetadata.scripts['qa:workspace-memory']).toContain('--testNamePattern .')
  })

  it('fails production builds when initial JavaScript or CSS regresses past its manifest budget', () => {
    expect(packageMetadata.scripts.build).toContain('verify-build-entry-budget.mjs')
    expect(entryBudgetSource).toContain('MAX_INITIAL_JS_GZIP_BYTES')
    expect(entryBudgetSource).toContain('MAX_INITIAL_CSS_GZIP_BYTES')
    expect(entryBudgetSource).toContain('manifest[key].css')
    expect(entryBudgetSource).toContain('MAX_MOBILE_CSS_GZIP_BYTES')
    expect(entryBudgetSource).toContain('Conditional mobile stylesheet leaked back into the initial CSS graph')
    expect(entryBudgetSource).toContain('MAX_AUTHENTICATED_APP_JS_GZIP_BYTES')
    expect(entryBudgetSource).toContain('Signed-out AuthScreen leaked into the authenticated App static graph')
  })
})
