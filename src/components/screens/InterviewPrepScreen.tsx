import '../../styles/interview.css'

import clsx from 'clsx'
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Bot,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  GraduationCap,
  Lightbulb,
  Loader2,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  Save,
  Sparkles,
  Trash2,
  UserRound,
  UsersRound,
} from 'lucide-react'
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  clearRecoverableInterviewPrepDraft,
  createEmptyInterviewPrepWorkspace,
  createInterviewEvent,
  createInterviewFeedback,
  createInterviewMockSession,
  createInterviewQuestion,
  feedbackForInterview,
  type GenerateInterviewFeedbackRequest,
  type GenerateInterviewMockTurnRequest,
  type GenerateInterviewQuestionsRequest,
  type InterviewEvent,
  type InterviewFeedback,
  type InterviewFormat,
  type InterviewMockAnswer,
  type InterviewMockSession,
  type InterviewPrepMobilePane,
  type InterviewPrepRecoveryScope,
  type InterviewPrepStudent,
  type InterviewPrepTab,
  type InterviewPrepViewer,
  type InterviewPrepWorkspace,
  type InterviewQuestion,
  type InterviewQuestionCategory,
  type InterviewStatus,
  interviewFormats,
  interviewFormatLabelKey,
  interviewPrepTabLabelKey,
  interviewQuestionCategories,
  interviewQuestionCategoryLabelKey,
  interviewStatuses,
  interviewStatusLabelKey,
  interviewPrepWorkspaceAcknowledged,
  interviewPrepRecoveryKey,
  loadRecoverableInterviewPrepDraft,
  questionsForInterview,
  removeInterviewEvent,
  removeInterviewQuestion,
  saveRecoverableInterviewPrepDraft,
  sessionsForInterview,
  sortInterviewEvents,
  upsertInterviewEvent,
  upsertInterviewFeedback,
  upsertInterviewMockSession,
  upsertInterviewQuestion,
} from '../../interviewPrep'
import { useI18n } from '../hooks/useI18n'
import { localeForLanguage } from '../../i18n'
import { InfoTooltip } from '../shared/InfoTooltip'

export interface InterviewPrepScreenProps {
  viewer: InterviewPrepViewer
  workspace: InterviewPrepWorkspace | null
  students?: InterviewPrepStudent[]
  selectedStudentId?: string | null
  onSelectedStudentChange?: (studentId: string) => void
  onWorkspaceChange: (workspace: InterviewPrepWorkspace) => void
  onSave: (
    workspace: InterviewPrepWorkspace,
    expectedRevision: number,
  ) => Promise<InterviewPrepWorkspace>
  onGenerateQuestions?: (
    request: GenerateInterviewQuestionsRequest,
  ) => Promise<InterviewQuestion[]>
  onGenerateFeedback?: (
    request: GenerateInterviewFeedbackRequest,
  ) => Promise<InterviewFeedback[]>
  onGenerateMockTurn?: (
    request: GenerateInterviewMockTurnRequest,
  ) => Promise<InterviewQuestion[]>
  /** Stable capability identity. Explicit null disables AI even if a stale callback remains mounted. */
  aiCapabilityId?: string | null
  recoveryScope?: Omit<InterviewPrepRecoveryScope, 'subjectUserId'>
  onDirtyChange?: (dirty: boolean) => void
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info' | 'warning') => void
  className?: string
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'
type GenerationState = 'idle' | 'questions' | 'mock-turn' | 'feedback'

const TABS: Array<{ id: InterviewPrepTab; icon: typeof CalendarClock }> = [
  { id: 'plan', icon: CalendarClock },
  { id: 'questions', icon: BookOpenText },
  { id: 'mock', icon: MessageSquareText },
  { id: 'feedback', icon: ClipboardCheck },
]

function titleForInterview(interview: InterviewEvent, fallback: string): string {
  return interview.title.trim() || interview.school.trim() || fallback
}

function toDateTimeInput(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 16)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function fromDateTimeInput(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString()
}

function listFromText(value: string): string[] {
  return value.split(/[,;，；\n]/).map((item) => item.trim()).filter(Boolean)
}

function dateLabel(value: string | null, locale: string, fallback: string): string {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

function Field({
  label,
  children,
  wide = false,
}: {
  label: string
  children: ReactNode
  wide?: boolean
}) {
  return (
    <label className={clsx('interview-field', wide && 'is-wide')}>
      <span>{label}</span>
      {children}
    </label>
  )
}

function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: typeof CalendarClock
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="interview-empty-state">
      <span className="interview-empty-icon"><Icon size={20} aria-hidden="true" /></span>
      <strong>{title}</strong>
      <p>{body}</p>
      {action}
    </div>
  )
}

function scoreInterviewReadiness(
  interview: InterviewEvent | null,
  questions: InterviewQuestion[],
  sessions: InterviewMockSession[],
  feedback: InterviewFeedback[],
): number {
  if (!interview) return 0
  const details = [
    interview.title,
    interview.school,
    interview.program,
    interview.advisor,
    interview.scheduledAt,
  ].filter(Boolean).length
  const latestSession = sessions[0]
  const answered = latestSession?.answers.filter((answer) => answer.body.trim()).length ?? 0
  const detailScore = (details / 5) * 35
  const questionScore = Math.min(1, questions.length / 6) * 25
  const practiceScore = questions.length
    ? Math.min(1, answered / questions.length) * 25
    : 0
  const feedbackScore = feedback.length ? 15 : 0
  return Math.round(detailScore + questionScore + practiceScore + feedbackScore)
}

function categoryLabel(
  category: InterviewQuestionCategory,
  tx: (path: string, fallback?: string) => string,
): string {
  const fallbacks: Record<InterviewQuestionCategory, string> = {
    research: 'Research',
    motivation: 'Motivation',
    experience: 'Experience',
    behavioral: 'Behavioral',
    technical: 'Technical',
    advisor: 'Advisor fit',
    closing: 'Questions to ask',
  }
  return tx(interviewQuestionCategoryLabelKey(category), fallbacks[category])
}

function formatLabel(
  format: InterviewFormat,
  tx: (path: string, fallback?: string) => string,
): string {
  const fallbacks: Record<InterviewFormat, string> = {
    video: 'Video',
    phone: 'Phone',
    onsite: 'On site',
    panel: 'Panel',
  }
  return tx(interviewFormatLabelKey(format), fallbacks[format])
}

function statusLabel(
  status: InterviewStatus,
  tx: (path: string, fallback?: string) => string,
): string {
  const fallbacks: Record<InterviewStatus, string> = {
    preparing: 'Preparing',
    upcoming: 'Upcoming',
    completed: 'Completed',
  }
  return tx(interviewStatusLabelKey(status), fallbacks[status])
}

