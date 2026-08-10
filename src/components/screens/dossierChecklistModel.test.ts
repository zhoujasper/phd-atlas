import { describe, expect, it } from 'vitest'
import { applications } from '../../data/applications'
import {
  checklistMaterialFormatKey,
  checklistMaterialFormatLimit,
  checklistMaterialFormatSection,
  checklistMaterialTypes,
  defaultChecklistMaterialType,
  fileSizeLabel,
  inferChecklistMaterialType,
  isChecklistGroup,
  isRecommendationMaterial,
  materialStatusFilterValue,
  normalizeChecklistCustomMaterialFormats,
  normalizeRecommenders,
} from './dossierChecklistModel'

describe('dossier checklist model', () => {
  it('preserves checklist group and status-filter rules', () => {
    expect(isChecklistGroup('Core materials')).toBe(true)
    expect(isChecklistGroup('Recommendations')).toBe(false)
    expect(isChecklistGroup('Invented group')).toBe(false)
    expect(materialStatusFilterValue('Needs Review')).toBe('status:Needs Review')
  })

  it('keeps submission format separate from workflow grouping', () => {
    expect(defaultChecklistMaterialType).toBe('PDF')
    expect(checklistMaterialTypes).toEqual([
      'PDF',
      'DOCX',
      'Spreadsheet',
      'Presentation',
      'Image',
      'Online form',
      'Link',
      'Request',
      'Other',
    ])
    expect(checklistMaterialFormatSection).toEqual({
      PDF: 'files',
      DOCX: 'files',
      Spreadsheet: 'files',
      Presentation: 'files',
      Image: 'files',
      'Online form': 'workflow',
      Link: 'workflow',
      Request: 'workflow',
      Other: 'workflow',
    })
  })

  it('maps uploaded files to canonical formats by extension before MIME fallback', () => {
    expect(inferChecklistMaterialType('statement.final.PDF', 'application/octet-stream')).toBe('PDF')
    expect(inferChecklistMaterialType('cv.docx', 'application/octet-stream')).toBe('DOCX')
    expect(inferChecklistMaterialType('budget.xlsx')).toBe('Spreadsheet')
    expect(inferChecklistMaterialType('portfolio.key')).toBe('Presentation')
    expect(inferChecklistMaterialType('transcript-scan.webp')).toBe('Image')
    expect(inferChecklistMaterialType('official.url')).toBe('Link')
  })

  it('maps uploaded files by MIME and keeps unknown uploads explicit', () => {
    expect(inferChecklistMaterialType('', 'application/pdf; charset=binary')).toBe('PDF')
    expect(inferChecklistMaterialType('', 'application/msword')).toBe('DOCX')
    expect(inferChecklistMaterialType('', 'text/csv')).toBe('Spreadsheet')
    expect(inferChecklistMaterialType('', 'application/vnd.ms-powerpoint')).toBe('Presentation')
    expect(inferChecklistMaterialType('', 'image/png')).toBe('Image')
    expect(inferChecklistMaterialType('', 'text/uri-list')).toBe('Link')
    expect(inferChecklistMaterialType('archive.zip', 'application/zip')).toBe('Other')
    expect(inferChecklistMaterialType()).toBe('Other')
  })

  it('builds stable recommender rows without discarding existing data', () => {
    const material = {
      ...structuredClone(applications[0].materials[0]),
      id: 'recommendation-request',
      type: 'Request',
      name: 'Recommendation letter',
      requiredCount: 3,
      recommenders: [{ id: 'advisor', name: 'Professor Ada', contact: 'ada@example.edu' }],
    }

    expect(isRecommendationMaterial(material)).toBe(true)
    expect(normalizeRecommenders(material)).toEqual([
      {
        id: 'advisor',
        name: 'Professor Ada',
        contact: 'ada@example.edu',
        email: 'ada@example.edu',
        phone: '',
        notes: '',
        deadline: '',
        deadlineTime: '',
        reminderDate: '',
        reminderTime: '',
      },
      {
        id: 'recommendation-request-recommender-2',
        name: '',
        contact: '',
        email: '',
        phone: '',
        notes: '',
        deadline: '',
        deadlineTime: '',
        reminderDate: '',
        reminderTime: '',
      },
      {
        id: 'recommendation-request-recommender-3',
        name: '',
        contact: '',
        email: '',
        phone: '',
        notes: '',
        deadline: '',
        deadlineTime: '',
        reminderDate: '',
        reminderTime: '',
      },
    ])
  })

  it('recognizes legacy recommendation materials by canonical type, group, or name — not generic requests', () => {
    const base = structuredClone(applications[0].materials[0])

    expect(isRecommendationMaterial({ ...base, type: 'Recommendation Letter', name: 'Reference' })).toBe(true)
    expect(isRecommendationMaterial({ ...base, type: 'Document', group: 'Recommendations', name: 'Reference' })).toBe(true)
    expect(isRecommendationMaterial({ ...base, type: 'Request', group: 'Custom', name: 'Reference' })).toBe(false)
    expect(isRecommendationMaterial({ ...base, type: 'Document', group: 'Custom', name: '推荐信' })).toBe(true)
    expect(isRecommendationMaterial({ ...base, type: 'Document', group: 'Custom', name: 'Transcript' })).toBe(false)
  })

  it('preserves a recommender profile link while normalizing application slots', () => {
    const material = {
      ...structuredClone(applications[0].materials[0]),
      id: 'recommendation-linked',
      type: 'Request',
      name: 'Recommendation letter',
      requiredCount: 1,
      recommenders: [
        {
          id: 'slot-1',
          name: 'Prof. Ada',
          contact: 'ada@example.edu',
          email: 'prof.ada@identity.example.edu',
          phone: '+44 20 7946 0958',
          profileId: 'profile-ada',
        },
      ],
    }

    expect(normalizeRecommenders(material)).toEqual([
      {
        id: 'slot-1',
        name: 'Prof. Ada',
        contact: 'ada@example.edu',
        email: 'prof.ada@identity.example.edu',
        phone: '+44 20 7946 0958',
        notes: '',
        deadline: '',
        deadlineTime: '',
        reminderDate: '',
        reminderTime: '',
        profileId: 'profile-ada',
      },
    ])
  })

  it('does not discard a metadata-only recommender when the required count is lowered', () => {
    const material = {
      ...structuredClone(applications[0].materials[0]),
      id: 'recommendation-count',
      type: 'Request',
      name: 'Recommendation letter',
      requiredCount: 1,
      recommenders: [
        { id: 'slot-1', name: '', contact: '' },
        {
          id: 'slot-2',
          name: '',
          contact: '',
          notes: 'Confirm the portal process before sending.',
          deadline: '2026-11-20',
          deadlineTime: '17:30',
          reminderDate: '2026-11-10',
          reminderTime: '09:30',
        },
      ],
    }

    expect(normalizeRecommenders(material, 1)).toEqual([
      {
        id: 'slot-1',
        name: '',
        contact: '',
        email: '',
        phone: '',
        notes: '',
        deadline: '',
        deadlineTime: '',
        reminderDate: '',
        reminderTime: '',
      },
      {
        id: 'slot-2',
        name: '',
        contact: '',
        email: '',
        phone: '',
        notes: 'Confirm the portal process before sending.',
        deadline: '2026-11-20',
        deadlineTime: '17:30',
        reminderDate: '2026-11-10',
        reminderTime: '09:30',
      },
    ])
  })

  it('formats attachment sizes exactly as the checklist rows expect', () => {
    expect(fileSizeLabel()).toBe('—')
    expect(fileSizeLabel(0)).toBe('0 B')
    expect(fileSizeLabel(1024)).toBe('1.0 KB')
    expect(fileSizeLabel(12 * 1024 * 1024)).toBe('12 MB')
  })

  it('keeps the account-scoped custom format list clean and bounded', () => {
    expect(normalizeChecklistCustomMaterialFormats(undefined)).toEqual([])
    expect(normalizeChecklistCustomMaterialFormats([
      '  Portal  upload ',
      'portal upload',
      'PDF',
      'online form',
      '',
      'x'.repeat(65),
      'Sealed envelope',
    ])).toEqual(['Portal upload', 'Sealed envelope'])

    const overflowing = Array.from({ length: checklistMaterialFormatLimit + 5 }, (_, index) => `Format ${index}`)
    expect(normalizeChecklistCustomMaterialFormats(overflowing)).toHaveLength(checklistMaterialFormatLimit)
  })

  it('matches formats case-insensitively so a rename cannot fork an option', () => {
    expect(checklistMaterialFormatKey('  Portal  Upload ')).toBe('portal upload')
    expect(checklistMaterialFormatKey('PDF')).toBe('pdf')
  })
})
