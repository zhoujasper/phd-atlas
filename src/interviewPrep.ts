import { clearVerifiedStorageItem, setVerifiedStorageItem } from './verifiedStorage'
import { persistedSubsetMatches } from './persistenceAcknowledgement'

export type InterviewPrepViewerMode = 'personal' | 'student' | 'teacher'

export type InterviewPrepTab = 'plan' | 'questions' | 'mock' | 'feedback'

export type InterviewPrepMobilePane = 'students' | 'interviews' | 'workspace' | 'coach'

export type InterviewFormat = 'video' | 'phone' | 'onsite' | 'panel'

export type InterviewStatus = 'preparing' | 'upcoming' | 'completed'

export type InterviewQuestionCategory =
  | 'research'
  | 'motivation'
  | 'experience'
  | 'behavioral'
  | 'technical'
  | 'advisor'
  | 'closing'

export type InterviewQuestionSource = 'library' | 'user' | 'teacher' | 'ai'

export type InterviewMockMode = 'self' | 'ai' | 'teacher'

export type InterviewMockStatus = 'in-progress' | 'completed'

export type InterviewFeedbackAuthor = 'self' | 'teacher' | 'ai'

export interface InterviewPrepViewer {
  userId: string
  displayName: string
  mode: InterviewPrepViewerMode
  canEdit: boolean
  teamId?: string | null
}

export interface InterviewPrepStudent {
  id: string
  displayName: string
  email?: string
  avatarUrl?: string | null
  interviewCount?: number
  nextInterviewAt?: string | null
}

export interface InterviewEvent {
  id: string
  ownerUserId: string
  teamId?: string | null
  applicationId?: string | null
  sourceCommunicationId?: string | null
  createdByUserId: string
  title: string
  school: string
  program: string
  advisor: string
  format: InterviewFormat
  scheduledAt: string | null
  timezone: string
  durationMinutes: number
  participantNames: string[]
  status: InterviewStatus
  preparationNotes: string
  talkingPoints: string
  createdAt: string
  updatedAt: string
}

export interface InterviewQuestion {
  id: string
  interviewId: string
  category: InterviewQuestionCategory
  prompt: string
  source: InterviewQuestionSource
  createdByUserId: string
  order: number
  notes: string
  createdAt: string
  updatedAt: string
}

export interface InterviewMockAnswer {
  questionId: string
  body: string
  confidence: number | null
  updatedAt: string
}

export interface InterviewMockSession {
  id: string
  interviewId: string
  ownerUserId: string
  mode: InterviewMockMode
  status: InterviewMockStatus
  questionIds: string[]
  currentQuestionId: string | null
  answers: InterviewMockAnswer[]
  startedAt: string
  completedAt: string | null
  updatedAt: string
}

export interface InterviewFeedback {
  id: string
  interviewId: string
  sessionId?: string | null
  questionId?: string | null
  authorKind: InterviewFeedbackAuthor
  authorName?: string
  body: string
  strengths: string[]
  improvements: string[]
  score: number | null
  createdAt: string
  updatedAt: string
}

export interface InterviewPrepWorkspace {
  subjectUserId: string
  subjectName: string
  revision: number
  interviews: InterviewEvent[]
  questions: InterviewQuestion[]
  mockSessions: InterviewMockSession[]
  feedback: InterviewFeedback[]
  updatedAt: string
}

export interface InterviewPrepRecoveryScope {
  sessionUserId: string
  subjectUserId: string
  teamId?: string | null
}

export interface InterviewPrepRecoverySnapshot {
  version: 1
  workspace: InterviewPrepWorkspace
  activeInterviewId: string | null
  activeTab: InterviewPrepTab
  selectedQuestionId: string | null
  activeSessionId: string | null
  mobilePane: InterviewPrepMobilePane
  dirty: boolean
  savedAt: string
}

export interface GenerateInterviewQuestionsRequest {
  subjectUserId: string
  interview: InterviewEvent
  existingQuestions: InterviewQuestion[]
  focus: string
}

