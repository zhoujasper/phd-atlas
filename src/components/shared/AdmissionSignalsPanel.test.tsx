import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AdmissionOutcomesResponse,
  AdmissionSignalReport,
  AdvisorSignalsResponse,
} from '../../api/phdApi'
import englishDossier from '../../i18n/en/dossier.json'
import { getDict, registerLanguage, t as translate, tpl } from '../../i18n'
import { I18nContext } from '../hooks/useI18n'
import { AdmissionSignalsPanel } from './AdmissionSignalsPanel'

const mocks = vi.hoisted(() => ({
  getAdmissionSignalReport: vi.fn(),
  refreshAdmissionSignalReport: vi.fn(),
  getAdmissionBookmarks: vi.fn(),
  createAdmissionBookmark: vi.fn(),
  deleteAdmissionBookmark: vi.fn(),
  exportAdmissionReportToPdf: vi.fn(),
}))

vi.mock('../../api/phdApi', () => ({
  phdApi: {
    getAdmissionSignalReport: mocks.getAdmissionSignalReport,
    refreshAdmissionSignalReport: mocks.refreshAdmissionSignalReport,
    getAdmissionBookmarks: mocks.getAdmissionBookmarks,
    createAdmissionBookmark: mocks.createAdmissionBookmark,
    deleteAdmissionBookmark: mocks.deleteAdmissionBookmark,
    exportAdmissionReportToPdf: mocks.exportAdmissionReportToPdf,
  },
}))

beforeAll(() => {
  registerLanguage('en', englishDossier, 'dossier')
})

beforeEach(() => {
  mocks.getAdmissionSignalReport.mockReset()
  mocks.refreshAdmissionSignalReport.mockReset()
  mocks.getAdmissionBookmarks.mockReset()
  mocks.createAdmissionBookmark.mockReset()
  mocks.deleteAdmissionBookmark.mockReset()
  mocks.exportAdmissionReportToPdf.mockReset()
  mocks.getAdmissionSignalReport.mockResolvedValue({ report: null })
  mocks.getAdmissionBookmarks.mockResolvedValue([])
  mocks.createAdmissionBookmark.mockResolvedValue('bookmark-1')
  mocks.deleteAdmissionBookmark.mockResolvedValue(undefined)
})

