import { describe, expect, it } from 'vitest'
import dossierSource from './DossierView.tsx?raw'
import workspaceStyles from '../../index.css?raw'
import mobileStyles from '../../styles/mobile.css?raw'

const normalizedWorkspaceStyles = workspaceStyles.replace(/\r\n/g, '\n')
const normalizedMobileStyles = mobileStyles.replace(/\r\n/g, '\n')

describe('desktop checklist filter layout', () => {
  it('keeps the three material dropdowns on one desktop row without changing the task grid', () => {
    expect(dossierSource).toContain('className="checklist-detail-grid checklist-material-fields"')
    expect(normalizedWorkspaceStyles).toMatch(
      /\.checklist-detail-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s,
    )
    expect(normalizedWorkspaceStyles).toMatch(
      /\.checklist-material-fields\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/s,
    )
  })

  it('keeps the sort control from stealing the task filter row at compact desktop widths', () => {
    expect(normalizedWorkspaceStyles).toMatch(
      /\.checklist-tool-group \.custom-select-root\s*\{[^}]*min-width:\s*136px;[^}]*flex:\s*1 1 136px;/s,
    )
  })

  it('lets the phone layout override the desktop minimum cleanly', () => {
    expect(normalizedMobileStyles).toMatch(
      /\.checklist-tool-group \.custom-select-root\s*\{[^}]*min-width:\s*0;/s,
    )
    expect(normalizedMobileStyles).toMatch(
      /\.checklist-material-fields\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s,
    )
  })
})
