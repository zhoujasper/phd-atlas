import { describe, expect, it } from 'vitest'
import type { ApplicationRecord } from './data/applications'
import {
  attachmentRows,
  buildUploadFileName,
  createRenamedFile,
  getUploadPresetSelection,
  resolveUploadAllowedTypes,
  sanitizeUploadName,
} from './checklistFiles'

describe('checklist file helpers', () => {
  it('sanitizes reserved filename characters and keeps compact spacing', () => {
    expect(sanitizeUploadName('  CV: final / 2026?.pdf  ')).toBe('CV- final - 2026-.pdf')
    expect(sanitizeUploadName('Research    Proposal.docx')).toBe('Research Proposal.docx')
  })

  it('builds stable multi-file names from a shared base name', () => {
    const first = { name: 'original-cv.pdf' } as File
    const second = { name: 'writing-sample.docx' } as File

    expect(buildUploadFileName(first, 'Application Packet', 0, 2, first.name)).toBe('Application Packet 1.pdf')
    expect(buildUploadFileName(second, 'Application Packet', 1, 2, second.name)).toBe('Application Packet 2.docx')
  })

  it('falls back to the individual draft file name when no base name is provided', () => {
    expect(buildUploadFileName({ name: 'raw.pdf' } as File, '', 0, 1, 'Final: CV.pdf')).toBe('Final- CV.pdf')
  })

  it('renames a File only when the final name changed', () => {
    const file = new File(['hello'], 'cv.pdf', { type: 'application/pdf', lastModified: 123 })

    expect(createRenamedFile(file, 'cv.pdf')).toBe(file)

    const renamed = createRenamedFile(file, 'cv-final.pdf')
    expect(renamed).not.toBe(file)
    expect(renamed.name).toBe('cv-final.pdf')
    expect(renamed.type).toBe('application/pdf')
    expect(renamed.lastModified).toBe(123)
  })

  it('round-trips upload type presets with custom values', () => {
    const selection = getUploadPresetSelection(['.pdf', '.doc', '.docx', '.rtf', '.txt', '.tex'])

    expect(selection.presetIds).toContain('document')
    expect(selection.customTypes).toEqual(['.tex'])
    expect(resolveUploadAllowedTypes([...selection.presetIds, 'other'], selection.customTypes.join(', '))).toEqual([
      '.pdf',
      '.doc',
      '.docx',
      '.rtf',
      '.txt',
      '.tex',
    ])
  })

  it('normalizes attachment rows from legacy current files and version history', () => {
    const material: ApplicationRecord['materials'][number] = {
      id: 'mat-1',
      name: 'Statement of Purpose',
      type: 'PDF',
      status: 'Draft',
      version: 'v2',
      updatedAt: '2026-07-08T09:00:00.000Z',
      fileId: 'file-current',
      fileName: 'sop-v2.pdf',
      fileSize: 2048,
      versions: [
        {
          id: 'version-1',
          file: 'sop-v1.pdf',
          author: 'Jasper',
          createdAt: '2026-07-07T09:00:00.000Z',
          fileId: 'file-old',
        },
      ],
    }

    expect(attachmentRows(material)).toEqual([
      expect.objectContaining({
        id: 'file-current',
        file: 'sop-v2.pdf',
        fileId: 'file-current',
        current: true,
      }),
      expect.objectContaining({
        id: 'version-1',
        file: 'sop-v1.pdf',
        fileId: 'file-old',
        current: false,
      }),
    ])
  })
})
