import { describe, expect, it } from 'vitest'
import dossierSource from './DossierView.tsx?raw'

describe('dossier upload name policy', () => {
  it('records the source extension when a file enters the editable queue', () => {
    expect(dossierSource).toMatch(/extension:\s*getUploadFileExtension\(file\.name\)/)
    expect(dossierSource).toContain('draftFile.extension')
  })

  it('normalizes an extensionless edited name on blur before submission', () => {
    expect(dossierSource).toMatch(
      /onBlur=\{\(\) =>[\s\S]*?buildUploadFileName\([\s\S]*?item\.name,[\s\S]*?item\.extension,[\s\S]*?\)\s*\)/,
    )
  })
})
