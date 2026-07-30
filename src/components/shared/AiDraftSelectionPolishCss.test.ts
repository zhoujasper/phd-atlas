import { describe, expect, it } from 'vitest'
import panelSource from './AiDraftPanel.tsx?raw'
import dossierSource from '../screens/DossierView.tsx?raw'
import aiStyles from '../../styles/ai.css?raw'

describe('AI draft attachment automation', () => {
  it('keeps source authorization and explanatory help without a nested manual picker', () => {
    expect(panelSource).toContain('<InfoTooltip content={tx(`dossier.aiGrantHints.${key}`)}')
    expect(panelSource).toContain('<SwitchControl checked={grants[key]}')
    expect(panelSource).not.toContain('<small>{tx(`dossier.aiGrantHints.${key}`)}</small>')
    expect(panelSource).not.toContain('profileMaterialsExpanded')
    expect(panelSource).not.toContain('FileDropzone')
    expect(panelSource).not.toContain('AnimatedCheckmark')
    expect(panelSource).not.toContain('ai-draft-output-attachments')
  })

  it('keeps the inspector as the only vertical scroll owner and removes dead picker styles', () => {
    expect(aiStyles).toMatch(
      /\.inspector-pane\.ai-inspector-active\s*\{[^}]*overflow:\s*hidden;[^}]*padding:\s*0;/s,
    )
    expect(aiStyles).toMatch(
      /\.ai-inspector-slot\s*\{[^}]*overflow-y:\s*auto;[^}]*padding-bottom:\s*12px;[^}]*background:\s*var\(--canvas\);/s,
    )
    expect(aiStyles).toMatch(
      /\.ai-inspector-slot \.ai-draft-panel\s*\{[^}]*min-height:\s*0;[^}]*background:\s*var\(--surface\);/s,
    )
    expect(aiStyles).not.toContain('.ai-profile-material')
    expect(aiStyles).not.toContain('.ai-output-attachment')
    expect(aiStyles).not.toContain('.ai-draft-extra-attachments')
    expect(aiStyles).toMatch(/\.tag-chip\.ai-tool-attached\s*\{[^}]*animation:\s*composer-ai-attachment-arrive/s)
  })

  it('animates the left composer while AI streams, settles, restores, and revises attachments', () => {
    expect(dossierSource).toContain('onGeneratingChange={handleEmailAiGeneratingChange}')
    expect(dossierSource).toContain('composer-field composer-subject-field')
    expect(dossierSource).toContain('aria-busy={emailAiGenerating || emailInsertAnimating}')
    expect(dossierSource).toContain('key={`${att.id}:${att.aiMotionRevision ?? 0}`}')
    expect(dossierSource).toContain("aiMotionKind: 'update' as const")

    expect(aiStyles).toMatch(
      /\.composer-subject-field\.ai-writing \.composer-subject-control::after\s*\{[^}]*animation:\s*composer-ai-subject-sweep/s,
    )
    expect(aiStyles).toMatch(
      /\.composer-body\.ai-writing::after\s*\{[^}]*animation:\s*composer-ai-body-rail/s,
    )
    expect(aiStyles).toMatch(
      /\.tag-chip\.ai-tool-attached\.ai-tool-updated\s*\{[^}]*animation-name:\s*composer-ai-attachment-update/s,
    )
    expect(aiStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.composer-subject-control::after,[\s\S]*?\.composer-body::after,[\s\S]*?animation:\s*none !important;/,
    )
  })
})
