import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { phdApi, type SharedApplicationPayload } from '../../api/phdApi'
import englishDossier from '../../i18n/en/dossier.json'
import englishShare from '../../i18n/en/share.json'
import englishShareViewer from '../../i18n/en/shareViewer.json'
import { getDict, registerLanguage, t as translate, tpl } from '../../i18n'
import { I18nContext } from '../hooks/useI18n'
import { ShareViewer } from './ShareViewer'
import { shareSectionsToDetailTabs, sharedPayloadToApplication } from './shareViewerModel'

beforeAll(() => {
  registerLanguage('en', englishDossier, 'dossier')
  registerLanguage('en', englishShare, 'share')
  registerLanguage('en', englishShareViewer, 'shareViewer')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function sharedPayload(section: 'materials' | 'tasks'): SharedApplicationPayload {
  return {
    permission: 'upload',
    sections: [section],
    school: { name: 'Example University', country: 'United Kingdom', website: 'https://example.edu' },
    professor: {
      english: 'Professor Example',
      email: 'professor@example.edu',
      homepage: 'https://example.edu/professor',
      research: 'Human-computer interaction',
    },
    program: 'Computer Science PhD',
    status: 'Preparing',
    deadline: '2026-12-01',
    materials: section === 'materials'
      ? [{ id: 'material-1', name: 'Research proposal', type: 'Document', status: 'Draft', details: 'PDF preferred', uploadReserved: true }]
      : [],
    tasks: section === 'tasks'
      ? [{ id: 'task-1', title: 'Confirm references', due: '2026-11-01', done: false, details: 'Attach reference list', uploadReserved: true }]
      : [],
  }
}

function fullViewPayload(): SharedApplicationPayload {
  return {
    permission: 'view',
    sections: ['overview', 'materials', 'tasks', 'communications', 'funding', 'timeline', 'versions'],
    school: { name: 'Shared College', country: 'Canada', website: 'https://shared.example.edu' },
    professor: {
      english: 'Prof. Ada',
      chinese: '艾达',
      email: 'ada@shared.example.edu',
      homepage: 'https://shared.example.edu/ada',
      research: 'Systems',
    },
    program: 'PhD in Computing',
    status: 'Preparing',
    deadline: '2026-11-15',
    progress: 40,
    priority: 70,
    materials: [{ id: 'm1', name: 'CV', type: 'Document', status: 'Ready', version: 'v1', updatedAt: '2026-01-01' }],
    tasks: [{ id: 't1', title: 'Polish CV', due: '2026-10-01', done: false }],
    communications: [],
    scholarships: [],
    fees: [],
    timeline: [{ id: 'e1', title: 'Started', date: '2026-01-01', note: 'Kickoff' }],
    versions: [{ id: 'v1', file: 'cv.pdf', author: 'Owner', createdAt: '2026-01-02' }],
  }
}

function renderViewer(payload: SharedApplicationPayload) {
  vi.spyOn(phdApi, 'getSharedApplication').mockResolvedValue(payload)
  return render(
    <I18nContext.Provider value={{
      lang: 'en',
      t: getDict('en'),
      format: tpl,
      tx: (path, fallback) => translate('en', path, fallback),
    }}>
      <ShareViewer token="shared-token" />
    </I18nContext.Provider>,
  )
}

describe('share section mapping helpers', () => {
  it('maps share sections onto dossier tabs', () => {
    expect(shareSectionsToDetailTabs(['overview', 'materials', 'tasks', 'communications', 'funding', 'timeline', 'versions']))
      .toEqual(['dossier', 'materials', 'mail', 'funding', 'timeline'])
    expect(shareSectionsToDetailTabs(['tasks'])).toEqual(['materials'])
    expect(shareSectionsToDetailTabs(['versions'])).toEqual([])
  })

  it('maps shared payload into an application record', () => {
    const record = sharedPayloadToApplication(fullViewPayload())
    expect(record.school.name).toBe('Shared College')
    expect(record.materials[0]?.name).toBe('CV')
    expect(record.tasks[0]?.title).toBe('Polish CV')
    expect(record.ownerId).toBe('share-owner')
  })
})

describe('ShareViewer upload hub', () => {
  it.each([
    ['materials', 'Research proposal', 'PDF preferred'],
    ['tasks', 'Confirm references', 'Attach reference list'],
  ] as const)('shows a dedicated %s checklist with requirements and dropzone', async (section, itemName, details) => {
    renderViewer(sharedPayload(section))

    expect(await screen.findByText(itemName)).toBeInTheDocument()
    expect(screen.getByText(details)).toBeInTheDocument()
    expect(document.querySelector('.share-upload-mode')).toBeInTheDocument()
    expect(document.querySelector('.share-upload-item')).toBeInTheDocument()
    expect(document.querySelector('.file-dropzone')).toBeInTheDocument()
    expect(document.querySelector('.share-upload-item-limits')).toBeInTheDocument()
  })

  it('shows only materials and tasks reserved for shared upload', async () => {
    renderViewer({
      ...sharedPayload('materials'),
      sections: ['materials', 'tasks'],
      materials: [
        { id: 'material-reserved', name: 'Reserved proposal', type: 'Document', status: 'Draft', uploadReserved: true },
        { id: 'material-private', name: 'Private CV', type: 'Document', status: 'Ready', uploadReserved: false },
      ],
      tasks: [
        { id: 'task-reserved', title: 'Reserved reference list', due: '2026-11-01', done: false, uploadReserved: true },
        { id: 'task-private', title: 'Private follow-up', due: '2026-11-02', done: false, uploadReserved: false },
      ],
    })

    expect(await screen.findByText('Reserved proposal')).toBeInTheDocument()
    expect(screen.getByText('Reserved reference list')).toBeInTheDocument()
    expect(screen.queryByText('Private CV')).not.toBeInTheDocument()
    expect(screen.queryByText('Private follow-up')).not.toBeInTheDocument()
    expect(document.querySelectorAll('.share-upload-item')).toHaveLength(2)
  })
})

describe('ShareViewer dossier workspace', () => {
  it('renders dossier + inspector chrome for view links', async () => {
    renderViewer(fullViewPayload())

    await waitFor(() => {
      expect(document.querySelector('.share-workspace')).toBeInTheDocument()
      expect(document.querySelector('.dossier-pane')).toBeInTheDocument()
      expect(document.querySelector('.inspector-pane')).toBeInTheDocument()
    })
    expect(screen.getAllByText('Shared College').length).toBeGreaterThan(0)
    expect(document.querySelector('.share-permission-chip.is-view')).toBeInTheDocument()
    expect(document.querySelector('.dossier-readonly-banner')).toBeInTheDocument()
    expect(document.querySelector('.dossier-fieldset.is-readonly')).toBeInTheDocument()
    // No owner share/delete chrome on shared pages.
    expect(screen.queryByRole('button', { name: /^Share$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Delete$/i })).not.toBeInTheDocument()
  })

  it('renders edit workspace without the upload-only hub', async () => {
    renderViewer({ ...fullViewPayload(), permission: 'edit' })

    await waitFor(() => {
      expect(document.querySelector('.share-workspace')).toBeInTheDocument()
      expect(document.querySelector('.dossier-pane')).toBeInTheDocument()
    })
    expect(screen.getAllByText('Shared College').length).toBeGreaterThan(0)
    expect(document.querySelector('.share-upload-mode')).not.toBeInTheDocument()
    expect(document.querySelector('.dossier-readonly-banner')).not.toBeInTheDocument()
    expect(document.querySelector('.share-permission-chip.is-edit')).toBeInTheDocument()
  })

  it('removes the inspector from compact view-only shared links', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })))
    renderViewer(fullViewPayload())

    await waitFor(() => {
      expect(document.querySelector('.share-workspace')).toBeInTheDocument()
    })
    expect(document.querySelector('.inspector-pane')).not.toBeInTheDocument()
  })
})