const outcomes: AdmissionOutcomesResponse = {
  query: { school: 'Stanford University', program: 'Computer Science PhD', year: null },
  summary: {
    total: 5,
    accepted: 3,
    rejected: 1,
    waitlisted: 1,
    interview: 0,
    pending: 0,
    unclassified: 0,
    latestDecisionAt: '2024-03-15T00:00:00.000Z',
    acceptedShare: 0.6,
  },
  cycles: [
    {
      cycle: '2024',
      total: 5,
      accepted: 3,
      rejected: 1,
      waitlisted: 1,
      interview: 0,
      pending: 0,
      unclassified: 0,
      acceptedShare: 0.6,
      latestDecisionAt: '2024-03-15T00:00:00.000Z',
    },
  ],
  outcomes: [
    {
      kind: 'gradcafe:result',
      value: {
        school: 'Stanford University',
        program: 'Computer Science PhD',
        decision: 'accepted',
        date: '2024-02-01',
      },
      sourceId: 'gradcafe-results',
      sourceUrl: 'https://www.thegradcafe.com/survey/example',
      fetchedAt: '2026-08-04T10:00:00.000Z',
      confidence: 0.85,
      match: {
        verified: true,
        confidence: 0.9,
        schoolMatch: true,
        programOverlap: 1,
        reasons: ['school-match'],
      },
    },
  ],
  unmatchedOutcomes: [
    {
      kind: 'gradcafe:result',
      value: {
        school: 'Example University',
        program: 'Bioinformatics PhD',
        decision: 'rejected',
        date: '2024-02-04',
      },
      sourceId: 'gradcafe-results',
      sourceUrl: 'https://www.thegradcafe.com/survey/other',
      fetchedAt: '2026-08-04T10:00:00.000Z',
      match: {
        verified: false,
        confidence: 0,
        schoolMatch: false,
        programOverlap: 0,
        reasons: ['school-mismatch'],
      },
    },
  ],
  officialFacts: [{
    kind: 'official-admission-fact',
    value: {
      factType: 'applications',
      label: 'Applications received',
      value: 1240,
      unit: 'people',
      year: 2024,
      statement: 'In 2024, the programme received 1,240 applications.',
      pageTitle: 'Doctoral admissions statistics',
    },
    sourceId: 'official-program-history',
    sourceUrl: 'https://www.stanford.edu/phd/admissions-statistics',
    fetchedAt: '2026-08-04T10:00:00.000Z',
    confidence: 1,
  }],
  officialPages: [{
    title: 'Doctoral admissions statistics',
    url: 'https://www.stanford.edu/phd/admissions-statistics',
    types: ['program', 'admissions'],
    fetchedAt: '2026-08-04T10:00:00.000Z',
  }],
  discussions: [
    {
      kind: 'reddit:submission',
      value: {
        title: 'Stanford CS PhD admission discussion',
        permalink: '/r/gradadmissions/comments/abc/',
      },
      sourceId: 'reddit-submissions',
      sourceUrl: 'https://www.reddit.com/r/gradadmissions/comments/abc/',
      fetchedAt: '2026-08-04T10:00:00.000Z',
      confidence: 0.9,
    },
  ],
  sources: [
    {
      id: 'official-program-history',
      name: 'Official programme evidence',
      status: 'ok',
      recordCount: 1,
      verifiedCount: 1,
    },
    {
      id: 'gradcafe-results',
      name: 'GradCafe Survey Results',
      status: 'ok',
      recordCount: 5,
      verifiedCount: 1,
    },
    { id: 'reddit-submissions', name: 'Reddit r/gradadmissions API', status: 'ok', recordCount: 1 },
  ],
  fetchedAt: '2026-08-04T10:00:00.000Z',
}

const advisor: AdvisorSignalsResponse = {
  query: { name: 'Ada Lovelace', institution: 'Stanford University' },
  funding: {
    awardCount: 1,
    projectCount: 1,
    hasPublicAward: true,
    possibleAwardCount: 1,
    possibleProjectCount: 0,
  },
  awards: [
    {
      kind: 'nsf:award',
      value: {
        title: 'Adaptive Systems',
        piName: 'Ada Lovelace',
        awardeeName: 'Stanford University',
        estimatedTotalAmt: 500000,
      },
      sourceId: 'nsf-awards',
      sourceUrl: 'https://www.nsf.gov/awardsearch/showAward?AWD_ID=123',
      apiUrl: 'https://api.nsf.gov/services/v1/awards.json?pdPIName=Ada+Lovelace',
      fetchedAt: '2026-08-04T10:00:00.000Z',
      confidence: 1,
      match: {
        verified: true,
        confidence: 1,
        nameMatch: 'exact',
        institutionMatch: true,
        reasons: ['name-exact'],
      },
    },
  ],
  projects: [
    {
      kind: 'nih:project',
      value: {
        title: 'Neural Signal Research',
        piName: 'Ada Lovelace',
        organizationName: 'Stanford University',
        awardAmount: 250000,
      },
      sourceId: 'nih-reporter',
      sourceUrl: 'https://reporter.nih.gov/project-details/456',
      fetchedAt: '2026-08-04T10:00:00.000Z',
      confidence: 1,
      match: {
        verified: true,
        confidence: 1,
        nameMatch: 'exact',
        institutionMatch: true,
        reasons: ['name-exact'],
      },
    },
  ],
  works: [],
  possibleAwards: [
    {
      kind: 'nsf:award',
      value: {
        title: 'Unrelated Buffalo Grant',
        piName: 'Alan Lovelace',
        awardeeName: 'SUNY at Buffalo',
      },
      sourceId: 'nsf-awards',
      sourceUrl: 'https://www.nsf.gov/awardsearch/showAward?AWD_ID=999',
      fetchedAt: '2026-08-04T10:00:00.000Z',
      match: {
        verified: false,
        confidence: 0.25,
        nameMatch: 'initial',
        institutionMatch: false,
        reasons: ['name-initial'],
      },
    },
  ],
  sources: [
    { id: 'nsf-awards', name: 'NSF Award Search API', status: 'ok', recordCount: 10, verifiedCount: 1 },
    { id: 'nih-reporter', name: 'NIH RePORTER API', status: 'ok', recordCount: 1, verifiedCount: 1 },
    { id: 'openalex-works', name: 'OpenAlex Works API', status: 'empty', recordCount: 0, verifiedCount: 0 },
  ],
  fetchedAt: '2026-08-04T10:00:00.000Z',
}