export interface GenerateInterviewFeedbackRequest {
  subjectUserId: string
  interview: InterviewEvent
  session: InterviewMockSession
  questions: InterviewQuestion[]
}

export interface GenerateInterviewMockTurnRequest {
  subjectUserId: string
  interview: InterviewEvent
  session: InterviewMockSession
  questions: InterviewQuestion[]
}

export interface InterviewPrepAiKeyCandidate {
  id: string
  model: string
  scope: 'personal' | 'team'
  provider?: string
  baseUrl?: string
  secretSet?: boolean
  enabled?: boolean
  ownerId?: string | null
  teamId?: string | null
}

export const interviewQuestionCategories = [
  'research',
  'motivation',
  'experience',
  'behavioral',
  'technical',
  'advisor',
  'closing',
] as const satisfies readonly InterviewQuestionCategory[]

const QUESTION_SOURCES: InterviewQuestionSource[] = ['library', 'user', 'teacher', 'ai']
export const interviewFormats = ['video', 'phone', 'onsite', 'panel'] as const satisfies readonly InterviewFormat[]
export const interviewStatuses = ['preparing', 'upcoming', 'completed'] as const satisfies readonly InterviewStatus[]
const MOCK_MODES: InterviewMockMode[] = ['self', 'ai', 'teacher']
const FEEDBACK_AUTHORS: InterviewFeedbackAuthor[] = ['self', 'teacher', 'ai']
export const interviewPrepTabs = ['plan', 'questions', 'mock', 'feedback'] as const satisfies readonly InterviewPrepTab[]
const MOBILE_PANES: InterviewPrepMobilePane[] = ['students', 'interviews', 'workspace', 'coach']

export function interviewQuestionCategoryLabelKey(category: InterviewQuestionCategory): string {
  return `interview.category.${category}`
}

export function interviewFormatLabelKey(format: InterviewFormat): string {
  return `interview.format.${format}`
}

export function interviewStatusLabelKey(status: InterviewStatus): string {
  return `interview.status.${status}`
}

export function interviewPrepTabLabelKey(tab: InterviewPrepTab): string {
  return `interview.tab.${tab}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, finiteNumber(value, fallback)))
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function enumValue<T extends string>(value: unknown, choices: readonly T[], fallback: T): T {
  return typeof value === 'string' && choices.includes(value as T) ? value as T : fallback
}

function isoNow(now?: string): string {
  return now || new Date().toISOString()
}

export function createInterviewPrepId(prefix: string): string {
  const uuid = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${uuid}`
}

export function createEmptyInterviewPrepWorkspace(
  subjectUserId: string,
  subjectName: string,
  now?: string,
): InterviewPrepWorkspace {
  return {
    subjectUserId,
    subjectName,
    revision: 0,
    interviews: [],
    questions: [],
    mockSessions: [],
    feedback: [],
    updatedAt: isoNow(now),
  }
}

