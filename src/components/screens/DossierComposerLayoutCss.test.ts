import { describe, expect, it } from 'vitest'
import dossierSource from './DossierView.tsx?raw'
import dossierStyles from '../../index.css?raw'
import aiStyles from '../../styles/ai.css?raw'

describe('Dossier email composer compact layout', () => {
  it('keeps the AI trigger compact and uses a smaller corner radius', () => {
    expect(aiStyles).toMatch(
      /\.composer-ai-trigger\s*\{[^}]*min-height:\s*26px;[^}]*padding:\s*0 9px;[^}]*border-radius:\s*var\(--radius-sm\);[^}]*font-size:\s*9px;/s,
    )
    expect(aiStyles).toMatch(
      /\.composer-ai-trigger svg\s*\{[^}]*width:\s*12px;[^}]*height:\s*12px;/s,
    )
  })

  it('removes the redundant delivery status card while retaining the route', () => {
    expect(dossierSource).not.toContain('composer-delivery-head')
    expect(dossierStyles).toMatch(
      /\.composer-delivery-group\s*\{[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*transparent;/s,
    )
    expect(dossierSource).toContain('className="composer-route-info draft-route-info"')
  })

  it('uses one theme underline and a slight subject-to-body gap', () => {
    expect(dossierStyles).toMatch(
      /\.composer-subject-field\s*\{[^}]*grid-template-columns:\s*max-content minmax\(0, 1fr\);[^}]*gap:\s*8px;/s,
    )
    expect(dossierStyles).toMatch(
      /\.composer-subject-field > label\s*\{[^}]*text-align:\s*left;/s,
    )
    expect(aiStyles).toMatch(
      /\.composer-writing-fields\s*\{[^}]*display:\s*grid;[^}]*gap:\s*0;/s,
    )
    expect(aiStyles).toMatch(
      /\.composer-writing-fields > \.composer-body\s*\{[^}]*margin-block-start:\s*6px;/s,
    )
    expect(aiStyles).toMatch(
      /\.composer-ai-writing-slot\[data-present='false'\]\s*\{[^}]*block-size:\s*0;[^}]*overflow:\s*hidden;/s,
    )
    expect(aiStyles).toMatch(
      /\.composer-subject-control > input\s*\{[^}]*border:\s*0;[^}]*border-bottom:\s*1px solid var\(--border\);[^}]*border-radius:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s,
    )
    expect(aiStyles).toMatch(
      /\.composer-subject-control:focus-within > input\s*\{[^}]*border-bottom-color:\s*var\(--accent\);[^}]*box-shadow:\s*none;/s,
    )
    expect(aiStyles).not.toMatch(/\.composer-subject-control::before\s*\{/)
    expect(aiStyles).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.composer-subject-control > input,[\s\S]*?transition-duration:\s*0\.01ms !important;/s,
    )
  })

  it('keeps the note date selector in the lower-left action row', () => {
    expect(dossierSource).not.toMatch(
      /key="note"[\s\S]*?className="composer-field"[\s\S]*?tx\('dossier\.messageTime'\)/s,
    )
    expect(dossierSource).toMatch(
      /className="composer-actions note-composer-actions"[\s\S]*?className="composer-time-row note-composer-time"[\s\S]*?tx\('dossier\.messageTime'\)/s,
    )
    expect(dossierStyles).toMatch(
      /\.note-composer-actions\s*\{[^}]*justify-content:\s*space-between;/s,
    )
    expect(dossierStyles).toMatch(
      /\.note-composer-time\s*\{[^}]*width:\s*min\(100%,\s*188px\);[^}]*flex:\s*0 1 188px;/s,
    )
    expect(dossierStyles).toMatch(
      /\.note-composer-time \.date-picker-input-wrap\s*\{[^}]*border-bottom:\s*1px solid var\(--border\);[^}]*transition:[\s\S]*?border-color var\(--duration\)/s,
    )
    expect(dossierStyles).toMatch(
      /\.note-composer-time \.date-picker-input-wrap:focus-within,[\s\S]*?\.note-composer-time \.date-picker-input-wrap:has\(\.date-picker-display\[aria-expanded="true"\]\)\s*\{[^}]*border-bottom-color:\s*var\(--accent\);[^}]*box-shadow:\s*0 1px 0 var\(--accent\);/s,
    )
    expect(dossierStyles).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.note-composer-time \.date-picker-input-wrap,[\s\S]*?\.note-composer-time \.date-picker-display\s*\{[^}]*transition-duration:\s*0\.01ms;/s,
    )
    expect(dossierStyles).toMatch(
      /@media \(max-width:\s*820px\)[\s\S]*?\.note-composer-actions\s*\{[^}]*align-items:\s*center;[^}]*flex-direction:\s*row;[^}]*gap:\s*10px;/s,
    )
  })

  it('reuses one radio-semantic capsule with a compositor sliding indicator for both record modes', () => {
    expect(dossierSource.match(/<RecordDirectionToggle/g)).toHaveLength(2)
    expect(dossierSource).toMatch(
      /function RecordDirectionToggle[\s\S]*?role="radiogroup"[\s\S]*?className="record-direction-indicator"[\s\S]*?role="radio"[\s\S]*?aria-checked=/s,
    )
    expect(dossierStyles).toMatch(
      /\.record-direction-toggle\s*\{[^}]*position:\s*relative;[^}]*grid-template-columns:\s*repeat\(2,[^}]*border-radius:\s*var\(--radius-pill\);/s,
    )
    expect(dossierStyles).toMatch(
      /\.record-direction-indicator\s*\{[^}]*background:\s*var\(--accent\);[^}]*transform:\s*translate3d\(0, 0, 0\);[^}]*transform 300ms var\(--ease-fluid\);[^}]*will-change:\s*transform;/s,
    )
    expect(dossierStyles).toMatch(
      /\.record-direction-toggle\[data-active-index="1"\] \.record-direction-indicator\s*\{[^}]*transform:\s*translate3d\(100%, 0, 0\);/s,
    )
    expect(dossierStyles).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.record-direction-indicator,[\s\S]*?transition-duration:\s*0\.01ms !important;/s,
    )
  })

  it('moves the recorded email route above the writing area and places time in the lower-left footer', () => {
    const recordEmailStart = dossierSource.indexOf('{/* MODE 2: Record Email */}')
    const recordMessageStart = dossierSource.indexOf('{/* MODE 3: Record Message */}')
    const recordEmailSource = dossierSource.slice(recordEmailStart, recordMessageStart)

    expect(recordEmailSource.indexOf('record-route-info')).toBeGreaterThan(-1)
    expect(recordEmailSource.indexOf('record-route-info')).toBeLessThan(recordEmailSource.indexOf('record-subject-field'))
    expect(recordEmailSource.indexOf('record-subject-field')).toBeLessThan(recordEmailSource.indexOf('record-body'))
    expect(recordEmailSource).toMatch(
      /className="composer-actions record-composer-actions"[\s\S]*?className="composer-field record-time-field"[\s\S]*?className="primary-action"/s,
    )
    expect(dossierStyles).toMatch(
      /\.record-composer-actions\s*\{[^}]*align-items:\s*flex-end;[^}]*justify-content:\s*space-between;/s,
    )
    expect(dossierStyles).toMatch(
      /\.record-time-field\s*\{[^}]*flex:\s*1 1 360px;[^}]*max-width:\s*420px;/s,
    )
  })

  it('uses one animated theme underline for record email and message subjects', () => {
    expect(dossierSource.match(/className="record-subject-control"/g)).toHaveLength(2)
    expect(dossierStyles).toMatch(
      /\.record-subject-control > input\s*\{[^}]*border:\s*0;[^}]*border-bottom:\s*1px solid var\(--border\);[^}]*border-radius:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;[^}]*border-bottom-color 280ms var\(--ease-fluid\)/s,
    )
    expect(dossierStyles).toMatch(
      /\.record-subject-control > input:focus,[\s\S]*?\.record-subject-control > input:focus-visible\s*\{[^}]*border-bottom-color:\s*var\(--accent\);[^}]*box-shadow:\s*none;/s,
    )
    expect(dossierStyles).not.toContain('.record-subject-control::before')
    expect(dossierStyles).not.toContain('.record-subject-control::after')
  })
})
