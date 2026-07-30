import { describe, expect, it } from 'vitest'
import coreStyles from '../../index.css?raw'
import dossierSource from './DossierView.tsx?raw'

describe('dossier research direction spacing', () => {
  it('keeps a small dedicated gap between the required caption and editor', () => {
    expect(dossierSource).toContain(
      'className="textarea-field dossier-research-direction-field"',
    )
    expect(coreStyles).toMatch(
      /\.dossier-research-direction-field\s*\{[^}]*gap:\s*8px/s,
    )
  })
})
