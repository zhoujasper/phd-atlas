import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  InterviewEvent,
  InterviewFeedback,
  InterviewMockSession,
  InterviewPrepWorkspace,
  InterviewQuestion,
} from '../../interviewPrep'
import { I18nContext, type I18nContextValue } from '../hooks/useI18n'
import { InterviewPrepScreen, type InterviewPrepScreenProps } from './InterviewPrepScreen'

const i18nContext: I18nContextValue = {
  lang: 'en',
  t: {},
  format: (template) => template,
  tx: (_path, fallback) => fallback ?? _path,
}

const event: InterviewEvent = {
  id: 'interview-1',
  ownerUserId: 'student-1',
  teamId: null,
  applicationId: 'application-1',
  sourceCommunicationId: null,
  createdByUserId: 'student-1',
  title: 'Faculty interview',
  school: 'Northbridge University',
  program: 'Computer Science PhD',
  advisor: 'Professor Lin',
  format: 'video',
  scheduledAt: '2026-08-12T10:00:00.000Z',
  timezone: 'Europe/London',
  durationMinutes: 30,
  participantNames: ['Professor Lin'],
  status: 'upcoming',
  preparationNotes: '',
  talkingPoints: 'Graph learning for scientific discovery',
  createdAt: '2026-08-02T10:00:00.000Z',
  updatedAt: '2026-08-02T10:00:00.000Z',
}

const questions: InterviewQuestion[] = [
  {
    id: 'question-1',
    interviewId: event.id,
    category: 'research',
    prompt: 'Describe your research direction.',
    source: 'library',
    createdByUserId: 'student-1',
    order: 0,
    notes: 'Lead with the problem and your contribution.',
    createdAt: '2026-08-02T10:00:00.000Z',
    updatedAt: '2026-08-02T10:00:00.000Z',
  },
  {
    id: 'question-2',
    interviewId: event.id,
    category: 'advisor',
    prompt: 'Why this lab?',
    source: 'library',
    createdByUserId: 'student-1',
    order: 1,
    notes: '',
    createdAt: '2026-08-02T10:01:00.000Z',
    updatedAt: '2026-08-02T10:01:00.000Z',
  },
]

function workspace(overrides: Partial<InterviewPrepWorkspace> = {}): InterviewPrepWorkspace {
  return {
    subjectUserId: 'student-1',
    subjectName: 'Ada Student',
    revision: 1,
    interviews: [event],
    questions: [],
    mockSessions: [],
    feedback: [],
    updatedAt: '2026-08-02T10:00:00.000Z',
    ...overrides,
  }
}

function baseProps(overrides: Partial<InterviewPrepScreenProps> = {}): InterviewPrepScreenProps {
  return {
    viewer: {
      userId: 'student-1',
      displayName: 'Ada Student',
      mode: 'personal',
      canEdit: true,
      teamId: null,
    },
    workspace: workspace(),
    onWorkspaceChange: vi.fn(),
    onSave: vi.fn(async (next) => next),
    ...overrides,
  }
}

function renderScreen(props: InterviewPrepScreenProps) {
  return render(
    <I18nContext.Provider value={i18nContext}>
      <InterviewPrepScreen {...props} />
    </I18nContext.Provider>,
  )
}