const report: AdmissionSignalReport = {
  version: 1,
  target: { school: 'Stanford University', program: 'Computer Science PhD', advisorName: 'Ada Lovelace' },
  outcomes,
  advisor,
  links: {
    advisor: [
      {
        kind: 'search',
        id: 'nsf-search',
        label: 'NSF Award Search',
        url: 'https://www.nsf.gov/awardsearch/simpleSearchResult?queryText=Ada%20Lovelace',
      },
      {
        kind: 'search',
        id: 'scholar-search',
        label: 'Google Scholar',
        url: 'https://scholar.google.com/scholar?q=Ada%20Lovelace',
      },
    ],
    program: [
      {
        kind: 'search',
        id: 'gradcafe-search',
        label: 'The GradCafe',
        url: 'https://www.thegradcafe.com/survey/?q=Stanford',
      },
    ],
  },
  insights: null,
  insightsError: null,
  fetchedAt: '2026-08-04T10:00:00.000Z',
}

function renderPanel() {
  return render(
    <I18nContext.Provider
      value={{
        lang: 'en',
        t: getDict('en'),
        format: tpl,
        tx: (path, fallback) => translate('en', path, fallback),
      }}
    >
      <AdmissionSignalsPanel token="test-token" applicationId="app-1" />
    </I18nContext.Provider>,
  )
}

