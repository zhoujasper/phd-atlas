import { describe, expect, it } from 'vitest'
import dossierStyles from '../../index.css?raw'

const normalizedStyles = dossierStyles.replace(/\r\n/g, '\n')

describe('dossier upload file row styling', () => {
  it('keeps the file row compact and uses a single underline for the name', () => {
    expect(normalizedStyles).toMatch(
      /\.checklist-upload-file-row\s*\{[^}]*grid-template-columns:\s*20px minmax\(0, 1fr\) 26px;[^}]*gap:\s*7px;/s,
    )
    expect(normalizedStyles).toMatch(
      /\.checklist-upload-file-row input\s*\{[^}]*height:\s*28px;[^}]*border:\s*0;[^}]*border-bottom:\s*1px solid var\(--border\);/s,
    )
    expect(normalizedStyles).toMatch(
      /\.checklist-upload-name-preview\s*\{[^}]*border:\s*0;[^}]*border-bottom:\s*1px solid var\(--border\);/s,
    )
  })

  it('transitions the underline to the theme accent when the name is focused', () => {
    expect(normalizedStyles).toMatch(
      /\.checklist-upload-file-row input\s*\{[^}]*border-bottom-color 180ms var\(--ease-out\)/s,
    )
    expect(normalizedStyles).toMatch(
      /\.checklist-upload-file-row input:focus\s*\{[^}]*border-bottom-color:\s*var\(--accent\);[^}]*box-shadow:\s*0 1px 0 var\(--accent\);/s,
    )
  })

  it('removes the delete button frame while retaining a quiet hover/focus cue', () => {
    expect(normalizedStyles).toMatch(
      /\.checklist-upload-file-row > \.checklist-icon-control\s*\{[^}]*width:\s*26px;[^}]*height:\s*26px;[^}]*border:\s*0;[^}]*background:\s*transparent;/s,
    )
    expect(normalizedStyles).toContain('.checklist-upload-file-row > .checklist-icon-control:hover')
  })
})
