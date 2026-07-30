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
})