export function InterviewPrepScreen({
  viewer,
  workspace,
  students = [],
  selectedStudentId = null,
  onSelectedStudentChange,
  onWorkspaceChange,
  onSave,
  onGenerateQuestions,
  onGenerateFeedback,
  onGenerateMockTurn,
  aiCapabilityId,
  recoveryScope,
  onDirtyChange,
  onNotify,
  className,
}: InterviewPrepScreenProps) {
  const { tx, lang } = useI18n()
  const locale = localeForLanguage(lang)
  const canonicalWorkspace = useMemo(() => workspace ?? createEmptyInterviewPrepWorkspace(
    selectedStudentId || viewer.userId,
    students.find((student) => student.id === selectedStudentId)?.displayName || viewer.displayName,
  ), [selectedStudentId, students, viewer.displayName, viewer.userId, workspace])
  const canEdit = viewer.canEdit && Boolean(workspace || viewer.mode !== 'teacher')
  const scope = useMemo<InterviewPrepRecoveryScope>(() => ({
    sessionUserId: recoveryScope?.sessionUserId || viewer.userId,
    subjectUserId: canonicalWorkspace.subjectUserId,
    teamId: recoveryScope?.teamId ?? viewer.teamId ?? null,
  }), [canonicalWorkspace.subjectUserId, recoveryScope?.sessionUserId, recoveryScope?.teamId, viewer.teamId, viewer.userId])
  const scopeKey = interviewPrepRecoveryKey(scope)
  const [initialRecovery] = useState(() => loadRecoverableInterviewPrepDraft(scope))
  const initialWorkspace = initialRecovery?.workspace ?? canonicalWorkspace
  const initialInterviews = sortInterviewEvents(initialWorkspace.interviews)

  const [draft, setDraft] = useState(initialWorkspace)
  const [dirty, setDirty] = useState(Boolean(initialRecovery))
  const [recovered, setRecovered] = useState(Boolean(initialRecovery))
  const [activeInterviewId, setActiveInterviewId] = useState<string | null>(
    initialRecovery?.activeInterviewId && initialWorkspace.interviews.some((item) => item.id === initialRecovery.activeInterviewId)
      ? initialRecovery.activeInterviewId
      : initialInterviews[0]?.id ?? null,
  )
  const [activeTab, setActiveTab] = useState<InterviewPrepTab>(initialRecovery?.activeTab ?? 'plan')
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(initialRecovery?.selectedQuestionId ?? null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(initialRecovery?.activeSessionId ?? null)
  const [mobilePane, setMobilePane] = useState<InterviewPrepMobilePane>(
    initialRecovery?.mobilePane ?? (viewer.mode === 'teacher' ? 'students' : 'interviews'),
  )
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [generationState, setGenerationState] = useState<GenerationState>('idle')
  const [pendingDeleteInterviewId, setPendingDeleteInterviewId] = useState<string | null>(null)
  const saveStateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scopeKeyRef = useRef(scopeKey)
  const draftRef = useRef(draft)
  const dirtyRef = useRef(dirty)
  const activeInterviewIdRef = useRef(activeInterviewId)
  const activeTabRef = useRef(activeTab)
  const selectedQuestionIdRef = useRef(selectedQuestionId)
  const activeSessionIdRef = useRef(activeSessionId)
  const mobilePaneRef = useRef(mobilePane)
  const recoveryWarningShownRef = useRef(false)
  const generationSequenceRef = useRef(0)
  const mountedRef = useRef(true)
  const canonicalRevisionRef = useRef(canonicalWorkspace.revision)
  const effectiveAiCapabilityId = aiCapabilityId === undefined
    ? (onGenerateQuestions || onGenerateFeedback ? 'callback-capability' : null)
    : aiCapabilityId
  const generationContextRef = useRef({
    scopeKey,
    canEdit,
    aiCapabilityId: effectiveAiCapabilityId,
  })

  draftRef.current = draft
  dirtyRef.current = dirty
  activeInterviewIdRef.current = activeInterviewId
  activeTabRef.current = activeTab
  selectedQuestionIdRef.current = selectedQuestionId
  activeSessionIdRef.current = activeSessionId
  mobilePaneRef.current = mobilePane
  generationContextRef.current = {
    scopeKey,
    canEdit,
    aiCapabilityId: effectiveAiCapabilityId,
  }

  const setDirtyState = useCallback((next: boolean) => {
    dirtyRef.current = next
    setDirty(next)
    onDirtyChange?.(next)
  }, [onDirtyChange])

  const publishWorkspace = useCallback((next: InterviewPrepWorkspace) => {
    draftRef.current = next
    setDraft(next)
    setDirtyState(true)
    setSaveState('idle')
    onWorkspaceChange(next)
  }, [onWorkspaceChange, setDirtyState])

  const persistRecovery = useCallback(() => {
    if (!dirtyRef.current) return true
    const saved = saveRecoverableInterviewPrepDraft(scope, {
      workspace: draftRef.current,
      activeInterviewId: activeInterviewIdRef.current,
      activeTab: activeTabRef.current,
      selectedQuestionId: selectedQuestionIdRef.current,
      activeSessionId: activeSessionIdRef.current,
      mobilePane: mobilePaneRef.current,
      dirty: true,
    })
    if (!saved && !recoveryWarningShownRef.current) {
      recoveryWarningShownRef.current = true
      onNotify?.(tx(
        'localRecoveryUnavailable',
        'Local draft recovery is unavailable. This page will not reload automatically; save or discard your changes before leaving.',
      ), 'warning')
    } else if (saved) {
      recoveryWarningShownRef.current = false
    }
    return saved
  }, [onNotify, scope, tx])

  useEffect(() => {
    if (scopeKeyRef.current === scopeKey) return
    generationSequenceRef.current += 1
    scopeKeyRef.current = scopeKey
    const stored = loadRecoverableInterviewPrepDraft(scope)
    const nextWorkspace = stored?.workspace ?? canonicalWorkspace
    const nextInterviews = sortInterviewEvents(nextWorkspace.interviews)
    draftRef.current = nextWorkspace
    canonicalRevisionRef.current = canonicalWorkspace.revision
    setDraft(nextWorkspace)
    setRecovered(Boolean(stored))
    setDirtyState(Boolean(stored))
    setActiveInterviewId(
      stored?.activeInterviewId && nextWorkspace.interviews.some((item) => item.id === stored.activeInterviewId)
        ? stored.activeInterviewId
        : nextInterviews[0]?.id ?? null,
    )
    setActiveTab(stored?.activeTab ?? 'plan')
    setSelectedQuestionId(stored?.selectedQuestionId ?? null)
    setActiveSessionId(stored?.activeSessionId ?? null)
    setMobilePane(stored?.mobilePane ?? (viewer.mode === 'teacher' ? 'students' : 'interviews'))
    setSaveState('idle')
    setGenerationState('idle')
    setPendingDeleteInterviewId(null)
  }, [canonicalWorkspace, scope, scopeKey, setDirtyState, viewer.mode])

  useEffect(() => {
    if (scopeKeyRef.current !== scopeKey || dirtyRef.current) return
    canonicalRevisionRef.current = canonicalWorkspace.revision
    draftRef.current = canonicalWorkspace
    setDraft(canonicalWorkspace)
  }, [canonicalWorkspace, scopeKey])

  useEffect(() => {
    const timer = dirty ? setTimeout(persistRecovery, 180) : null
    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [dirty, draft, activeInterviewId, activeTab, selectedQuestionId, activeSessionId, mobilePane, persistRecovery])

  useEffect(() => () => {
    persistRecovery()
  }, [persistRecovery])

  useEffect(() => {
    const handlePageHide = () => persistRecovery()
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return
      persistRecovery()
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [persistRecovery])

  useEffect(() => () => {
    if (saveStateTimerRef.current) clearTimeout(saveStateTimerRef.current)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationSequenceRef.current += 1
    }
  }, [])

  const interviews = useMemo(() => sortInterviewEvents(draft.interviews), [draft.interviews])
  const activeInterview = useMemo(
    () => draft.interviews.find((interview) => interview.id === activeInterviewId) ?? null,
    [activeInterviewId, draft.interviews],
  )
  const interviewQuestions = useMemo(
    () => activeInterview ? questionsForInterview(draft, activeInterview.id) : [],
    [activeInterview, draft],
  )
  const interviewSessions = useMemo(
    () => activeInterview ? sessionsForInterview(draft, activeInterview.id) : [],
    [activeInterview, draft],
  )
  const interviewFeedback = useMemo(
    () => activeInterview ? feedbackForInterview(draft, activeInterview.id) : [],
    [activeInterview, draft],
  )
  const selectedQuestion = useMemo(
    () => interviewQuestions.find((question) => question.id === selectedQuestionId) ?? interviewQuestions[0] ?? null,
    [interviewQuestions, selectedQuestionId],
  )
  const activeSession = useMemo(
    () => interviewSessions.find((session) => session.id === activeSessionId) ?? interviewSessions[0] ?? null,
    [activeSessionId, interviewSessions],
  )
  const readiness = scoreInterviewReadiness(activeInterview, interviewQuestions, interviewSessions, interviewFeedback)
  const selectedStudent = students.find((student) => student.id === selectedStudentId) ?? null
  const teacherRosterEmpty = viewer.mode === 'teacher'
    && students.length === 0
    && !selectedStudentId
    && workspace === null
  const questionAiAvailable = Boolean(onGenerateQuestions && effectiveAiCapabilityId)
  const feedbackAiAvailable = Boolean(onGenerateFeedback && effectiveAiCapabilityId)
  const mockTurnAiAvailable = Boolean(onGenerateMockTurn && effectiveAiCapabilityId)

  useEffect(() => {
    if (!activeInterviewId && interviews[0]) setActiveInterviewId(interviews[0].id)
    if (activeInterviewId && !draft.interviews.some((interview) => interview.id === activeInterviewId)) {
      setActiveInterviewId(interviews[0]?.id ?? null)
    }
  }, [activeInterviewId, draft.interviews, interviews])

  useEffect(() => {
    if (!selectedQuestionId && interviewQuestions[0]) setSelectedQuestionId(interviewQuestions[0].id)
    if (selectedQuestionId && !interviewQuestions.some((question) => question.id === selectedQuestionId)) {
      setSelectedQuestionId(interviewQuestions[0]?.id ?? null)
    }
  }, [interviewQuestions, selectedQuestionId])

  const updateActiveInterview = useCallback((patch: Partial<InterviewEvent>) => {
    if (!activeInterview || !canEdit) return
    publishWorkspace(upsertInterviewEvent(draftRef.current, { ...activeInterview, ...patch }))
  }, [activeInterview, canEdit, publishWorkspace])

  const updateQuestion = useCallback((question: InterviewQuestion, patch: Partial<InterviewQuestion>) => {
    if (!canEdit) return
    publishWorkspace(upsertInterviewQuestion(draftRef.current, { ...question, ...patch }))
  }, [canEdit, publishWorkspace])

  const updateFeedback = useCallback((feedback: InterviewFeedback, patch: Partial<InterviewFeedback>) => {
    if (!canEdit || feedback.authorKind === 'ai') return
    publishWorkspace(upsertInterviewFeedback(draftRef.current, { ...feedback, ...patch }))
  }, [canEdit, publishWorkspace])

  const handleAddInterview = useCallback(() => {
    if (!canEdit) return
    const nextInterview = createInterviewEvent({
      ownerUserId: draftRef.current.subjectUserId,
      createdByUserId: viewer.userId,
      teamId: viewer.teamId,
    })
    publishWorkspace(upsertInterviewEvent(draftRef.current, nextInterview))
    setActiveInterviewId(nextInterview.id)
    setActiveTab('plan')
    setMobilePane('workspace')
  }, [canEdit, publishWorkspace, viewer.teamId, viewer.userId])

  const handleDeleteInterview = useCallback((interviewId: string) => {
    if (!canEdit) return
    publishWorkspace(removeInterviewEvent(draftRef.current, interviewId))
    setPendingDeleteInterviewId(null)
    setActiveInterviewId((current) => current === interviewId
      ? sortInterviewEvents(draftRef.current.interviews)[0]?.id ?? null
      : current)
  }, [canEdit, publishWorkspace])

  const handleAddQuestion = useCallback(() => {
    if (!activeInterview || !canEdit) return
    const nextQuestion = createInterviewQuestion({
      interviewId: activeInterview.id,
      createdByUserId: viewer.userId,
      source: viewer.mode === 'teacher' ? 'teacher' : 'user',
      order: interviewQuestions.length,
    })
    publishWorkspace(upsertInterviewQuestion(draftRef.current, nextQuestion))
    setSelectedQuestionId(nextQuestion.id)
  }, [activeInterview, canEdit, interviewQuestions.length, publishWorkspace, viewer.mode, viewer.userId])

  const handleDeleteQuestion = useCallback((questionId: string) => {
    if (!canEdit) return
    publishWorkspace(removeInterviewQuestion(draftRef.current, questionId))
    setSelectedQuestionId(null)
  }, [canEdit, publishWorkspace])

  const handleGenerateQuestions = useCallback(async () => {
    if (!canEdit || !activeInterview || !onGenerateQuestions || !effectiveAiCapabilityId || generationState !== 'idle') return
    const requestGeneration = ++generationSequenceRef.current
    const originScopeKey = scopeKeyRef.current
    const originSubjectUserId = draftRef.current.subjectUserId
    const originRevision = draftRef.current.revision
    const originInterviewId = activeInterview.id
    const originCapabilityId = effectiveAiCapabilityId
    const resultIsLive = () => {
      const current = draftRef.current
      const context = generationContextRef.current
      return generationSequenceRef.current === requestGeneration
        && scopeKeyRef.current === originScopeKey
        && context.scopeKey === originScopeKey
        && context.canEdit
        && context.aiCapabilityId === originCapabilityId
        && current.subjectUserId === originSubjectUserId
        && current.revision === originRevision
        && activeInterviewIdRef.current === originInterviewId
        && current.interviews.some((interview) => interview.id === originInterviewId)
    }
    const notifyDiscarded = () => onNotify?.(tx(
      'interview.aiResultDiscarded',
      'The AI result was discarded because this interview workspace changed.',
    ), 'info')
    setGenerationState('questions')
    try {
      const generated = await onGenerateQuestions({
        subjectUserId: draftRef.current.subjectUserId,
        interview: activeInterview,
        existingQuestions: interviewQuestions,
        focus: [activeInterview.program, activeInterview.advisor, activeInterview.talkingPoints].filter(Boolean).join('; '),
      })
      if (!resultIsLive()) {
        notifyDiscarded()
        return
      }
      let next = draftRef.current
      generated.forEach((question, index) => {
        next = upsertInterviewQuestion(next, {
          ...question,
          interviewId: activeInterview.id,
          source: 'ai',
          order: interviewQuestions.length + index,
        })
      })
      if (generated.length) {
        publishWorkspace(next)
        setSelectedQuestionId(generated[0].id)
        onNotify?.(tx('interview.questionsGenerated', 'Interview questions are ready.'), 'success')
      }
    } catch {
      if (!resultIsLive()) notifyDiscarded()
      else onNotify?.(tx('interview.questionsGenerateError', 'Could not generate questions. Your draft is still here.'), 'error')
    } finally {
      if (mountedRef.current && generationSequenceRef.current === requestGeneration) setGenerationState('idle')
    }
  }, [activeInterview, canEdit, effectiveAiCapabilityId, generationState, interviewQuestions, onGenerateQuestions, onNotify, publishWorkspace, tx])

  const handleStartMock = useCallback(() => {
    if (!activeInterview || !interviewQuestions.length) return
    const session = createInterviewMockSession({
      interviewId: activeInterview.id,
      ownerUserId: draftRef.current.subjectUserId,
      questionIds: interviewQuestions.map((question) => question.id),
      mode: viewer.mode === 'teacher'
        ? 'teacher'
        : (onGenerateFeedback || onGenerateMockTurn)
          ? 'ai'
          : 'self',
    })
    publishWorkspace(upsertInterviewMockSession(draftRef.current, session))
    setActiveSessionId(session.id)
  }, [activeInterview, interviewQuestions, onGenerateFeedback, onGenerateMockTurn, publishWorkspace, viewer.mode])

  const updateSession = useCallback((session: InterviewMockSession, patch: Partial<InterviewMockSession>) => {
    if (!canEdit) return
    publishWorkspace(upsertInterviewMockSession(draftRef.current, { ...session, ...patch }))
  }, [canEdit, publishWorkspace])

  const handleAnswerChange = useCallback((session: InterviewMockSession, questionId: string, body: string) => {
    const timestamp = new Date().toISOString()
    const existing = session.answers.find((answer) => answer.questionId === questionId)
    const answer: InterviewMockAnswer = {
      questionId,
      body,
      confidence: existing?.confidence ?? null,
      updatedAt: timestamp,
    }
    updateSession(session, {
      answers: existing
        ? session.answers.map((item) => item.questionId === questionId ? answer : item)
        : [...session.answers, answer],
    })
  }, [updateSession])

  const handleConfidenceChange = useCallback((session: InterviewMockSession, questionId: string, confidence: number) => {
    const timestamp = new Date().toISOString()
    const existing = session.answers.find((answer) => answer.questionId === questionId)
    const answer: InterviewMockAnswer = {
      questionId,
      body: existing?.body ?? '',
      confidence,
      updatedAt: timestamp,
    }
    updateSession(session, {
      answers: existing
        ? session.answers.map((item) => item.questionId === questionId ? answer : item)
        : [...session.answers, answer],
    })
  }, [updateSession])

  const moveMockQuestion = useCallback((session: InterviewMockSession, direction: -1 | 1) => {
    const currentIndex = Math.max(0, session.questionIds.indexOf(session.currentQuestionId || ''))
    const nextIndex = Math.min(session.questionIds.length - 1, Math.max(0, currentIndex + direction))
    updateSession(session, { currentQuestionId: session.questionIds[nextIndex] ?? null })
  }, [updateSession])

  const handleCompleteMock = useCallback((session: InterviewMockSession) => {
    updateSession(session, {
      status: 'completed',
      completedAt: new Date().toISOString(),
    })
    setActiveTab('feedback')
  }, [updateSession])

  const handleAddFeedback = useCallback(() => {
    if (!activeInterview || !canEdit) return
    const feedback = createInterviewFeedback({
      interviewId: activeInterview.id,
      sessionId: activeSession?.id,
      authorKind: viewer.mode === 'teacher' ? 'teacher' : 'self',
      authorName: viewer.displayName,
    })
    publishWorkspace(upsertInterviewFeedback(draftRef.current, feedback))
  }, [activeInterview, activeSession?.id, canEdit, publishWorkspace, viewer.displayName, viewer.mode])

  const handleGenerateFeedback = useCallback(async () => {
    if (!canEdit || !activeInterview || !activeSession || !onGenerateFeedback || !effectiveAiCapabilityId || generationState !== 'idle') return
    const requestGeneration = ++generationSequenceRef.current
    const originScopeKey = scopeKeyRef.current
    const originSubjectUserId = draftRef.current.subjectUserId
    const originRevision = draftRef.current.revision
    const originInterviewId = activeInterview.id
    const originSessionId = activeSession.id
    const originCapabilityId = effectiveAiCapabilityId
    const resultIsLive = () => {
      const current = draftRef.current
      const context = generationContextRef.current
      return generationSequenceRef.current === requestGeneration
        && scopeKeyRef.current === originScopeKey
        && context.scopeKey === originScopeKey
        && context.canEdit
        && context.aiCapabilityId === originCapabilityId
        && current.subjectUserId === originSubjectUserId
        && current.revision === originRevision
        && activeInterviewIdRef.current === originInterviewId
        && activeSessionIdRef.current === originSessionId
        && current.interviews.some((interview) => interview.id === originInterviewId)
        && current.mockSessions.some((session) => (
          session.id === originSessionId && session.interviewId === originInterviewId
        ))
    }
    const notifyDiscarded = () => onNotify?.(tx(
      'interview.aiResultDiscarded',
      'The AI result was discarded because this interview workspace changed.',
    ), 'info')
    setGenerationState('feedback')
    try {
      const generated = await onGenerateFeedback({
        subjectUserId: draftRef.current.subjectUserId,
        interview: activeInterview,
        session: activeSession,
        questions: interviewQuestions,
      })
      if (!resultIsLive()) {
        notifyDiscarded()
        return
      }
      let next = draftRef.current
      generated.forEach((feedback) => {
        next = upsertInterviewFeedback(next, {
          ...feedback,
          interviewId: activeInterview.id,
          sessionId: activeSession.id,
          authorKind: 'ai',
        })
      })
      if (generated.length) {
        publishWorkspace(next)
        onNotify?.(tx('interview.feedbackGenerated', 'AI feedback is ready for review.'), 'success')
      }
    } catch {
      if (!resultIsLive()) notifyDiscarded()
      else onNotify?.(tx('interview.feedbackGenerateError', 'Could not generate feedback. Your answers are still saved locally.'), 'error')
    } finally {
      if (mountedRef.current && generationSequenceRef.current === requestGeneration) setGenerationState('idle')
    }
  }, [activeInterview, activeSession, canEdit, effectiveAiCapabilityId, generationState, interviewQuestions, onGenerateFeedback, onNotify, publishWorkspace, tx])

  const handleGenerateMockTurn = useCallback(async (session: InterviewMockSession) => {
    if (
      !canEdit
      || !activeInterview
      || session.status === 'completed'
      || !onGenerateMockTurn
      || !effectiveAiCapabilityId
      || generationState !== 'idle'
    ) return
    const requestGeneration = ++generationSequenceRef.current
    const originScopeKey = scopeKeyRef.current
    const originSubjectUserId = draftRef.current.subjectUserId
    const originRevision = draftRef.current.revision
    const originInterviewId = activeInterview.id
    const originSessionId = session.id
    const originCapabilityId = effectiveAiCapabilityId
    const resultIsLive = () => {
      const current = draftRef.current
      const context = generationContextRef.current
      return generationSequenceRef.current === requestGeneration
        && scopeKeyRef.current === originScopeKey
        && context.scopeKey === originScopeKey
        && context.canEdit
        && context.aiCapabilityId === originCapabilityId
        && current.subjectUserId === originSubjectUserId
        && current.revision === originRevision
        && activeInterviewIdRef.current === originInterviewId
        && activeSessionIdRef.current === originSessionId
        && current.interviews.some((interview) => interview.id === originInterviewId)
        && current.mockSessions.some((candidate) => (
          candidate.id === originSessionId
          && candidate.interviewId === originInterviewId
          && candidate.status !== 'completed'
        ))
    }
    const notifyDiscarded = () => onNotify?.(tx(
      'interview.aiResultDiscarded',
      'The AI result was discarded because this interview workspace changed.',
    ), 'info')
    setGenerationState('mock-turn')
    try {
      const generated = await onGenerateMockTurn({
        subjectUserId: draftRef.current.subjectUserId,
        interview: activeInterview,
        session,
        questions: interviewQuestions,
      })
      if (!resultIsLive()) {
        notifyDiscarded()
        return
      }
      const nextQuestion = generated[0]
      if (!nextQuestion) {
        onNotify?.(tx('interview.mockTurnGenerateError', 'Could not generate a follow-up question.'), 'error')
        return
      }
      const timestamp = new Date().toISOString()
      let next = upsertInterviewQuestion(draftRef.current, {
        ...nextQuestion,
        interviewId: activeInterview.id,
        source: 'ai',
        order: interviewQuestions.length,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      const currentSession = next.mockSessions.find((candidate) => candidate.id === session.id)
      if (currentSession) {
        next = upsertInterviewMockSession(next, {
          ...currentSession,
          questionIds: [...currentSession.questionIds, nextQuestion.id],
          currentQuestionId: nextQuestion.id,
          updatedAt: timestamp,
        }, timestamp)
      }
      publishWorkspace(next)
      setSelectedQuestionId(nextQuestion.id)
      onNotify?.(tx('interview.mockTurnGenerated', 'AI follow-up question added.'), 'success')
    } catch {
      if (!resultIsLive()) notifyDiscarded()
      else onNotify?.(tx('interview.mockTurnGenerateError', 'Could not generate a follow-up question. Your answers are still saved locally.'), 'error')
    } finally {
      if (mountedRef.current && generationSequenceRef.current === requestGeneration) setGenerationState('idle')
    }
  }, [activeInterview, canEdit, effectiveAiCapabilityId, generationState, interviewQuestions, onGenerateMockTurn, onNotify, publishWorkspace, tx])

  const handleSave = useCallback(async () => {
    if (!canEdit || !dirtyRef.current || saveState === 'saving') return
    const submitted = draftRef.current
    const expectedRevision = canonicalRevisionRef.current
    setSaveState('saving')
    if (saveStateTimerRef.current) clearTimeout(saveStateTimerRef.current)
    try {
      const saved = await onSave(submitted, expectedRevision)
      if (!saved || !interviewPrepWorkspaceAcknowledged(submitted, saved, expectedRevision)) {
        throw new Error('The server did not return the saved interview workspace.')
      }
      canonicalRevisionRef.current = saved.revision
      if (draftRef.current === submitted) {
        const canonical = saved
        draftRef.current = canonical
        setDraft(canonical)
        setDirtyState(false)
        setRecovered(false)
        const recoveryCleared = clearRecoverableInterviewPrepDraft(scope)
        if (!recoveryCleared) {
          onNotify?.(tx(
            'localRecoveryUnavailable',
            'Local draft recovery is unavailable. This page will not reload automatically; save or discard your changes before leaving.',
          ), 'warning')
        }
        onWorkspaceChange(canonical)
        setSaveState('saved')
        onNotify?.(tx('interview.saved', 'Interview preparation saved.'), 'success')
        saveStateTimerRef.current = setTimeout(() => setSaveState('idle'), 1800)
      } else {
        setSaveState('idle')
        persistRecovery()
        onNotify?.(tx('interview.newerChangesRemain', 'Earlier changes were saved; newer edits still need saving.'), 'info')
      }
    } catch {
      setSaveState('error')
      persistRecovery()
      onNotify?.(tx('interview.saveError', 'Could not save. Your draft remains available to retry.'), 'error')
    }
  }, [canEdit, onNotify, onSave, onWorkspaceChange, persistRecovery, saveState, scope, setDirtyState, tx])

  const handleDiscardRecovered = useCallback(() => {
    if (!clearRecoverableInterviewPrepDraft(scope)) {
      onNotify?.(tx(
        'localRecoveryUnavailable',
        'Local draft recovery is unavailable. This page will not reload automatically; save or discard your changes before leaving.',
      ), 'warning')
      return
    }
    draftRef.current = canonicalWorkspace
    setDraft(canonicalWorkspace)
    setRecovered(false)
    setDirtyState(false)
    onWorkspaceChange(canonicalWorkspace)
    setActiveInterviewId(sortInterviewEvents(canonicalWorkspace.interviews)[0]?.id ?? null)
    setActiveTab('plan')
    setSelectedQuestionId(null)
    setActiveSessionId(null)
  }, [canonicalWorkspace, onNotify, onWorkspaceChange, scope, setDirtyState, tx])

  const handleSelectStudent = useCallback((studentId: string) => {
    if (studentId === selectedStudentId) {
      setMobilePane('interviews')
      return
    }
    if (dirtyRef.current && !persistRecovery()) return
    onSelectedStudentChange?.(studentId)
    setMobilePane('interviews')
  }, [onSelectedStudentChange, persistRecovery, selectedStudentId])

  const handleMobileBack = useCallback(() => {
    setMobilePane((current) => {
      if (current === 'coach') return 'workspace'
      if (current === 'workspace') return 'interviews'
      if (current === 'interviews' && viewer.mode === 'teacher') return 'students'
      return current
    })
  }, [viewer.mode])

  const saveLabel = saveState === 'saving'
    ? tx('interview.saving', 'Saving…')
    : saveState === 'saved'
      ? tx('interview.savedShort', 'Saved')
      : saveState === 'error'
        ? tx('interview.retrySave', 'Retry save')
        : tx('interview.save', 'Save')

  const renderPlan = () => {
    if (!activeInterview) return null
    return (
      <div className="interview-plan-form" data-testid="interview-plan">
        <div className="interview-section-heading">
          <div>
            <span className="interview-kicker">{tx('interview.planKicker', 'Interview brief')}</span>
            <h2>{titleForInterview(activeInterview, tx('interview.untitled', 'Untitled interview'))}</h2>
          </div>
          <span className={clsx('interview-status-pill', `is-${activeInterview.status}`)}>
            {statusLabel(activeInterview.status, tx)}
          </span>
        </div>

        <div className="interview-form-grid">
          <Field label={tx('interview.fieldTitle', 'Interview title')} wide>
            <input
              value={activeInterview.title}
              placeholder={tx('interview.fieldTitlePlaceholder', 'e.g. Faculty interview · Round 1')}
              onChange={(event) => updateActiveInterview({ title: event.target.value })}
              disabled={!canEdit}
            />
          </Field>
          <Field label={tx('interview.fieldSchool', 'School')}>
            <input
              value={activeInterview.school}
              onChange={(event) => updateActiveInterview({ school: event.target.value })}
              disabled={!canEdit}
            />
          </Field>
          <Field label={tx('interview.fieldProgram', 'Program')}>
            <input
              value={activeInterview.program}
              onChange={(event) => updateActiveInterview({ program: event.target.value })}
              disabled={!canEdit}
            />
          </Field>
          <Field label={tx('interview.fieldAdvisor', 'Advisor / host')}>
            <input
              value={activeInterview.advisor}
              onChange={(event) => updateActiveInterview({ advisor: event.target.value })}
              disabled={!canEdit}
            />
          </Field>
          <Field label={tx('interview.fieldDate', 'Date and time')}>
            <input
              type="datetime-local"
              value={toDateTimeInput(activeInterview.scheduledAt)}
              onChange={(event) => updateActiveInterview({ scheduledAt: fromDateTimeInput(event.target.value) })}
              disabled={!canEdit}
            />
          </Field>
          <Field label={tx('interview.fieldFormat', 'Format')}>
            <select
              value={activeInterview.format}
              onChange={(event) => updateActiveInterview({ format: event.target.value as InterviewFormat })}
              disabled={!canEdit}
            >
              {interviewFormats.map((format) => <option key={format} value={format}>{formatLabel(format, tx)}</option>)}
            </select>
          </Field>
          <Field label={tx('interview.fieldDuration', 'Duration (minutes)')}>
            <input
              type="number"
              min={5}
              max={480}
              value={activeInterview.durationMinutes}
              onChange={(event) => updateActiveInterview({ durationMinutes: Number(event.target.value) || 30 })}
              disabled={!canEdit}
            />
          </Field>
          <Field label={tx('interview.fieldStatus', 'Status')}>
            <select
              value={activeInterview.status}
              onChange={(event) => updateActiveInterview({ status: event.target.value as InterviewStatus })}
              disabled={!canEdit}
            >
              {interviewStatuses.map((status) => <option key={status} value={status}>{statusLabel(status, tx)}</option>)}
            </select>
          </Field>
          <Field label={tx('interview.fieldParticipants', 'Participants')} wide>
            <input
              value={activeInterview.participantNames.join(', ')}
              placeholder={tx('interview.fieldParticipantsPlaceholder', 'Names separated by commas')}
              onChange={(event) => updateActiveInterview({ participantNames: listFromText(event.target.value) })}
              disabled={!canEdit}
            />
          </Field>
          <Field label={tx('interview.fieldTalkingPoints', 'Key talking points')} wide>
            <textarea
              rows={4}
              value={activeInterview.talkingPoints}
              placeholder={tx('interview.fieldTalkingPointsPlaceholder', 'Research fit, recent work, why this lab…')}
              onChange={(event) => updateActiveInterview({ talkingPoints: event.target.value })}
              disabled={!canEdit}
            />
          </Field>
          <Field label={tx('interview.fieldNotes', 'Preparation notes')} wide>
            <textarea
              rows={6}
              value={activeInterview.preparationNotes}
              placeholder={tx('interview.fieldNotesPlaceholder', 'Agenda, evidence to mention, questions to clarify…')}
              onChange={(event) => updateActiveInterview({ preparationNotes: event.target.value })}
              disabled={!canEdit}
            />
          </Field>
        </div>
      </div>
    )
  }

  const renderQuestions = () => {
    if (!activeInterview) return null
    return (
      <div className="interview-question-workbench" data-testid="interview-questions">
        <div className="interview-question-toolbar">
          <div>
            <span className="interview-kicker">{tx('interview.questionBank', 'Question bank')}</span>
            <strong>{tx('interview.questionCount', `${interviewQuestions.length} questions`).replace('{count}', String(interviewQuestions.length))}</strong>
          </div>
          <div className="interview-inline-actions">
            <button
              type="button"
              className="interview-action is-ai"
              onClick={handleGenerateQuestions}
              disabled={!canEdit || !questionAiAvailable || generationState !== 'idle'}
              title={!questionAiAvailable ? tx('interview.aiUnavailable', 'Connect an AI provider to use this action.') : undefined}
            >
              {generationState === 'questions' ? <Loader2 className="is-spinning" size={14} /> : <Sparkles size={14} />}
              {generationState === 'questions'
                ? tx('interview.generating', 'Generating…')
                : tx('interview.generateQuestions', 'Generate with AI')}
            </button>
            <button type="button" className="interview-action" onClick={handleAddQuestion} disabled={!canEdit}>
              <Plus size={14} />
              {tx('interview.addQuestion', 'Add question')}
            </button>
          </div>
        </div>

        {interviewQuestions.length ? (
          <div className="interview-question-split">
            <div className="interview-question-list" role="list" aria-label={tx('interview.questionBank', 'Question bank')}>
              {interviewQuestions.map((question, index) => (
                <button
                  key={question.id}
                  type="button"
                  className={clsx('interview-question-row', selectedQuestion?.id === question.id && 'is-selected')}
                  onClick={() => setSelectedQuestionId(question.id)}
                  aria-current={selectedQuestion?.id === question.id ? 'true' : undefined}
                >
                  <span className="interview-question-index">{String(index + 1).padStart(2, '0')}</span>
                  <span>
                    <small>{categoryLabel(question.category, tx)}</small>
                    <strong>{question.prompt || tx('interview.untitledQuestion', 'Untitled question')}</strong>
                  </span>
                  {question.source === 'ai' ? <Sparkles size={13} aria-label={tx('interview.aiSource', 'AI generated')} /> : null}
                </button>
              ))}
            </div>

            {selectedQuestion ? (
              <div className="interview-question-editor">
                <div className="interview-editor-heading">
                  <span>{tx('interview.editQuestion', 'Edit question')}</span>
                  <button
                    type="button"
                    className="interview-icon-action is-danger"
                    onClick={() => handleDeleteQuestion(selectedQuestion.id)}
                    disabled={!canEdit}
                    aria-label={tx('interview.deleteQuestion', 'Delete question')}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <Field label={tx('interview.categoryLabel', 'Category')}>
                  <select
                    value={selectedQuestion.category}
                    onChange={(event) => updateQuestion(selectedQuestion, { category: event.target.value as InterviewQuestionCategory })}
                    disabled={!canEdit}
                  >
                    {interviewQuestionCategories.map((category) => (
                      <option key={category} value={category}>{categoryLabel(category, tx)}</option>
                    ))}
                  </select>
                </Field>
                <Field label={tx('interview.questionPrompt', 'Prompt')}>
                  <textarea
                    rows={6}
                    value={selectedQuestion.prompt}
                    placeholder={tx('interview.questionPromptPlaceholder', 'What should you be ready to answer?')}
                    onChange={(event) => updateQuestion(selectedQuestion, { prompt: event.target.value })}
                    disabled={!canEdit}
                  />
                </Field>
                <Field label={tx('interview.answerNotes', 'Answer outline')}>
                  <textarea
                    rows={7}
                    value={selectedQuestion.notes}
                    placeholder={tx('interview.answerNotesPlaceholder', 'Evidence, examples, and a concise answer structure…')}
                    onChange={(event) => updateQuestion(selectedQuestion, { notes: event.target.value })}
                    disabled={!canEdit}
                  />
                </Field>
              </div>
            ) : null}
          </div>
        ) : (
          <EmptyState
            icon={BookOpenText}
            title={tx('interview.noQuestions', 'Build your question bank')}
            body={tx('interview.noQuestionsBody', 'Add your own questions or ask AI to tailor a set to this program and advisor.')}
            action={canEdit ? (
              <button type="button" className="interview-action" onClick={handleAddQuestion}>
                <Plus size={14} /> {tx('interview.addFirstQuestion', 'Add first question')}
              </button>
            ) : undefined}
          />
        )}
      </div>
    )
  }

  const renderMock = () => {
    if (!activeInterview) return null
    if (!interviewQuestions.length) {
      return (
        <EmptyState
          icon={MessageSquareText}
          title={tx('interview.mockNeedsQuestions', 'Add questions before practising')}
          body={tx('interview.mockNeedsQuestionsBody', 'Your mock interview follows the order in the question bank.')}
          action={(
            <button type="button" className="interview-action" onClick={() => setActiveTab('questions')}>
              <ArrowRight size={14} /> {tx('interview.openQuestions', 'Open question bank')}
            </button>
          )}
        />
      )
    }

    if (!activeSession || activeSession.status === 'completed') {
      const answeredCount = activeSession?.answers.filter((answer) => answer.body.trim()).length ?? 0
      return (
        <div className="interview-mock-launch">
          <span className="interview-mock-orbit"><MessageSquareText size={24} /></span>
          <span className="interview-kicker">{tx('interview.mockKicker', 'Practice room')}</span>
          <h2>{tx('interview.mockTitle', 'Run a focused mock interview')}</h2>
          <p>{tx('interview.mockBody', 'Work through one question at a time. Every response is recovered locally until the workspace save is acknowledged.')}</p>
          <div className="interview-mock-meta">
            <span><BookOpenText size={14} /> {interviewQuestions.length} {tx('interview.questionsUnit', 'questions')}</span>
            <span><Clock3 size={14} /> {activeInterview.durationMinutes} {tx('interview.minutesUnit', 'min')}</span>
            {activeSession?.status === 'completed' ? (
              <span><Check size={14} /> {answeredCount}/{activeSession.questionIds.length} {tx('interview.answeredUnit', 'answered')}</span>
            ) : null}
          </div>
          <button type="button" className="interview-primary-action" onClick={handleStartMock} disabled={!canEdit}>
            <MessageSquareText size={15} />
            {activeSession?.status === 'completed'
              ? tx('interview.startAnotherMock', 'Start another mock')
              : tx('interview.startMock', 'Start mock interview')}
          </button>
        </div>
      )
    }

    const currentIndex = Math.max(0, activeSession.questionIds.indexOf(activeSession.currentQuestionId || ''))
    const currentQuestionId = activeSession.questionIds[currentIndex]
    const currentQuestion = interviewQuestions.find((question) => question.id === currentQuestionId) ?? null
    const currentAnswer = activeSession.answers.find((answer) => answer.questionId === currentQuestionId)
    const answeredCount = activeSession.answers.filter((answer) => answer.body.trim()).length
    const progress = Math.round(((currentIndex + 1) / Math.max(1, activeSession.questionIds.length)) * 100)

    return (
      <div className="interview-mock-room" data-testid="interview-mock-room">
        <div className="interview-mock-progress-row">
          <span>{tx('interview.questionProgress', 'Question {current} of {total}')
            .replace('{current}', String(currentIndex + 1))
            .replace('{total}', String(activeSession.questionIds.length))}</span>
          <span>{answeredCount} {tx('interview.answeredUnit', 'answered')}</span>
        </div>
        <div className="interview-mock-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          <span style={{ width: `${progress}%` }} />
        </div>
        {currentQuestion ? (
          <div className="interview-mock-question">
            <span className="interview-category-chip">{categoryLabel(currentQuestion.category, tx)}</span>
            <h2>{currentQuestion.prompt || tx('interview.untitledQuestion', 'Untitled question')}</h2>
            {currentQuestion.notes ? (
              <details>
                <summary><Lightbulb size={14} /> {tx('interview.revealOutline', 'Reveal answer outline')}</summary>
                <p>{currentQuestion.notes}</p>
              </details>
            ) : null}
            <Field label={tx('interview.practiceAnswer', 'Your practice answer')}>
              <textarea
                rows={9}
                value={currentAnswer?.body ?? ''}
                placeholder={tx('interview.practiceAnswerPlaceholder', 'Draft or transcribe your response here…')}
                onChange={(event) => handleAnswerChange(activeSession, currentQuestion.id, event.target.value)}
                disabled={!canEdit}
              />
            </Field>
            <div className="interview-confidence-row">
              <span>{tx('interview.confidence', 'Confidence')}</span>
              <div role="group" aria-label={tx('interview.confidence', 'Confidence')}>
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={clsx(currentAnswer?.confidence === value && 'is-selected')}
                    onClick={() => handleConfidenceChange(activeSession, currentQuestion.id, value)}
                    disabled={!canEdit}
                    aria-label={tx('interview.confidenceValue', 'Confidence {value} of 5').replace('{value}', String(value))}
                    aria-pressed={currentAnswer?.confidence === value}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}
        <div className="interview-mock-footer">
          {mockTurnAiAvailable ? (
            <button
              type="button"
              className="interview-action is-ai"
              onClick={() => void handleGenerateMockTurn(activeSession)}
              disabled={!canEdit || !currentAnswer?.body.trim() || generationState !== 'idle'}
              title={!currentAnswer?.body.trim()
                ? tx('interview.mockTurnNeedsAnswer', 'Add a practice answer before requesting a follow-up.')
                : undefined}
            >
              {generationState === 'mock-turn' ? (
                <Loader2 className="is-spinning" size={14} />
              ) : (
                <Sparkles size={14} />
              )}
              {generationState === 'mock-turn'
                ? tx('interview.mockTurnGenerating', 'Preparing follow-up…')
                : tx('interview.mockTurn', 'AI follow-up')}
            </button>
          ) : null}
          <button
            type="button"
            className="interview-action"
            onClick={() => moveMockQuestion(activeSession, -1)}
            disabled={!canEdit || currentIndex === 0}
          >
            <ChevronLeft size={15} /> {tx('interview.previous', 'Previous')}
          </button>
          {currentIndex < activeSession.questionIds.length - 1 ? (
            <button type="button" className="interview-primary-action" onClick={() => moveMockQuestion(activeSession, 1)} disabled={!canEdit}>
              {tx('interview.next', 'Next')} <ChevronRight size={15} />
            </button>
          ) : (
            <button type="button" className="interview-primary-action" onClick={() => handleCompleteMock(activeSession)} disabled={!canEdit}>
              <Check size={15} /> {tx('interview.finishMock', 'Finish and review')}
            </button>
          )}
        </div>
      </div>
    )
  }

  const renderFeedback = () => {
    if (!activeInterview) return null
    return (
      <div className="interview-feedback-workspace" data-testid="interview-feedback">
        <div className="interview-question-toolbar">
          <div>
            <span className="interview-kicker">{tx('interview.feedbackKicker', 'Review')}</span>
            <strong>{tx('interview.feedbackTitle', 'Feedback and next improvements')}</strong>
          </div>
          <div className="interview-inline-actions">
            <button
              type="button"
              className="interview-action is-ai"
              onClick={handleGenerateFeedback}
              disabled={!canEdit || !feedbackAiAvailable || !activeSession || generationState !== 'idle'}
              title={!feedbackAiAvailable ? tx('interview.aiUnavailable', 'Connect an AI provider to use this action.') : undefined}
            >
              {generationState === 'feedback' ? <Loader2 className="is-spinning" size={14} /> : <Bot size={14} />}
              {generationState === 'feedback'
                ? tx('interview.reviewing', 'Reviewing…')
                : tx('interview.generateFeedback', 'AI review')}
            </button>
            <button type="button" className="interview-action" onClick={handleAddFeedback} disabled={!canEdit}>
              <Plus size={14} />
              {viewer.mode === 'teacher'
                ? tx('interview.addTeacherFeedback', 'Add teacher feedback')
                : tx('interview.addReflection', 'Add reflection')}
            </button>
          </div>
        </div>

        {interviewFeedback.length ? (
          <div className="interview-feedback-list">
            {interviewFeedback.map((feedback) => (
              <article key={feedback.id} className={clsx('interview-feedback-entry', `is-${feedback.authorKind}`)}>
                <header>
                  <span className="interview-feedback-avatar">
                    {feedback.authorKind === 'ai' ? <Sparkles size={14} /> : feedback.authorKind === 'teacher' ? <GraduationCap size={14} /> : <UserRound size={14} />}
                  </span>
                  <span>
                    <strong>{feedback.authorName || (feedback.authorKind === 'ai'
                      ? tx('interview.aiCoach', 'AI coach')
                      : feedback.authorKind === 'teacher'
                        ? tx('interview.teacher', 'Teacher')
                        : tx('interview.selfReflection', 'Self reflection'))}</strong>
                    <small>{dateLabel(feedback.updatedAt, locale, tx('interview.justNow', 'Just now'))}</small>
                  </span>
                  {feedback.score ? <b>{feedback.score}/5</b> : null}
                </header>
                {feedback.authorKind === 'ai' || !canEdit ? (
                  <p className="interview-feedback-body">{feedback.body || tx('interview.feedbackPending', 'Feedback is being prepared.')}</p>
                ) : (
                  <textarea
                    rows={5}
                    value={feedback.body}
                    placeholder={tx('interview.feedbackPlaceholder', 'What worked, and what should change next time?')}
                    onChange={(event) => updateFeedback(feedback, { body: event.target.value })}
                    aria-label={tx('interview.feedbackBody', 'Feedback')}
                  />
                )}
                {feedback.strengths.length ? (
                  <div className="interview-feedback-points is-strength">
                    <strong>{tx('interview.strengths', 'Strengths')}</strong>
                    <ul>{feedback.strengths.map((item) => <li key={item}>{item}</li>)}</ul>
                  </div>
                ) : null}
                {feedback.improvements.length ? (
                  <div className="interview-feedback-points">
                    <strong>{tx('interview.improvements', 'Improve next')}</strong>
                    <ul>{feedback.improvements.map((item) => <li key={item}>{item}</li>)}</ul>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={ClipboardCheck}
            title={tx('interview.noFeedback', 'Turn practice into progress')}
            body={tx('interview.noFeedbackBody', 'Complete a mock interview, add a reflection, or request an AI review of the saved responses.')}
          />
        )}
      </div>
    )
  }

  const renderWorkspace = () => {
    if (!activeInterview) {
      return (
        <EmptyState
          icon={CalendarClock}
          title={tx('interview.noInterviews', 'No interview planned yet')}
          body={tx('interview.noInterviewsBody', 'Create a preparation workspace when an invitation arrives, then build questions and practise without losing your notes.')}
          action={canEdit ? (
            <button type="button" className="interview-primary-action" onClick={handleAddInterview}>
              <Plus size={15} /> {tx('interview.createInterview', 'Create interview')}
            </button>
          ) : undefined}
        />
      )
    }

    return (
      <>
        <div className="interview-workspace-topbar">
          <div className="interview-tabs" role="tablist" aria-label={tx('interview.workspaceTabs', 'Interview preparation sections')}>
            {TABS.map(({ id, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`interview-tab-${id}`}
                aria-selected={activeTab === id}
                aria-controls={`interview-panel-${id}`}
                className={clsx(activeTab === id && 'is-active')}
                onClick={() => setActiveTab(id)}
              >
                <Icon size={14} />
                {tx(interviewPrepTabLabelKey(id), id === 'plan' ? 'Plan' : id === 'questions' ? 'Questions' : id === 'mock' ? 'Mock' : 'Feedback')}
              </button>
            ))}
          </div>
          <button type="button" className="interview-mobile-coach-button" onClick={() => setMobilePane('coach')}>
            <Sparkles size={14} /> {tx('interview.coach', 'Coach')}
          </button>
        </div>
        <div
          className={clsx('interview-tab-panel', `is-${activeTab}`)}
          id={`interview-panel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`interview-tab-${activeTab}`}
        >
          {activeTab === 'plan' ? renderPlan() : null}
          {activeTab === 'questions' ? renderQuestions() : null}
          {activeTab === 'mock' ? renderMock() : null}
          {activeTab === 'feedback' ? renderFeedback() : null}
        </div>
      </>
    )
  }

  const renderCoach = () => {
    const answered = activeSession?.answers.filter((answer) => answer.body.trim()).length ?? 0
    const categories = Array.from(new Set(interviewQuestions.map((question) => question.category)))
    return (
      <div className="interview-coach-content">
        <div className="interview-coach-heading">
          <span><Sparkles size={15} /> {tx('interview.coach', 'Coach')}</span>
          <strong>{readiness}%</strong>
        </div>
        <div className="interview-readiness-track" role="progressbar" aria-label={tx('interview.readiness', 'Readiness')} aria-valuenow={readiness} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${readiness}%` }} />
        </div>
        <p>{readiness >= 80
          ? tx('interview.readinessHigh', 'Strong coverage. Refine concise delivery and leave room for follow-up questions.')
          : readiness >= 45
            ? tx('interview.readinessMedium', 'The foundation is in place. Add practice answers and review the weakest areas.')
            : tx('interview.readinessLow', 'Start with the interview brief, then prepare six focused questions.')}</p>

        <dl className="interview-coach-metrics">
          <div><dt>{tx('interview.questionsUnit', 'Questions')}</dt><dd>{interviewQuestions.length}</dd></div>
          <div><dt>{tx('interview.practiceAnswers', 'Practice answers')}</dt><dd>{answered}</dd></div>
          <div><dt>{tx('interview.reviewNotes', 'Review notes')}</dt><dd>{interviewFeedback.length}</dd></div>
        </dl>

        <div className="interview-coach-section">
          <strong>{tx('interview.coverage', 'Coverage')}</strong>
          {categories.length ? (
            <div className="interview-coach-chips">
              {categories.map((category) => <span key={category}>{categoryLabel(category, tx)}</span>)}
            </div>
          ) : <p>{tx('interview.coverageEmpty', 'No question categories covered yet.')}</p>}
        </div>

        <div className="interview-coach-section">
          <strong>{tx('interview.nextActions', 'Next actions')}</strong>
          <ol className="interview-next-actions">
            {!activeInterview?.scheduledAt ? <li>{tx('interview.actionSchedule', 'Add the confirmed interview time.')}</li> : null}
            {interviewQuestions.length < 6 ? <li>{tx('interview.actionQuestions', 'Prepare at least six tailored questions.')}</li> : null}
            {answered < Math.min(3, interviewQuestions.length) ? <li>{tx('interview.actionPractice', 'Practise three answers out loud or in writing.')}</li> : null}
            {!interviewFeedback.length ? <li>{tx('interview.actionReview', 'Capture one review after a mock session.')}</li> : null}
            {readiness >= 80 ? <li>{tx('interview.actionReady', 'Review logistics and protect a calm buffer before the call.')}</li> : null}
          </ol>
        </div>

        {activeInterview ? (
          <div className="interview-coach-context">
            <small>{tx('interview.preparingFor', 'Preparing for')}</small>
            <strong>{titleForInterview(activeInterview, tx('interview.untitled', 'Untitled interview'))}</strong>
            <span>{[activeInterview.school, activeInterview.program].filter(Boolean).join(' · ') || tx('interview.detailsPending', 'Details pending')}</span>
          </div>
        ) : null}
      </div>
    )
  }

  const mobileBackVisible = mobilePane === 'coach'
    || mobilePane === 'workspace'
    || (mobilePane === 'interviews' && viewer.mode === 'teacher')

  return (
    <section className={clsx('interview-prep-screen', className)} data-viewer-mode={viewer.mode}>
      <header className="interview-prep-header">
        <div className="interview-heading-copy">
          <span className="interview-eyebrow">{tx('interview.eyebrow', 'Interview workspace')}</span>
          <div className="interview-heading-title">
            <h1>{tx('interview.title', 'Interview Prep')}</h1>
            <InfoTooltip
              className="interview-header-info"
              content={viewer.mode === 'teacher'
                ? tx('interview.subtitleTeacher', 'Guide each student from invitation to focused practice and actionable feedback.')
                : tx('interview.subtitle', 'Plan, practise, and review every interview in one recoverable workspace.')}
            />
          </div>
        </div>
        <div className="interview-header-actions">
          {viewer.mode === 'teacher' ? (
            <label className="interview-student-select">
              <span>{tx('interview.student', 'Student')}</span>
              <select
                value={selectedStudentId ?? ''}
                onChange={(event) => handleSelectStudent(event.target.value)}
                disabled={!students.length}
              >
                <option value="" disabled>{teacherRosterEmpty
                  ? tx('interview.noStudentsShort', 'No students assigned')
                  : tx('interview.chooseStudent', 'Choose a student')}</option>
                {students.map((student) => <option key={student.id} value={student.id}>{student.displayName}</option>)}
              </select>
            </label>
          ) : null}
          <span className={clsx('interview-save-indicator', `is-${saveState}`)} aria-live="polite">
            {dirty && saveState === 'idle' ? tx('interview.unsaved', 'Unsaved changes') : saveState === 'error' ? tx('interview.saveFailed', 'Save failed') : ''}
          </span>
          <button
            type="button"
            className={clsx('interview-save-button', saveState === 'saved' && 'is-saved')}
            onClick={handleSave}
            disabled={!canEdit || !dirty || saveState === 'saving'}
          >
            {saveState === 'saving' ? <Loader2 className="is-spinning" size={14} /> : saveState === 'saved' ? <Check size={14} /> : <Save size={14} />}
            {saveLabel}
          </button>
        </div>
      </header>

      {recovered ? (
        <div className="interview-recovery-banner" role="status">
          <span><Clock3 size={15} /> {tx('interview.recovered', 'Recovered unsaved interview work from this session.')}</span>
          <button type="button" onClick={handleDiscardRecovered}>{tx('interview.discardRecovered', 'Use last saved version')}</button>
        </div>
      ) : null}

      <div className="interview-mobile-drill-header">
        {mobileBackVisible ? (
          <button type="button" onClick={handleMobileBack} aria-label={tx('interview.back', 'Back')}>
            <ArrowLeft size={16} />
          </button>
        ) : <span />}
        <strong>{mobilePane === 'students'
          ? tx('interview.students', 'Students')
          : mobilePane === 'interviews'
            ? tx('interview.interviews', 'Interviews')
            : mobilePane === 'coach'
              ? tx('interview.coach', 'Coach')
              : activeInterview
                ? titleForInterview(activeInterview, tx('interview.untitled', 'Untitled interview'))
                : tx('interview.workspace', 'Workspace')}</strong>
        <span />
      </div>

      <div className="interview-prep-layout">
        {viewer.mode === 'teacher' ? (
          <aside
            className="interview-student-pane interview-prep-pane"
            data-mobile-active={mobilePane === 'students'}
            aria-label={tx('interview.students', 'Students')}
          >
            <div className="interview-pane-heading">
              <span><UsersRound size={15} /> {tx('interview.students', 'Students')}</span>
              <small>{students.length}</small>
            </div>
            <div className="interview-student-list">
              {students.map((student) => (
                <button
                  key={student.id}
                  type="button"
                  className={clsx(student.id === selectedStudentId && 'is-selected')}
                  onClick={() => handleSelectStudent(student.id)}
                >
                  <span className="interview-student-avatar">
                    {student.avatarUrl ? <img src={student.avatarUrl} alt="" /> : initials(student.displayName)}
                  </span>
                  <span>
                    <strong>{student.displayName}</strong>
                    <small>{student.email || tx('interview.studentWorkspace', 'Student workspace')}</small>
                  </span>
                  <ArrowRight size={15} />
                </button>
              ))}
              {teacherRosterEmpty ? (
                <div className="interview-list-empty" role="status">
                  <UsersRound size={18} />
                  <span>{tx('interview.noStudentsShort', 'No students assigned')}</span>
                </div>
              ) : null}
            </div>
          </aside>
        ) : null}

        <aside
          className="interview-event-pane interview-prep-pane"
          data-mobile-active={mobilePane === 'interviews'}
          aria-label={tx('interview.interviews', 'Interviews')}
        >
          <div className="interview-pane-heading">
            <span><CalendarClock size={15} /> {tx('interview.interviews', 'Interviews')}</span>
            <button
              type="button"
              className="interview-icon-action"
              onClick={handleAddInterview}
              disabled={!canEdit}
              aria-label={tx('interview.createInterview', 'Create interview')}
            >
              <Plus size={15} />
            </button>
          </div>
          {viewer.mode === 'teacher' && selectedStudent ? (
            <div className="interview-subject-strip">
              <span className="interview-student-avatar">{initials(selectedStudent.displayName)}</span>
              <span><strong>{selectedStudent.displayName}</strong><small>{tx('interview.managedWorkspace', 'Managed workspace')}</small></span>
            </div>
          ) : null}
          <div className="interview-event-list">
            {interviews.map((interview) => (
              <div key={interview.id} className={clsx('interview-event-row', interview.id === activeInterviewId && 'is-selected')}>
                <button
                  type="button"
                  className="interview-event-main"
                  onClick={() => {
                    setActiveInterviewId(interview.id)
                    setMobilePane('workspace')
                  }}
                  aria-current={interview.id === activeInterviewId ? 'true' : undefined}
                >
                  <span className="interview-event-date"><CalendarClock size={13} /> {dateLabel(interview.scheduledAt, locale, tx('interview.dateTbd', 'Date TBD'))}</span>
                  <strong>{titleForInterview(interview, tx('interview.untitled', 'Untitled interview'))}</strong>
                  <small>{[interview.school, interview.program].filter(Boolean).join(' · ') || tx('interview.detailsPending', 'Details pending')}</small>
                  <span className="interview-event-meta">
                    <i className={`is-${interview.status}`} />
                    {statusLabel(interview.status, tx)} · {formatLabel(interview.format, tx)}
                  </span>
                </button>
                {pendingDeleteInterviewId === interview.id ? (
                  <div className="interview-inline-confirm" role="group" aria-label={tx('interview.confirmDelete', 'Delete this interview?')}>
                    <button type="button" onClick={() => handleDeleteInterview(interview.id)}>{tx('interview.delete', 'Delete')}</button>
                    <button type="button" onClick={() => setPendingDeleteInterviewId(null)}>{tx('interview.cancel', 'Cancel')}</button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="interview-event-menu"
                    onClick={() => setPendingDeleteInterviewId(interview.id)}
                    disabled={!canEdit}
                    aria-label={tx('interview.interviewActions', 'Interview actions')}
                  >
                    <MoreHorizontal size={15} />
                  </button>
                )}
              </div>
            ))}
            {!interviews.length ? (
              <div className="interview-list-empty">
                {teacherRosterEmpty ? <UsersRound size={18} /> : <CalendarClock size={18} />}
                <span>{teacherRosterEmpty
                  ? tx('interview.noStudentsShort', 'No students assigned')
                  : tx('interview.noInterviewsShort', 'No interviews yet')}</span>
              </div>
            ) : null}
          </div>
        </aside>

        <main
          className="interview-workspace-pane interview-prep-pane"
          data-mobile-active={mobilePane === 'workspace'}
        >
          {teacherRosterEmpty ? (
            <EmptyState
              icon={UsersRound}
              title={tx('interview.noStudentsTitle', 'No students to coach yet')}
              body={tx('interview.noStudentsBody', 'Assigned students will appear here when their active Team membership is ready.')}
            />
          ) : viewer.mode === 'teacher' && !selectedStudentId ? (
            <EmptyState
              icon={UsersRound}
              title={tx('interview.chooseStudentTitle', 'Choose a student to coach')}
              body={tx('interview.chooseStudentBody', 'Open a student workspace to review interview plans, practice answers, and feedback.')}
            />
          ) : renderWorkspace()}
        </main>

        <aside
          className="interview-coach-pane interview-prep-pane"
          data-mobile-active={mobilePane === 'coach'}
          aria-label={tx('interview.coach', 'Coach')}
        >
          {renderCoach()}
        </aside>
      </div>
    </section>
  )
}
