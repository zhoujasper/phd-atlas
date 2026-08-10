import { describe, expect, it } from 'vitest'
import coreStyles from '../../index.css?raw'
import marketingStyles from '../../styles/marketing.css?raw'
import mobileStyles from '../../styles/mobile.css?raw'
import surfacePolishStyles from '../../styles/surface-polish.css?raw'
import selectSource from './Select.tsx?raw'

const stylesheetModules = import.meta.glob('../../**/*.css', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>

describe('system control density and radius contract', () => {
  it('keeps the shared radius scale rounded but capped', () => {
    expect(coreStyles).toMatch(
      /--radius-xs:\s*3px;[\s\S]*?--radius-sm:\s*5px;[\s\S]*?--radius:\s*6px;[\s\S]*?--radius-lg:\s*8px;[\s\S]*?--radius-xl:\s*10px;[\s\S]*?--radius-2xl:\s*12px;[\s\S]*?--radius-pill:\s*10px;/,
    )

    const allStyles = Object.values(stylesheetModules).join('\n')
    expect(allStyles).not.toMatch(/border-radius:\s*(?:1[3-9]|[2-9]\d+|[1-9]\d{2,})px\b/)
  })

  it('keeps the shared switch track concentric with its circular thumb', () => {
    expect(coreStyles).toMatch(
      /\.switch-control\s*\{[^}]*height:\s*24px;[^}]*border-radius:\s*var\(--radius-2xl\)\s*!important;/s,
    )
    expect(coreStyles).toMatch(
      /\.switch-control span\s*\{[^}]*width:\s*20px;[^}]*height:\s*20px;[^}]*border-radius:\s*50%;/s,
    )
  })

  it('uses one compact desktop action scale across shared button variants', () => {
    expect(coreStyles).toMatch(
      /--action-height-compact:\s*28px;[\s\S]*?--action-height:\s*30px;[\s\S]*?--action-height-prominent:\s*34px;/,
    )
    expect(coreStyles).toMatch(
      /\.primary-action\s*\{[^}]*min-height:\s*var\(--action-height\)[^}]*padding:\s*0 var\(--action-padding-inline\)[^}]*border-radius:\s*var\(--radius\)/s,
    )
    expect(coreStyles).toMatch(
      /\.quiet-action\s*\{[^}]*min-height:\s*var\(--action-height-compact\)[^}]*padding:\s*0 var\(--action-padding-inline-compact\)[^}]*border-radius:\s*var\(--radius\)/s,
    )
  })

  it('normalizes adjacent semantic actions without flattening the action hierarchy', () => {
    expect(surfacePolishStyles).toContain('button.secondary-action')
    expect(surfacePolishStyles).toMatch(
      /\) > :is\([\s\S]*?button\.primary-action,[\s\S]*?button\.secondary-action,[\s\S]*?button\.quiet-action,[\s\S]*?button\.danger-action,[\s\S]*?button\.warning-action,[\s\S]*?button\.ghost-action[\s\S]*?\)\s*\{[^}]*min-height:\s*var\(--action-height\)[^}]*padding-inline:\s*var\(--action-padding-inline\)/s,
    )
    expect(surfacePolishStyles).not.toMatch(
      /Adjacent text actions[\s\S]*?height:\s*32px/,
    )
  })

  it('uses one native and composed field scale', () => {
    expect(coreStyles).toMatch(
      /--field-height-compact:\s*32px;[\s\S]*?--field-height:\s*36px;/,
    )
    expect(coreStyles).toMatch(
      /input,\s*select\s*\{[^}]*height:\s*var\(--field-height\)/s,
    )
    expect(coreStyles).toMatch(
      /\.custom-select-trigger\s*\{[^}]*min-height:\s*var\(--field-height\)/s,
    )
    expect(selectSource).toContain("size === 'small' ? 'var(--field-height-compact)' : 'var(--field-height)'")
  })

  it('does not give one control rule conflicting explicit heights', () => {
    const violations: string[] = []
    for (const [path, styles] of Object.entries(stylesheetModules)) {
      for (const match of styles.matchAll(/([^{}]+)\{([^{}]*)\}/gs)) {
        const selector = match[1]?.trim() ?? ''
        const declarations = match[2] ?? ''
        if (!/(button|input|select|action|trigger|control|picker|toolbar)/i.test(selector)) continue
        const height = declarations.match(/^\s*height:\s*(\d+)px/im)?.[1]
        const minHeight = declarations.match(/^\s*min-height:\s*(\d+)px/im)?.[1]
        if (height && minHeight && height !== minHeight) {
          violations.push(`${path}: ${selector.replace(/\s+/g, ' ')} (${height}px/${minHeight}px)`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('keeps the signed-out and Pro CTAs emphasized without restoring tall capsules', () => {
    expect(marketingStyles).toMatch(
      /\.auth-marketing-primary,\s*\.auth-marketing-secondary\s*\{[^}]*min-height:\s*var\(--action-height-prominent\)[^}]*padding:\s*0 var\(--action-padding-inline\)[^}]*border-radius:\s*var\(--radius\)/s,
    )
    expect(marketingStyles).toMatch(
      /\.upgrade-experience \.upgrade-primary-action,\s*\.upgrade-experience \.upgrade-plan-action\s*\{[^}]*min-height:\s*var\(--action-height-prominent\)[^}]*padding:\s*0 var\(--action-padding-inline\)[^}]*border-radius:\s*var\(--radius\)/s,
    )
  })

  it('retains the existing compact mobile action override', () => {
    expect(mobileStyles).toMatch(
      /body button:is\(\.primary-action,\s*\.secondary-action,\s*\.quiet-action,\s*\.danger-action\)\s*\{[^}]*min-height:\s*32px !important[^}]*padding-inline:\s*10px[^}]*border-radius:\s*var\(--radius-sm\)/s,
    )
  })

  it('removes unthemeable native number spinners across browser engines', () => {
    expect(coreStyles).toMatch(
      /input\[type="number"\]\s*\{[^}]*appearance:\s*textfield;[^}]*-moz-appearance:\s*textfield;/s,
    )
    expect(coreStyles).toMatch(
      /input\[type="number"\]::-(?:webkit)-inner-spin-button,\s*input\[type="number"\]::-(?:webkit)-outer-spin-button\s*\{[^}]*margin:\s*0;[^}]*-webkit-appearance:\s*none;[^}]*appearance:\s*none;/s,
    )
  })
})