describe('AdmissionSignalsPanel', () => {
  it('reads the saved report on mount but runs no external lookup', async () => {
    renderPanel()
    await waitFor(() => {
      expect(mocks.getAdmissionSignalReport).toHaveBeenCalledWith(
        'test-token',
        'app-1',
        expect.anything(),
      )
    })
    expect(mocks.refreshAdmissionSignalReport).not.toHaveBeenCalled()
  })

  it('restores the last saved report and offers to update rather than query', async () => {
    // Reopening the tab has to show what was found last time. An empty panel
    // and a "query" button would make every visit look like a first visit.
    mocks.getAdmissionSignalReport.mockResolvedValue({
      report: { ...report, savedAt: '2026-08-04T11:00:00.000Z' },
    })
    renderPanel()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Update results' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Query admission data' })).not.toBeInTheDocument()
    expect(screen.getByText('Adaptive Systems')).toBeInTheDocument()
    expect(screen.getByText(/Last updated/)).toBeInTheDocument()
  })

  it('renders outcomes, funding and discussions after the user starts the query', async () => {
    const user = userEvent.setup()
    mocks.refreshAdmissionSignalReport.mockResolvedValue({ report })
    renderPanel()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Query admission data' })).toBeEnabled()
    })
    expect(screen.queryByRole('heading', { name: 'Past decisions' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Query admission data' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Past decisions' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Advisor funding signals' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Applicant discussions' })).toBeInTheDocument()
    })
    expect(screen.getByText('60%')).toBeInTheDocument()
    expect(screen.getAllByRole('table').length).toBeGreaterThan(0)
    expect(screen.getByText('Decision-year evidence')).toBeInTheDocument()
    expect(screen.getByText('Applicant-reported sample, not an official acceptance rate.')).toBeInTheDocument()
    expect(screen.getByText('In 2024, the programme received 1,240 applications.')).toBeInTheDocument()
    expect(screen.getByText('Applications received · 2024')).toBeInTheDocument()
    expect(screen.getByText('Adaptive Systems')).toBeInTheDocument()
    expect(screen.getByText('Neural Signal Research')).toBeInTheDocument()
    expect(screen.getByText('Stanford CS PhD admission discussion')).toBeInTheDocument()
  })

  it('names what it searched for so a report can be checked against this application', async () => {
    mocks.getAdmissionSignalReport.mockResolvedValue({ report })
    renderPanel()
    await waitFor(() => {
      expect(
        screen.getByText(/Searched for: Stanford University · Computer Science PhD · Ada Lovelace/),
      ).toBeInTheDocument()
    })
  })

  it('leads provenance with the readable page and keeps raw JSON as a separate link', async () => {
    mocks.getAdmissionSignalReport.mockResolvedValue({ report })
    renderPanel()

    await waitFor(() => expect(screen.getByText('Adaptive Systems')).toBeInTheDocument())
    const raw = screen.getByRole('link', { name: /Raw JSON/i })
    expect(raw).toHaveAttribute('href', advisor.awards[0].apiUrl)
    // The provenance link itself must go to the award page, not the endpoint.
    const award = screen.getByText('Adaptive Systems').closest('article')
    const provenance = award?.querySelector('a.admissions-provenance')
    expect(provenance).toHaveAttribute('href', 'https://www.nsf.gov/awardsearch/showAward?AWD_ID=123')
  })

  it('offers searches to keep looking, labelled as searches', async () => {
    mocks.getAdmissionSignalReport.mockResolvedValue({ report })
    renderPanel()
    await waitFor(() => {
      // "NSF Award Search" is also the source chip's name, so match the link.
      expect(screen.getByRole('link', { name: 'NSF Award Search' })).toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: /Google Scholar/ })).toBeInTheDocument()
    expect(screen.getAllByText(/These are searches, not results/).length).toBeGreaterThan(0)
  })

  it('separates a confirmed record from an unconfirmed same-surname one', async () => {
    // The reported failure was a panel showing strangers' grants as this
    // professor's. A near miss stays reachable and stays out of the counts.
    mocks.getAdmissionSignalReport.mockResolvedValue({ report })
    renderPanel()

    await waitFor(() => expect(screen.getByText('Adaptive Systems')).toBeInTheDocument())
    expect(screen.getAllByText('Confirmed').length).toBeGreaterThan(0)
    expect(screen.getByText(/Show 1 unconfirmed match/)).toBeInTheDocument()
    expect(screen.getByText('Unrelated Buffalo Grant')).toBeInTheDocument()
    // The count stays at the one verified award; the near miss never joins it.
    expect(screen.getByText('1 awards')).toBeInTheDocument()
  })

  it('reports how many of a source rows actually matched', async () => {
    mocks.getAdmissionSignalReport.mockResolvedValue({ report })
    renderPanel()
    // NSF answered with ten rows and one of them was this person. Showing only
    // "10 records" is how the panel used to imply ten were hers.
    await waitFor(() => expect(screen.getByText(/1 of 10 matched/)).toBeInTheDocument())
  })

  it('refuses to present a saved report after the application target changed', async () => {
    mocks.getAdmissionSignalReport.mockResolvedValue({
      report: null,
      stale: true,
      target: { school: 'Edinburgh', program: 'Computer Science PhD', advisorName: 'Fei-Fei Li' },
      staleTarget: report.target,
    })
    renderPanel()

    await waitFor(() => {
      expect(screen.getByText(/saved evidence is for an earlier application target/i)).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Query admission data' })).toBeInTheDocument()
    expect(screen.queryByText('Adaptive Systems')).not.toBeInTheDocument()
  })

  it('bookmarks an evidence row without turning the record list into saved cards', async () => {
    const user = userEvent.setup()
    mocks.getAdmissionSignalReport.mockResolvedValue({ report })
    renderPanel()

    await waitFor(() => expect(screen.getByText('Adaptive Systems')).toBeInTheDocument())
    const buttons = screen.getAllByRole('button', { name: 'Bookmark record' })
    await user.click(buttons[0])

    await waitFor(() => {
      expect(mocks.createAdmissionBookmark).toHaveBeenCalledWith(
        'test-token',
        expect.objectContaining({ applicationId: 'app-1' }),
      )
      expect(document.querySelector('details.admissions-bookmarks')).toBeInTheDocument()
    })
  })

  it('does not display a 0% share when acceptedShare is null', async () => {
    mocks.getAdmissionSignalReport.mockResolvedValue({
      report: {
        ...report,
        outcomes: { ...outcomes, summary: { ...outcomes.summary, acceptedShare: null } },
      },
    })
    renderPanel()

    await waitFor(() => {
      expect(screen.getByText('Too few public results for a reliable share.')).toBeInTheDocument()
    })
    expect(screen.queryByText(/0%/i)).not.toBeInTheDocument()
  })

  it('keeps other sources visible when one source reports an error', async () => {
    mocks.getAdmissionSignalReport.mockResolvedValue({
      report: {
        ...report,
        outcomes: {
          ...outcomes,
          discussions: [],
          sources: [
            outcomes.sources[0],
            {
              id: 'reddit-submissions',
              name: 'Reddit r/gradadmissions API',
              status: 'error',
              recordCount: 0,
              error: {
                kind: 'SourceStructureChangedError',
                message: 'Reddit page structure changed.',
              },
            },
          ],
        },
      },
    })
    renderPanel()

    await waitFor(() => {
      expect(screen.getByText('Adaptive Systems')).toBeInTheDocument()
      expect(screen.getByText(/Source failed/i)).toBeInTheDocument()
      expect(screen.getByText('Reddit page structure changed.')).toBeInTheDocument()
    })
  })

  it('shows a Reddit configuration prompt instead of a failure when credentials are missing', async () => {
    mocks.getAdmissionSignalReport.mockResolvedValue({
      report: {
        ...report,
        outcomes: {
          ...outcomes,
          discussions: [],
          sources: [
            outcomes.sources[0],
            {
              id: 'reddit-submissions',
              name: 'Reddit r/gradadmissions API',
              status: 'not-configured',
              recordCount: 0,
              warnings: ['reddit-oauth-credentials-missing'],
            },
          ],
        },
      },
    })
    renderPanel()

    await waitFor(() => {
      expect(document.body.textContent).toContain('REDDIT_CLIENT_ID')
      expect(screen.queryByText(/Source failed/i)).not.toBeInTheDocument()
    })
  })

  it('keeps the retrieved records when the AI reading fails', async () => {
    mocks.getAdmissionSignalReport.mockResolvedValue({
      report: { ...report, insightsError: 'AI_REQUEST_FAILED' },
    })
    renderPanel()

    await waitFor(() => {
      expect(screen.getByText(/The AI reading could not be produced/)).toBeInTheDocument()
    })
    expect(screen.getByText('Adaptive Systems')).toBeInTheDocument()
  })

  it('renders the AI reading and marks the records it called relevant', async () => {
    mocks.getAdmissionSignalReport.mockResolvedValue({
      report: {
        ...report,
        insights: {
          fundingOutlook: 'One active award runs to 2028.',
          fundingConfidence: 'strong',
          profileFit: 'Overlaps with your multimodal work.',
          relevantAwardIndexes: [0],
          relevantProjectIndexes: [],
          relevantWorkIndexes: [],
          mismatchedIndexes: [],
          outcomeReading: 'The sample is small.',
          talkingPoints: ['Ask about the 2028 renewal'],
          openQuestions: ['Are they taking students?'],
        },
      },
    })
    renderPanel()

    await waitFor(() => {
      expect(screen.getByText('One active award runs to 2028.')).toBeInTheDocument()
    })
    expect(screen.getByText('Strong evidence')).toBeInTheDocument()
    expect(screen.getByText('Ask about the 2028 renewal')).toBeInTheDocument()
    expect(screen.getByText('Relevant to you')).toBeInTheDocument()
    // The reading must never read as retrieved fact.
    expect(screen.getByText(/It cannot add awards, projects or numbers/)).toBeInTheDocument()
  })
})