describe('InterviewPrepScreen', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.clearAllMocks()
  })

  it('keeps the interview explanation behind the title info control', () => {
    renderScreen(baseProps())

    const description = 'Plan, practise, and review every interview in one recoverable workspace.'
    const trigger = screen.getByRole('button', { name: description })
    const tooltip = document.querySelector('.info-tooltip-portal')!
    expect(tooltip).not.toHaveClass('is-open')

    fireEvent.click(trigger)
    expect(tooltip).toHaveClass('is-open')
    expect(tooltip).toHaveTextContent(description)

    fireEvent.click(trigger)
    expect(tooltip).not.toHaveClass('is-open')
  })

  it('keeps a newer edit dirty when an earlier save acknowledgement arrives', async () => {
    let resolveSave: ((value: InterviewPrepWorkspace) => void) | undefined
    const onSave = vi.fn<(next: InterviewPrepWorkspace) => Promise<InterviewPrepWorkspace>>(() => new Promise<InterviewPrepWorkspace>((resolve) => {
      resolveSave = resolve
    }))
    const onWorkspaceChange = vi.fn()
    renderScreen(baseProps({ onSave, onWorkspaceChange }))

    const title = screen.getByRole('textbox', { name: 'Interview title' })
    fireEvent.change(title, { target: { value: 'Round one' } })
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    fireEvent.change(title, { target: { value: 'Round one · revised' } })

    const submitted = onSave.mock.calls[0][0]
    resolveSave?.({ ...submitted, revision: submitted.revision + 1 })

    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    expect(screen.getByRole('textbox', { name: 'Interview title' })).toHaveValue('Round one · revised')
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    expect(onWorkspaceChange).toHaveBeenLastCalledWith(expect.objectContaining({
      interviews: [expect.objectContaining({ title: 'Round one · revised' })],
    }))
  })

  it('keeps the editor dirty when a save callback returns no canonical acknowledgement', async () => {
    const onNotify = vi.fn()
    const onDirtyChange = vi.fn()
    const onSave = vi.fn(async () => undefined) as unknown as InterviewPrepScreenProps['onSave']
    renderScreen(baseProps({ onDirtyChange, onNotify, onSave }))

    fireEvent.change(screen.getByRole('textbox', { name: 'Interview title' }), {
      target: { value: 'Do not lose this title' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry save' })).toBeEnabled())
    expect(screen.getByRole('textbox', { name: 'Interview title' })).toHaveValue('Do not lose this title')
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    expect(onNotify).toHaveBeenCalledWith(expect.stringContaining('draft remains'), 'error')
  })

  it('clears recovery and reports Saved only after the full canonical ACK advances the durable revision', async () => {
    const onNotify = vi.fn()
    const onDirtyChange = vi.fn()
    const onSave = vi.fn(async (submitted: InterviewPrepWorkspace, expectedRevision: number) => ({
      ...structuredClone(submitted),
      revision: expectedRevision + 1,
      updatedAt: '2026-08-02T10:10:00.000Z',
    }))
    renderScreen(baseProps({ onDirtyChange, onNotify, onSave }))

    fireEvent.change(screen.getByRole('textbox', { name: 'Preparation notes' }), {
      target: { value: 'A nested authored note that must round-trip.' },
    })
    await waitFor(() => expect(sessionStorage.length).toBe(1))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled())
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        interviews: [expect.objectContaining({
          preparationNotes: 'A nested authored note that must round-trip.',
        })],
      }),
      1,
    )
    expect(sessionStorage.length).toBe(0)
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    expect(onNotify).toHaveBeenCalledWith('Interview preparation saved.', 'success')
  })

  it('rejects a same-subject 200 that omits submitted authored content and retains recovery', async () => {
    const onNotify = vi.fn()
    const onDirtyChange = vi.fn()
    const onSave = vi.fn(async (submitted: InterviewPrepWorkspace) => ({
      ...submitted,
      revision: submitted.revision + 1,
      interviews: [{ ...submitted.interviews[0], title: 'Stale server title' }],
    }))
    renderScreen(baseProps({ onDirtyChange, onNotify, onSave }))

    fireEvent.change(screen.getByRole('textbox', { name: 'Interview title' }), {
      target: { value: 'Resident title that must survive' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry save' })).toBeEnabled())
    expect(screen.getByRole('textbox', { name: 'Interview title' })).toHaveValue('Resident title that must survive')
    expect(sessionStorage.length).toBe(1)
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    expect(onNotify).not.toHaveBeenCalledWith('Interview preparation saved.', 'success')
  })

  it('recovers an unsaved question draft after the screen remounts', async () => {
    const canonical = workspace()
    const props = baseProps({ workspace: canonical })
    const first = renderScreen(props)

    fireEvent.click(screen.getByRole('tab', { name: 'Questions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add first question' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Prompt' }), {
      target: { value: 'How does my work connect to your latest paper?' },
    })

    await waitFor(() => expect(sessionStorage.length).toBe(1))
    first.unmount()

    renderScreen(baseProps({ workspace: canonical }))

    expect(screen.getByText('Recovered unsaved interview work from this session.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveValue('How does my work connect to your latest paper?')
    expect(screen.getByRole('tab', { name: 'Questions' })).toHaveAttribute('aria-selected', 'true')
  })

  it('moves a teacher from the mobile student directory into the selected student interview list', () => {
    const onSelectedStudentChange = vi.fn()
    const view = renderScreen(baseProps({
      viewer: {
        userId: 'teacher-1',
        displayName: 'Dr Morgan',
        mode: 'teacher',
        canEdit: true,
        teamId: 'team-1',
      },
      workspace: null,
      students: [
        { id: 'student-1', displayName: 'Ada Student', email: 'ada@example.edu' },
        { id: 'student-2', displayName: 'Lin Student', email: 'lin@example.edu' },
      ],
      selectedStudentId: null,
      onSelectedStudentChange,
    }))

    expect(view.container.querySelector('.interview-student-pane')).toHaveAttribute('data-mobile-active', 'true')
    fireEvent.click(view.container.querySelector('.interview-student-list button') as HTMLButtonElement)

    expect(onSelectedStudentChange).toHaveBeenCalledWith('student-1')
    expect(view.container.querySelector('.interview-event-pane')).toHaveAttribute('data-mobile-active', 'true')
  })

  it('shows an explicit teacher empty-roster state instead of a loading placeholder', () => {
    const view = renderScreen(baseProps({
      viewer: {
        userId: 'teacher-1',
        displayName: 'Dr Morgan',
        mode: 'teacher',
        canEdit: false,
        teamId: 'team-1',
      },
      workspace: null,
      students: [],
      selectedStudentId: null,
    }))

    expect(screen.getByRole('heading', { name: 'Interview Prep' })).toBeInTheDocument()
    expect(screen.getByText('No students to coach yet')).toBeInTheDocument()
    expect(screen.getAllByText('No students assigned').length).toBeGreaterThan(0)
    expect(view.container.querySelector('.interview-student-pane')).toHaveAttribute('data-mobile-active', 'true')
  })

  it('drills a Team student from the mobile interview list into their workspace and back', () => {
    const view = renderScreen(baseProps({
      viewer: {
        userId: 'student-1',
        displayName: 'Ada Student',
        mode: 'student',
        canEdit: true,
        teamId: 'team-1',
      },
    }))

    expect(view.container.querySelector('.interview-event-pane')).toHaveAttribute('data-mobile-active', 'true')
    fireEvent.click(view.container.querySelector('.interview-event-main') as HTMLButtonElement)
    expect(view.container.querySelector('.interview-workspace-pane')).toHaveAttribute('data-mobile-active', 'true')
    fireEvent.click(view.container.querySelector('.interview-mobile-drill-header button') as HTMLButtonElement)
    expect(view.container.querySelector('.interview-event-pane')).toHaveAttribute('data-mobile-active', 'true')
  })

  it('runs a question-by-question mock and opens feedback without dropping either answer', async () => {
    const onWorkspaceChange = vi.fn()
    renderScreen(baseProps({
      workspace: workspace({ questions }),
      onWorkspaceChange,
    }))

    fireEvent.click(screen.getByRole('tab', { name: 'Mock' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start mock interview' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Your practice answer' }), {
      target: { value: 'My work focuses on reliable graph learning.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Your practice answer' }), {
      target: { value: 'The lab combines the methods and domain I want to study.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Finish and review' }))

    expect(await screen.findByText('Feedback and next improvements')).toBeInTheDocument()
    const latestWorkspace = onWorkspaceChange.mock.calls.at(-1)?.[0] as InterviewPrepWorkspace
    expect(latestWorkspace.mockSessions[0]).toMatchObject({ status: 'completed' })
    expect(latestWorkspace.mockSessions[0].answers.map((answer) => answer.body)).toEqual([
      'My work focuses on reliable graph learning.',
      'The lab combines the methods and domain I want to study.',
    ])
  })

  it('adds an AI follow-up question to the active mock session', async () => {
    const onWorkspaceChange = vi.fn()
    const onGenerateMockTurn = vi.fn(async () => [{
      ...questions[0],
      id: 'ai-follow-up-1',
      source: 'ai',
      order: 2,
      prompt: 'How did you verify that result is reproducible?',
    }] satisfies InterviewQuestion[])
    renderScreen(baseProps({
      workspace: workspace({ questions }),
      onWorkspaceChange,
      onGenerateMockTurn,
      aiCapabilityId: 'key-1',
    }))

    fireEvent.click(screen.getByRole('tab', { name: 'Mock' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start mock interview' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Your practice answer' }), {
      target: { value: 'I validate the method on held-out cohorts.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'AI follow-up' }))

    await waitFor(() => expect(onGenerateMockTurn).toHaveBeenCalledTimes(1))
    const latestWorkspace = onWorkspaceChange.mock.calls.at(-1)?.[0] as InterviewPrepWorkspace
    expect(latestWorkspace.questions).toHaveLength(3)
    expect(latestWorkspace.mockSessions[0]).toMatchObject({
      currentQuestionId: 'ai-follow-up-1',
      questionIds: ['question-1', 'question-2', 'ai-follow-up-1'],
    })
  })

  it('keeps the mock answers and reports an error when AI follow-up fails', async () => {
    const onNotify = vi.fn()
    const onWorkspaceChange = vi.fn()
    const onGenerateMockTurn = vi.fn(async () => { throw new Error('provider failed') })
    renderScreen(baseProps({
      workspace: workspace({ questions }),
      onWorkspaceChange,
      onGenerateMockTurn,
      aiCapabilityId: 'key-1',
      onNotify,
    }))

    fireEvent.click(screen.getByRole('tab', { name: 'Mock' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start mock interview' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Your practice answer' }), {
      target: { value: 'Keep this answer locally.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'AI follow-up' }))

    await waitFor(() => expect(onNotify).toHaveBeenCalledWith(
      expect.stringContaining('Could not generate a follow-up question'),
      'error',
    ))
    const latestWorkspace = onWorkspaceChange.mock.calls.at(-1)?.[0] as InterviewPrepWorkspace
    expect(latestWorkspace.questions).toHaveLength(2)
    expect(latestWorkspace.mockSessions[0].answers[0].body).toBe('Keep this answer locally.')
  })

  it('hands program context to AI question generation and merges returned questions as AI-owned suggestions', async () => {
    const generated: InterviewQuestion = {
      ...questions[0],
      id: 'ai-question-1',
      prompt: 'How would you extend Professor Lin’s recent graph model?',
      source: 'ai',
    }
    const onGenerateQuestions = vi.fn(async () => [generated])
    const onWorkspaceChange = vi.fn()
    renderScreen(baseProps({ onGenerateQuestions, onWorkspaceChange }))

    fireEvent.click(screen.getByRole('tab', { name: 'Questions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate with AI' }))

    expect(await screen.findByDisplayValue(generated.prompt)).toBeInTheDocument()
    expect(onGenerateQuestions).toHaveBeenCalledWith(expect.objectContaining({
      subjectUserId: 'student-1',
      interview: expect.objectContaining({ program: 'Computer Science PhD', advisor: 'Professor Lin' }),
      focus: expect.stringContaining('Graph learning'),
    }))
    const latestWorkspace = onWorkspaceChange.mock.calls.at(-1)?.[0] as InterviewPrepWorkspace
    expect(latestWorkspace.questions[0]).toMatchObject({
      id: 'ai-question-1',
      interviewId: 'interview-1',
      source: 'ai',
    })
  })

  it('keeps AI controls disabled with localized guidance when no capable key callback exists', () => {
    renderScreen(baseProps({ workspace: workspace({ questions }) }))

    fireEvent.click(screen.getByRole('tab', { name: 'Questions' }))
    expect(screen.getByRole('button', { name: 'Generate with AI' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Generate with AI' })).toHaveAttribute(
      'title',
      'Connect an AI provider to use this action.',
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Feedback' }))
    expect(screen.getByRole('button', { name: 'AI review' })).toBeDisabled()
  })

  it('discards an AI question result when its interview is deleted while generation is in flight', async () => {
    let resolveGeneration: ((value: InterviewQuestion[]) => void) | undefined
    const generated: InterviewQuestion = {
      ...questions[0],
      id: 'ai-question-race',
      source: 'ai',
    }
    const onGenerateQuestions = vi.fn(() => new Promise<InterviewQuestion[]>((resolve) => {
      resolveGeneration = resolve
    }))
    const onWorkspaceChange = vi.fn()
    const onNotify = vi.fn()
    renderScreen(baseProps({ onGenerateQuestions, onNotify, onWorkspaceChange }))

    fireEvent.click(screen.getByRole('tab', { name: 'Questions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate with AI' }))
    fireEvent.click(screen.getByRole('button', { name: 'Interview actions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await act(async () => resolveGeneration?.([generated]))

    await waitFor(() => expect(onNotify).toHaveBeenCalledWith(
      'The AI result was discarded because this interview workspace changed.',
      'info',
    ))
    const latestWorkspace = onWorkspaceChange.mock.calls.at(-1)?.[0] as InterviewPrepWorkspace
    expect(latestWorkspace.interviews).toEqual([])
    expect(latestWorkspace.questions).toEqual([])
  })

  it('discards an AI question result after the user switches to another interview', async () => {
    let resolveGeneration: ((value: InterviewQuestion[]) => void) | undefined
    const secondInterview: InterviewEvent = {
      ...event,
      id: 'interview-2',
      title: 'Second interview',
      scheduledAt: '2026-08-14T10:00:00.000Z',
    }
    const onGenerateQuestions = vi.fn(() => new Promise<InterviewQuestion[]>((resolve) => {
      resolveGeneration = resolve
    }))
    const onWorkspaceChange = vi.fn()
    const onNotify = vi.fn()
    renderScreen(baseProps({
      workspace: workspace({ interviews: [event, secondInterview] }),
      onGenerateQuestions,
      onNotify,
      onWorkspaceChange,
    }))

    fireEvent.click(screen.getByRole('tab', { name: 'Questions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate with AI' }))
    fireEvent.click(screen.getByText('Second interview').closest('button') as HTMLButtonElement)
    await act(async () => resolveGeneration?.([{
      ...questions[0],
      id: 'ai-question-after-switch',
      source: 'ai',
    }]))

    await waitFor(() => expect(onNotify).toHaveBeenCalledWith(
      'The AI result was discarded because this interview workspace changed.',
      'info',
    ))
    expect(onWorkspaceChange).not.toHaveBeenCalled()
    expect(screen.queryByText('Describe your research direction.')).not.toBeInTheDocument()
  })

  it('discards AI feedback after the active mock session changes', async () => {
    let resolveGeneration: ((value: InterviewFeedback[]) => void) | undefined
    const completedSession: InterviewMockSession = {
      id: 'mock-completed',
      interviewId: event.id,
      ownerUserId: 'student-1',
      mode: 'self',
      status: 'completed',
      questionIds: questions.map((question) => question.id),
      currentQuestionId: questions[0].id,
      answers: [{
        questionId: questions[0].id,
        body: 'A complete practice answer.',
        confidence: 4,
        updatedAt: '2026-08-02T10:05:00.000Z',
      }],
      startedAt: '2026-08-02T10:00:00.000Z',
      completedAt: '2026-08-02T10:06:00.000Z',
      updatedAt: '2026-08-02T10:06:00.000Z',
    }
    const onGenerateFeedback = vi.fn(() => new Promise<InterviewFeedback[]>((resolve) => {
      resolveGeneration = resolve
    }))
    const onWorkspaceChange = vi.fn()
    const onNotify = vi.fn()
    renderScreen(baseProps({
      workspace: workspace({ questions, mockSessions: [completedSession] }),
      onGenerateFeedback,
      onNotify,
      onWorkspaceChange,
    }))

    fireEvent.click(screen.getByRole('tab', { name: 'Feedback' }))
    fireEvent.click(screen.getByRole('button', { name: 'AI review' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Mock' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start another mock' }))
    await act(async () => resolveGeneration?.([{
      id: 'feedback-after-switch',
      interviewId: event.id,
      sessionId: completedSession.id,
      questionId: null,
      authorKind: 'ai',
      authorName: 'AI coach',
      body: 'This must not attach to a stale session.',
      strengths: [],
      improvements: [],
      score: 4,
      createdAt: '2026-08-02T10:07:00.000Z',
      updatedAt: '2026-08-02T10:07:00.000Z',
    }]))

    await waitFor(() => expect(onNotify).toHaveBeenCalledWith(
      'The AI result was discarded because this interview workspace changed.',
      'info',
    ))
    const latestWorkspace = onWorkspaceChange.mock.calls.at(-1)?.[0] as InterviewPrepWorkspace
    expect(latestWorkspace.mockSessions).toHaveLength(2)
    expect(latestWorkspace.feedback).toEqual([])
  })

  it('revalidates the AI capability identity before merging a provider result', async () => {
    let resolveGeneration: ((value: InterviewQuestion[]) => void) | undefined
    const onGenerateQuestions = vi.fn(() => new Promise<InterviewQuestion[]>((resolve) => {
      resolveGeneration = resolve
    }))
    const onWorkspaceChange = vi.fn()
    const onNotify = vi.fn()
    const props = baseProps({
      aiCapabilityId: 'ai-key-1',
      onGenerateQuestions,
      onNotify,
      onWorkspaceChange,
    })
    const view = renderScreen(props)

    fireEvent.click(screen.getByRole('tab', { name: 'Questions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate with AI' }))
    view.rerender(
      <I18nContext.Provider value={i18nContext}>
        <InterviewPrepScreen {...props} aiCapabilityId={null} />
      </I18nContext.Provider>,
    )
    await act(async () => resolveGeneration?.([{
      ...questions[0],
      id: 'ai-question-revoked-key',
      source: 'ai',
    }]))

    await waitFor(() => expect(onNotify).toHaveBeenCalledWith(
      'The AI result was discarded because this interview workspace changed.',
      'info',
    ))
    expect(onWorkspaceChange).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Generate with AI' })).toBeDisabled()
  })
})
