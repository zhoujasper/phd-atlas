import { describe, expect, it } from 'vitest'
import viteConfig from '../vite.config.ts'

describe('Vite workspace isolation', () => {
  it('only scans the application HTML entry for dependencies', () => {
    expect(viteConfig.optimizeDeps?.entries).toEqual(['index.html'])
  })

  it('does not watch disposable browser and test artifacts', () => {
    expect(viteConfig.server?.watch?.ignored).toContain('**/logs/tmp/**')
  })

  it('uses one deterministic development port', () => {
    expect(viteConfig.server?.port).toBe(5173)
    expect(viteConfig.server?.strictPort).toBe(true)
  })
})
