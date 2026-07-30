import { describe, expect, it } from 'vitest'
import applicationPipelineStyles from '../../styles/application-pipeline.css?raw'

describe('application smart-table student avatar', () => {
  it('presents generated initials as a centered, softly tinted identity mark', () => {
    expect(applicationPipelineStyles).toMatch(
      /\.application-table-student \.user-avatar\s*\{[^}]*width:\s*28px;[^}]*height:\s*28px;[^}]*display:\s*inline-grid;[^}]*place-items:\s*center;[^}]*overflow:\s*hidden;[^}]*border:\s*1px solid color-mix\([^;]+;[^}]*border-radius:\s*var\(--radius\);[^}]*background:\s*linear-gradient\([^;]+;[^}]*color:\s*var\(--accent\);[^}]*font-weight:\s*720;[^}]*line-height:\s*1;/s,
    )
  })

  it('keeps the identity mark legible in forced-colors mode', () => {
    expect(applicationPipelineStyles).toMatch(
      /@media \(forced-colors:\s*active\)\s*\{[\s\S]*?\.application-table-student \.user-avatar\s*\{[^}]*border-color:\s*CanvasText;[^}]*background:\s*Canvas;[^}]*box-shadow:\s*none;[^}]*color:\s*CanvasText;/s,
    )
  })
})