export function createInterviewEvent({
  ownerUserId,
  createdByUserId,
  teamId,
  now,
}: {
  ownerUserId: string
  createdByUserId: string
  teamId?: string | null
  now?: string
}): InterviewEvent {
  const timestamp = isoNow(now)
  return {
    id: createInterviewPrepId('interview'),
    ownerUserId,
    teamId: teamId ?? null,
    applicationId: null,
    sourceCommunicationId: null,
    createdByUserId,
    title: '',
    school: '',
    program: '',
    advisor: '',
    format: 'video',
    scheduledAt: null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    durationMinutes: 30,
    participantNames: [],
    status: 'preparing',
    preparationNotes: '',
    talkingPoints: '',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function createInterviewQuestion({
  interviewId,
  createdByUserId,
  source = 'user',
  order = 0,
  now,
}: {
  interviewId: string
  createdByUserId: string
  source?: InterviewQuestionSource
  order?: number
  now?: string
}): InterviewQuestion {
  const timestamp = isoNow(now)
  return {
    id: createInterviewPrepId('question'),
    interviewId,
    category: 'research',
    prompt: '',
    source,
    createdByUserId,
    order,
    notes: '',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function createInterviewMockSession({
  interviewId,
  ownerUserId,
  questionIds,
  mode = 'self',
  now,
}: {
  interviewId: string
  ownerUserId: string
  questionIds: string[]
  mode?: InterviewMockMode
  now?: string
}): InterviewMockSession {
  const timestamp = isoNow(now)
  return {
    id: createInterviewPrepId('mock'),
    interviewId,
    ownerUserId,
    mode,
    status: 'in-progress',
    questionIds: [...questionIds],
    currentQuestionId: questionIds[0] ?? null,
    answers: [],
    startedAt: timestamp,
    completedAt: null,
    updatedAt: timestamp,
  }
}

export function createInterviewFeedback({
  interviewId,
  authorKind,
  authorName,
  sessionId,
  questionId,
  now,
}: {
  interviewId: string
  authorKind: InterviewFeedbackAuthor
  authorName?: string
  sessionId?: string | null
  questionId?: string | null
  now?: string
}): InterviewFeedback {
  const timestamp = isoNow(now)
  return {
    id: createInterviewPrepId('feedback'),
    interviewId,
    sessionId: sessionId ?? null,
    questionId: questionId ?? null,
    authorKind,
    authorName,
    body: '',
    strengths: [],
    improvements: [],
    score: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function touchInterviewPrepWorkspace(
  workspace: InterviewPrepWorkspace,
  now?: string,
): InterviewPrepWorkspace {
  return {
    ...workspace,
    // Revision is a durable CAS token owned by the server. Resident edits keep
    // the last acknowledged revision so the next PUT compares against the
    // actual stored workspace instead of an optimistic client-only number.
    revision: workspace.revision,
    updatedAt: isoNow(now),
  }
}

export function upsertInterviewEvent(
  workspace: InterviewPrepWorkspace,
  event: InterviewEvent,
  now?: string,
): InterviewPrepWorkspace {
  const timestamp = isoNow(now)
  const nextEvent = { ...event, updatedAt: timestamp }
  const exists = workspace.interviews.some((item) => item.id === event.id)
  return touchInterviewPrepWorkspace({
    ...workspace,
    interviews: exists
      ? workspace.interviews.map((item) => item.id === event.id ? nextEvent : item)
      : [...workspace.interviews, nextEvent],
  }, timestamp)
}

export function removeInterviewEvent(
  workspace: InterviewPrepWorkspace,
  interviewId: string,
  now?: string,
): InterviewPrepWorkspace {
  const sessionIds = new Set(
    workspace.mockSessions.filter((session) => session.interviewId === interviewId).map((session) => session.id),
  )
  return touchInterviewPrepWorkspace({
    ...workspace,
    interviews: workspace.interviews.filter((item) => item.id !== interviewId),
    questions: workspace.questions.filter((item) => item.interviewId !== interviewId),
    mockSessions: workspace.mockSessions.filter((item) => item.interviewId !== interviewId),
    feedback: workspace.feedback.filter((item) => (
      item.interviewId !== interviewId && (!item.sessionId || !sessionIds.has(item.sessionId))
    )),
  }, now)
}

export function upsertInterviewQuestion(
  workspace: InterviewPrepWorkspace,
  question: InterviewQuestion,
  now?: string,
): InterviewPrepWorkspace {
  const timestamp = isoNow(now)
  const nextQuestion = { ...question, updatedAt: timestamp }
  const exists = workspace.questions.some((item) => item.id === question.id)
  return touchInterviewPrepWorkspace({
    ...workspace,
    questions: exists
      ? workspace.questions.map((item) => item.id === question.id ? nextQuestion : item)
      : [...workspace.questions, nextQuestion],
  }, timestamp)
}

export function removeInterviewQuestion(
  workspace: InterviewPrepWorkspace,
  questionId: string,
  now?: string,
): InterviewPrepWorkspace {
  return touchInterviewPrepWorkspace({
    ...workspace,
    questions: workspace.questions.filter((item) => item.id !== questionId),
    mockSessions: workspace.mockSessions.map((session) => ({
      ...session,
      questionIds: session.questionIds.filter((id) => id !== questionId),
      currentQuestionId: session.currentQuestionId === questionId
        ? session.questionIds.find((id) => id !== questionId) ?? null
        : session.currentQuestionId,
      answers: session.answers.filter((answer) => answer.questionId !== questionId),
    })),
    feedback: workspace.feedback.filter((item) => item.questionId !== questionId),
  }, now)
}

export function upsertInterviewMockSession(
  workspace: InterviewPrepWorkspace,
  session: InterviewMockSession,
  now?: string,
): InterviewPrepWorkspace {
  const timestamp = isoNow(now)
  const nextSession = { ...session, updatedAt: timestamp }
  const exists = workspace.mockSessions.some((item) => item.id === session.id)
  return touchInterviewPrepWorkspace({
    ...workspace,
    mockSessions: exists
      ? workspace.mockSessions.map((item) => item.id === session.id ? nextSession : item)
      : [...workspace.mockSessions, nextSession],
  }, timestamp)
}

export function upsertInterviewFeedback(
  workspace: InterviewPrepWorkspace,
  feedback: InterviewFeedback,
  now?: string,
): InterviewPrepWorkspace {
  const timestamp = isoNow(now)
  const nextFeedback = { ...feedback, updatedAt: timestamp }
  const exists = workspace.feedback.some((item) => item.id === feedback.id)
  return touchInterviewPrepWorkspace({
    ...workspace,
    feedback: exists
      ? workspace.feedback.map((item) => item.id === feedback.id ? nextFeedback : item)
      : [...workspace.feedback, nextFeedback],
  }, timestamp)
}

export function questionsForInterview(
  workspace: InterviewPrepWorkspace,
  interviewId: string,
): InterviewQuestion[] {
  return workspace.questions
    .filter((question) => question.interviewId === interviewId)
    .sort((left, right) => left.order - right.order || left.createdAt.localeCompare(right.createdAt))
}

export function feedbackForInterview(
  workspace: InterviewPrepWorkspace,
  interviewId: string,
): InterviewFeedback[] {
  return workspace.feedback
    .filter((feedback) => feedback.interviewId === interviewId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export function sessionsForInterview(
  workspace: InterviewPrepWorkspace,
  interviewId: string,
): InterviewMockSession[] {
  return workspace.mockSessions
    .filter((session) => session.interviewId === interviewId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export function sortInterviewEvents(events: InterviewEvent[]): InterviewEvent[] {
  return [...events].sort((left, right) => {
    if (left.status === 'completed' && right.status !== 'completed') return 1
    if (right.status === 'completed' && left.status !== 'completed') return -1
    const leftTime = left.scheduledAt ? Date.parse(left.scheduledAt) : Number.POSITIVE_INFINITY
    const rightTime = right.scheduledAt ? Date.parse(right.scheduledAt) : Number.POSITIVE_INFINITY
    if (leftTime !== rightTime) return leftTime - rightTime
    return right.updatedAt.localeCompare(left.updatedAt)
  })
}

function interviewPersistenceProjection(workspace: InterviewPrepWorkspace) {
  const byId = <T extends { id: string }>(items: readonly T[]) => (
    [...items].sort((left, right) => left.id.localeCompare(right.id))
  )

  return {
    subjectUserId: workspace.subjectUserId,
    interviews: byId(workspace.interviews).map((interview) => ({
      id: interview.id,
      title: interview.title,
      school: interview.school,
      program: interview.program,
      advisor: interview.advisor,
      format: interview.format,
      scheduledAt: interview.scheduledAt,
      timezone: interview.timezone,
      durationMinutes: interview.durationMinutes,
      participantNames: interview.participantNames,
      status: interview.status,
      preparationNotes: interview.preparationNotes,
      talkingPoints: interview.talkingPoints,
    })),
    questions: byId(workspace.questions).map((question) => ({
      id: question.id,
      interviewId: question.interviewId,
      category: question.category,
      prompt: question.prompt,
      source: question.source,
      order: question.order,
      notes: question.notes,
    })),
    mockSessions: byId(workspace.mockSessions).map((session) => ({
      id: session.id,
      interviewId: session.interviewId,
      mode: session.mode,
      status: session.status,
      questionIds: session.questionIds,
      currentQuestionId: session.currentQuestionId,
      answers: session.answers.map((answer) => ({
        questionId: answer.questionId,
        body: answer.body,
        confidence: answer.confidence,
      })),
      startedAt: session.startedAt,
      completedAt: session.completedAt,
    })),
    feedback: byId(workspace.feedback).map((feedback) => ({
      id: feedback.id,
      interviewId: feedback.interviewId,
      sessionId: feedback.sessionId ?? null,
      questionId: feedback.questionId ?? null,
      authorKind: feedback.authorKind,
      authorName: feedback.authorName ?? '',
      body: feedback.body,
      strengths: feedback.strengths,
      improvements: feedback.improvements,
      score: feedback.score,
    })),
  }
}

/**
 * Accepts a save only when the canonical response advances the durable
 * revision and contains every user-authored value submitted by the resident
 * editor. Server-owned authority, attribution and timestamps may still
 * advance independently.
 */
export function interviewPrepWorkspaceAcknowledged(
  submitted: InterviewPrepWorkspace,
  canonical: InterviewPrepWorkspace,
  expectedRevision: number,
): boolean {
  return canonical.subjectUserId === submitted.subjectUserId
    && Number.isSafeInteger(canonical.revision)
    && canonical.revision > expectedRevision
    && persistedSubsetMatches(
      interviewPersistenceProjection(submitted),
      interviewPersistenceProjection(canonical),
    )
}

export function selectInterviewPrepAiKey<T extends InterviewPrepAiKeyCandidate>(
  keys: readonly T[],
  actorUserId: string,
  teamId?: string | null,
): T | null {
  return keys.find((key) => (
    key.model.trim().toLowerCase() === 'gpt-5.6-luna'
    && key.secretSet === true
    && key.enabled !== false
    && key.provider?.trim().toLowerCase() === 'openai'
    && usableInterviewAiBaseUrl(key.baseUrl)
    && (teamId
      ? key.scope === 'team' && key.teamId === teamId
      : key.scope === 'personal' && key.ownerId === actorUserId)
  )) ?? null
}

function usableInterviewAiBaseUrl(value: string | undefined): boolean {
  // An exact empty string is the persisted OpenAI-provider sentinel for its
  // official HTTPS endpoint. Missing or whitespace-only values are malformed.
  if (value === '') return true
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    const parsed = new URL(value.trim())
    return parsed.protocol === 'https:'
      && Boolean(parsed.hostname)
      && !parsed.username
      && !parsed.password
  } catch {
    return false
  }
}

function normalizeInterviewEvent(value: unknown): InterviewEvent | null {
  if (!isRecord(value)) return null
  const id = stringValue(value.id)
  const ownerUserId = stringValue(value.ownerUserId)
  if (!id || !ownerUserId) return null
  const createdAt = stringValue(value.createdAt, isoNow())
  return {
    id,
    ownerUserId,
    teamId: nullableString(value.teamId),
    applicationId: nullableString(value.applicationId),
    sourceCommunicationId: nullableString(value.sourceCommunicationId),
    createdByUserId: stringValue(value.createdByUserId, ownerUserId),
    title: stringValue(value.title),
    school: stringValue(value.school),
    program: stringValue(value.program),
    advisor: stringValue(value.advisor),
    format: enumValue(value.format, interviewFormats, 'video'),
    scheduledAt: nullableString(value.scheduledAt),
    timezone: stringValue(value.timezone, 'UTC'),
    durationMinutes: Math.round(boundedNumber(value.durationMinutes, 30, 5, 480)),
    participantNames: stringList(value.participantNames),
    status: enumValue(value.status, interviewStatuses, 'preparing'),
    preparationNotes: stringValue(value.preparationNotes),
    talkingPoints: stringValue(value.talkingPoints),
    createdAt,
    updatedAt: stringValue(value.updatedAt, createdAt),
  }
}

function normalizeInterviewQuestion(value: unknown): InterviewQuestion | null {
  if (!isRecord(value)) return null
  const id = stringValue(value.id)
  const interviewId = stringValue(value.interviewId)
  if (!id || !interviewId) return null
  const createdAt = stringValue(value.createdAt, isoNow())
  return {
    id,
    interviewId,
    category: enumValue(value.category, interviewQuestionCategories, 'research'),
    prompt: stringValue(value.prompt),
    source: enumValue(value.source, QUESTION_SOURCES, 'user'),
    createdByUserId: stringValue(value.createdByUserId),
    order: Math.max(0, Math.round(finiteNumber(value.order, 0))),
    notes: stringValue(value.notes),
    createdAt,
    updatedAt: stringValue(value.updatedAt, createdAt),
  }
}

function normalizeMockAnswer(value: unknown): InterviewMockAnswer | null {
  if (!isRecord(value)) return null
  const questionId = stringValue(value.questionId)
  if (!questionId) return null
  return {
    questionId,
    body: stringValue(value.body),
    confidence: value.confidence === null || value.confidence === undefined
      ? null
      : Math.round(boundedNumber(value.confidence, 3, 1, 5)),
    updatedAt: stringValue(value.updatedAt, isoNow()),
  }
}

function normalizeMockSession(value: unknown): InterviewMockSession | null {
  if (!isRecord(value)) return null
  const id = stringValue(value.id)
  const interviewId = stringValue(value.interviewId)
  const ownerUserId = stringValue(value.ownerUserId)
  if (!id || !interviewId || !ownerUserId) return null
  const questionIds = stringList(value.questionIds)
  const startedAt = stringValue(value.startedAt, isoNow())
  return {
    id,
    interviewId,
    ownerUserId,
    mode: enumValue(value.mode, MOCK_MODES, 'self'),
    status: value.status === 'completed' ? 'completed' : 'in-progress',
    questionIds,
    currentQuestionId: questionIds.includes(stringValue(value.currentQuestionId))
      ? stringValue(value.currentQuestionId)
      : questionIds[0] ?? null,
    answers: Array.isArray(value.answers)
      ? value.answers.map(normalizeMockAnswer).filter((item): item is InterviewMockAnswer => Boolean(item))
      : [],
    startedAt,
    completedAt: nullableString(value.completedAt),
    updatedAt: stringValue(value.updatedAt, startedAt),
  }
}

function normalizeFeedback(value: unknown): InterviewFeedback | null {
  if (!isRecord(value)) return null
  const id = stringValue(value.id)
  const interviewId = stringValue(value.interviewId)
  if (!id || !interviewId) return null
  const createdAt = stringValue(value.createdAt, isoNow())
  return {
    id,
    interviewId,
    sessionId: nullableString(value.sessionId),
    questionId: nullableString(value.questionId),
    authorKind: enumValue(value.authorKind, FEEDBACK_AUTHORS, 'self'),
    authorName: stringValue(value.authorName) || undefined,
    body: stringValue(value.body),
    strengths: stringList(value.strengths),
    improvements: stringList(value.improvements),
    score: value.score === null || value.score === undefined
      ? null
      : Math.round(boundedNumber(value.score, 3, 1, 5)),
    createdAt,
    updatedAt: stringValue(value.updatedAt, createdAt),
  }
}

export function normalizeInterviewPrepWorkspace(value: unknown): InterviewPrepWorkspace | null {
  if (!isRecord(value)) return null
  const subjectUserId = stringValue(value.subjectUserId)
  if (!subjectUserId) return null
  const updatedAt = stringValue(value.updatedAt, isoNow())
  const interviews = Array.isArray(value.interviews)
    ? value.interviews.map(normalizeInterviewEvent).filter((item): item is InterviewEvent => Boolean(item))
    : []
  const interviewIds = new Set(interviews.map((interview) => interview.id))
  const questions = Array.isArray(value.questions)
    ? value.questions.map(normalizeInterviewQuestion).filter((item): item is InterviewQuestion => (
        Boolean(item) && interviewIds.has((item as InterviewQuestion).interviewId)
      ))
    : []
  const questionIds = new Set(questions.map((question) => question.id))
  const mockSessions = Array.isArray(value.mockSessions)
    ? value.mockSessions.map(normalizeMockSession).filter((item): item is InterviewMockSession => (
        Boolean(item) && interviewIds.has((item as InterviewMockSession).interviewId)
      )).map((session) => ({
        ...session,
        questionIds: session.questionIds.filter((id) => questionIds.has(id)),
        answers: session.answers.filter((answer) => questionIds.has(answer.questionId)),
      }))
    : []
  const sessionIds = new Set(mockSessions.map((session) => session.id))
  const feedback = Array.isArray(value.feedback)
    ? value.feedback.map(normalizeFeedback).filter((item): item is InterviewFeedback => (
        Boolean(item)
        && interviewIds.has((item as InterviewFeedback).interviewId)
        && (!(item as InterviewFeedback).questionId || questionIds.has((item as InterviewFeedback).questionId as string))
        && (!(item as InterviewFeedback).sessionId || sessionIds.has((item as InterviewFeedback).sessionId as string))
      ))
    : []

  return {
    subjectUserId,
    subjectName: stringValue(value.subjectName),
    revision: Math.max(0, Math.round(finiteNumber(value.revision, 0))),
    interviews,
    questions,
    mockSessions,
    feedback,
    updatedAt,
  }
}

export function interviewPrepRecoveryKey(scope: InterviewPrepRecoveryScope): string {
  const encode = (value: string) => encodeURIComponent(value || '_')
  return [
    'phd-atlas:interview-prep:v1',
    encode(scope.sessionUserId),
    encode(scope.teamId || 'personal'),
    encode(scope.subjectUserId),
  ].join(':')
}

export function loadRecoverableInterviewPrepDraft(
  scope: InterviewPrepRecoveryScope,
  storage: Pick<Storage, 'getItem'> | null = typeof sessionStorage === 'undefined' ? null : sessionStorage,
): InterviewPrepRecoverySnapshot | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(interviewPrepRecoveryKey(scope))
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value) || value.version !== 1 || value.dirty !== true) return null
    const workspace = normalizeInterviewPrepWorkspace(value.workspace)
    if (!workspace || workspace.subjectUserId !== scope.subjectUserId) return null
    return {
      version: 1,
      workspace,
      activeInterviewId: nullableString(value.activeInterviewId),
      activeTab: enumValue(value.activeTab, interviewPrepTabs, 'plan'),
      selectedQuestionId: nullableString(value.selectedQuestionId),
      activeSessionId: nullableString(value.activeSessionId),
      mobilePane: enumValue(value.mobilePane, MOBILE_PANES, 'interviews'),
      dirty: true,
      savedAt: stringValue(value.savedAt, isoNow()),
    }
  } catch {
    return null
  }
}

export function saveRecoverableInterviewPrepDraft(
  scope: InterviewPrepRecoveryScope,
  draft: Omit<InterviewPrepRecoverySnapshot, 'version' | 'savedAt'>,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof sessionStorage === 'undefined' ? null : sessionStorage,
): boolean {
  if (!storage) return false
  try {
    const serialized = JSON.stringify({
      ...draft,
      version: 1,
      savedAt: isoNow(),
    } satisfies InterviewPrepRecoverySnapshot)
    return setVerifiedStorageItem(storage, interviewPrepRecoveryKey(scope), serialized)
  } catch {
    return false
  }
}

export function clearRecoverableInterviewPrepDraft(
  scope: InterviewPrepRecoveryScope,
  storage: (Pick<Storage, 'getItem' | 'removeItem'> & Partial<Pick<Storage, 'setItem'>>) | null = typeof sessionStorage === 'undefined' ? null : sessionStorage,
): boolean {
  if (!storage) return false
  try {
    return clearVerifiedStorageItem(storage, interviewPrepRecoveryKey(scope))
  } catch {
    return false
  }
}
