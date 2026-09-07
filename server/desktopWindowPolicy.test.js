import { describe, expect, it } from 'vitest'
import { desktopNavigationAllowed, desktopExternalUrlAllowed, desktopResponseHeaders } from '../desktop/windowPolicy.mjs'

describe('desktop document and navigation policy', () => {
  it('permits local PDF previews while retaining upload sandbox restrictions', () => {
    const headers = desktopResponseHeaders({ 'content-security-policy': ["sandbox; script-src 'none'"] })
    const policies = headers['Content-Security-Policy']
    expect(policies[0]).toBe("sandbox; script-src 'none'")
    expect(policies[1]).toContain("frame-src 'self' blob:")
    expect(policies[1]).toContain("font-src 'self' data: blob:")
    expect(policies[1]).not.toContain('unsafe-eval')
  })
  it('keeps the app on its exact local origin and opens user-selected web links externally', () => {
    const context = { runtimeOrigin: 'http://127.0.0.1:43210', splashPath: '/app/desktop/splash.html' }
    expect(desktopNavigationAllowed('http://127.0.0.1:43210/settings', context)).toBe(true)
    expect(desktopNavigationAllowed('file:///app/desktop/splash.html', context)).toBe(true)
    expect(desktopNavigationAllowed('http://127.0.0.1.evil.test/', context)).toBe(false)
    expect(desktopNavigationAllowed('http://127.0.0.1:56789/', context)).toBe(false)
    expect(desktopNavigationAllowed('file:///private/data.txt', context)).toBe(false)
    expect(desktopExternalUrlAllowed('https://university.example')).toBe(true)
    expect(desktopExternalUrlAllowed('mailto:supervisor@example.edu')).toBe(true)
    expect(desktopExternalUrlAllowed('javascript:alert(1)')).toBe(false)
  })
})
