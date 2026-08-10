import { describe, expect, it } from 'vitest'
import workspaceStyles from '../../index.css?raw'
import mobileStyles from '../../styles/mobile.css?raw'
import dossierSource from './DossierView.tsx?raw'

const normalizedWorkspaceStyles = workspaceStyles.replace(/\r\n/g, '\n')
const normalizedMobileStyles = mobileStyles.replace(/\r\n/g, '\n')

describe('dossier attachment row actions', () => {
  it('renders the three requested file actions with visible labels', () => {
    const actionBlock = dossierSource.match(
      /<div className="checklist-attachment-row-actions">[\s\S]*?<\/div>/,
    )?.[0] ?? ''

    expect(actionBlock.match(/className="checklist-attachment-action"/g)).toHaveLength(2)
    expect(actionBlock.match(/className="checklist-attachment-action checklist-delete-btn"/g)).toHaveLength(1)
    expect(actionBlock).toContain("tx('filePreview.preview')")
    expect(actionBlock).toContain("tx('dossier.download')")
    expect(actionBlock).toContain("tx('dossier.remove')")
    expect(actionBlock).not.toContain("tx('dossier.renameFile'")
  })

  it('keeps the desktop actions compact and borderless with a keyboard focus cue', () => {
    expect(normalizedWorkspaceStyles).toMatch(
      /\.checklist-attachment-action\s*\{[^}]*height:\s*28px;[^}]*border:\s*0;[^}]*background:\s*transparent;/s,
    )
    expect(normalizedWorkspaceStyles).toMatch(
      /\.checklist-attachment-action:focus-visible\s*\{[^}]*outline:\s*none;[^}]*box-shadow:\s*0 0 0 2px var\(--accent-ring\);/s,
    )
  })

  it('collapses labels to accessible icon actions on phones', () => {
    expect(normalizedMobileStyles).toMatch(
      /\.checklist-attachment-row-actions \.checklist-attachment-action\s*\{[^}]*width:\s*28px;[^}]*min-width:\s*28px;[^}]*padding:\s*0;/s,
    )
    expect(normalizedMobileStyles).toMatch(
      /\.checklist-attachment-row-actions \.checklist-attachment-action > span\s*\{[^}]*position:\s*absolute;[^}]*width:\s*1px;[^}]*overflow:\s*hidden;/s,
    )
  })
})
