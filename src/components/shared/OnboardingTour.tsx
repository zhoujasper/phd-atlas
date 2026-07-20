import { Check, CheckCircle2, MousePointer2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { getMotionDelay } from '../hooks/useAnimatedClose'
import { useI18n } from '../hooks/useI18n'

type TourStepKey =
  | 'welcome'
  | 'open-application'
  | 'open-checklist'
  | 'expand-task'
  | 'open-correspondence'
  | 'review-reply'
  | 'open-profile'
  | 'open-ai-profile'
  | 'profile-overview'
  | 'open-mail-settings'
  | 'mail-overview'
  | 'open-ai-key'
  | 'ai-key-overview'
  | 'open-ai-composer'
  | 'open-ai-assistant'
  | 'finish'

type TourDirection = 'forward' | 'backward'

interface TourStep {
  key: TourStepKey
  target: string | null
  stage: 0 | 1 | 2 | 3 | 4 | 5
  stageLabel: string
  title: string
  body: string
  items?: string[]
  requiresTargetClick?: boolean
  actionHint?: string
  completionMessage?: string
  nextLabel?: string
  spotlightPadding?: number
  advanceDelay?: number
  placement?: 'top-right' | 'bottom-left'
}

interface HighlightRect {
  left: number
  top: number
  width: number
  height: number
  /** Outer frame radius matching the target (expanded by padding). */
  radius: string
}

const CHAPTER_COUNT = 4
const INTERACTIVE_TARGET_SELECTOR = 'button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])'
const DEFAULT_SPOTLIGHT_RADIUS = '12px'

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function viewportSize() {
  return {
    width: typeof window === 'undefined' ? 0 : window.innerWidth,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
  }
}

/** Expand each corner radius by padding so the outer frame hugs the target shape. */
function expandBorderRadius(value: string, padding: number): string {
  const raw = value.trim() || DEFAULT_SPOTLIGHT_RADIUS
  const parts = raw.split(/\s+/).map((part) => {
    if (part === '/' || part.includes('/')) return part
    const match = part.match(/^(-?[\d.]+)([a-z%]*)$/i)
    if (!match) return part
    const amount = Number(match[1])
    const unit = match[2] || 'px'
    if (!Number.isFinite(amount)) return part
    // Full pills / circles stay fully rounded outside the pad.
    if (unit === '%' || amount >= 40) return unit === '%' ? part : `${Math.max(amount, 9999)}px`
    return `${Math.max(0, amount + padding)}${unit}`
  })
  return parts.join(' ')
}

function measureHighlight(element: HTMLElement, padding = 8): HighlightRect {
  const rect = element.getBoundingClientRect()
  const viewport = viewportSize()
  const left = clamp(rect.left - padding, 0, Math.max(0, viewport.width - 1))
  const top = clamp(rect.top - padding, 0, Math.max(0, viewport.height - 1))
  const right = clamp(rect.right + padding, left + 1, viewport.width)
  const bottom = clamp(rect.bottom + padding, top + 1, viewport.height)
  let radius = DEFAULT_SPOTLIGHT_RADIUS
  try {
    const computed = window.getComputedStyle(element).borderRadius
    radius = expandBorderRadius(computed || DEFAULT_SPOTLIGHT_RADIUS, padding)
  } catch {
    // ignore computed-style failures in non-DOM environments
  }

  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
    radius,
  }
}

function rectToStyle(rect: HighlightRect): CSSProperties {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    borderRadius: rect.radius,
    ['--atlas-guide-radius' as string]: rect.radius,
  }
}

function maskStyles(rect: HighlightRect) {
  const viewport = viewportSize()
  const bottom = rect.top + rect.height
  const right = rect.left + rect.width

  return {
    top: { left: 0, top: 0, width: viewport.width, height: rect.top },
    bottom: { left: 0, top: bottom, width: viewport.width, height: Math.max(0, viewport.height - bottom) },
    left: { left: 0, top: rect.top, width: rect.left, height: rect.height },
    right: { left: right, top: rect.top, width: Math.max(0, viewport.width - right), height: rect.height },
  } satisfies Record<string, CSSProperties>
}

function isComfortablyVisible(rect: DOMRect): boolean {
  const viewport = viewportSize()
  const margin = 32
  const guideClearance = viewport.width <= 820 ? 210 : 96
  const guideRect = document.querySelector<HTMLElement>('.atlas-guide-card')?.getBoundingClientRect()
  const overlapsGuide = guideRect
    ? !(rect.right <= guideRect.left - 12
      || guideRect.right + 12 <= rect.left
      || rect.bottom <= guideRect.top - 12
      || guideRect.bottom + 12 <= rect.top)
    : false
  return !overlapsGuide &&
    rect.top >= margin &&
    rect.left >= margin &&
    rect.bottom <= viewport.height - guideClearance &&
    rect.right <= viewport.width - margin
}

function completedChapterCount(stage: TourStep['stage']): number {
  if (stage === 0) return 0
  if (stage === 5) return CHAPTER_COUNT
  return Math.min(CHAPTER_COUNT, Math.max(0, stage - 1))
}

function actionElementFor(target: HTMLElement): HTMLElement {
  if (target.matches(INTERACTIVE_TARGET_SELECTOR)) return target
  return target.closest<HTMLElement>(INTERACTIVE_TARGET_SELECTOR) ?? target
}

export default function OnboardingTour({
  onComplete,
  onStepEnter,
}: {
  onComplete: () => void
  onStepEnter?: (stepKey: TourStepKey) => void
}) {
  const { tx, format } = useI18n()
  const guideRef = useRef<HTMLDivElement | null>(null)
  const actionAdvanceTimerRef = useRef<number | null>(null)
  const focusTimerRef = useRef<number | null>(null)
  const steps = useMemo<TourStep[]>(() => [
    {
      key: 'welcome',
      target: null,
      stage: 0,
      stageLabel: tx('tour.introStage', 'Quick start'),
      title: tx('tour.welcomeTitle', 'Learn the essentials without the detour'),
      body: tx('tour.welcomeBody', 'Try four short chapters. The application practice uses a temporary sample; settings are never saved for you.'),
      items: [
        tx('tour.chapterApplications', 'Applications'),
        tx('tour.chapterProfile', 'Personal profile'),
        tx('tour.chapterMail', 'Mailbox'),
        tx('tour.chapterAi', 'AI assistant'),
      ],
      nextLabel: tx('tour.startPractice', 'Start guided setup'),
    },
    {
      key: 'open-application',
      target: '[data-tour="dashboard-application-card-target"]',
      stage: 1,
      stageLabel: tx('tour.chapterApplications', 'Applications'),
      title: tx('tour.openApplicationTitle', 'Open the sample application'),
      body: tx('tour.openApplicationBody', 'Click the highlighted card to enter its dossier.'),
      requiresTargetClick: true,
      actionHint: tx('tour.openApplicationAction', 'Click the highlighted application card'),
      completionMessage: tx('tour.openApplicationComplete', 'Opened. Entering the application dossier…'),
      spotlightPadding: 6,
      advanceDelay: 520,
    },
    {
      key: 'open-checklist',
      target: '[data-tour="dossier-tab-materials"]',
      stage: 1,
      stageLabel: tx('tour.chapterApplications', 'Applications'),
      title: tx('tour.openChecklistTitle', 'Go to the checklist'),
      body: tx('tour.openChecklistBody', 'Click Checklist to see materials and tasks for this application.'),
      requiresTargetClick: true,
      actionHint: tx('tour.openChecklistAction', 'Click the highlighted Checklist tab'),
      completionMessage: tx('tour.openChecklistComplete', 'Checklist opened. Finding a practice task…'),
      spotlightPadding: 5,
      advanceDelay: 460,
    },
    {
      key: 'expand-task',
      target: '[data-tour="checklist-task-expand"]',
      stage: 1,
      stageLabel: tx('tour.chapterApplications', 'Applications'),
      title: tx('tour.expandTaskTitle', 'Expand one task'),
      body: tx('tour.expandTaskBody', 'Open the task to reveal its due date, reminder, and notes.'),
      requiresTargetClick: true,
      actionHint: tx('tour.expandTaskAction', 'Click the highlighted expand button'),
      completionMessage: tx('tour.expandTaskComplete', 'Expanded. The task details stay with this application.'),
      spotlightPadding: 7,
      advanceDelay: 520,
    },
    {
      key: 'open-correspondence',
      target: '[data-tour="dossier-tab-mail"]',
      stage: 1,
      stageLabel: tx('tour.chapterApplications', 'Applications'),
      title: tx('tour.openCorrespondenceTitle', 'Open correspondence'),
      body: tx('tour.openCorrespondenceBody', 'Click Correspondence to review outreach and replies in one place.'),
      requiresTargetClick: true,
      actionHint: tx('tour.openCorrespondenceAction', 'Click the highlighted Correspondence tab'),
      completionMessage: tx('tour.openCorrespondenceComplete', 'Correspondence opened. Finding a sample reply…'),
      spotlightPadding: 5,
      advanceDelay: 460,
    },
    {
      key: 'review-reply',
      target: '[data-tour="communication-card"]',
      stage: 1,
      stageLabel: tx('tour.chapterApplications', 'Applications'),
      title: tx('tour.reviewReplyTitle', 'You found the professor reply'),
      body: tx('tour.reviewReplyBody', 'Each message keeps its sender, date, attachments, and summary in this timeline.'),
      nextLabel: tx('tour.toProfile', 'Continue to profile'),
      spotlightPadding: 10,
    },
    {
      key: 'open-profile',
      target: '[data-tour="nav-profile"]',
      stage: 2,
      stageLabel: tx('tour.chapterProfile', 'Personal profile'),
      title: tx('tour.openProfileTitle', 'Open your profile'),
      body: tx('tour.openProfileBody', 'Keep reusable personal information and writing preferences here.'),
      requiresTargetClick: true,
      actionHint: tx('tour.openProfileAction', 'Click the highlighted Profile button'),
      completionMessage: tx('tour.openProfileComplete', 'Profile opened. Finding your AI profile…'),
      spotlightPadding: 6,
      advanceDelay: 460,
      placement: 'bottom-left',
    },
    {
      key: 'open-ai-profile',
      target: '[data-tour="ai-profile-summary"]',
      stage: 2,
      stageLabel: tx('tour.chapterProfile', 'Personal profile'),
      title: tx('tour.openAiProfileTitle', 'Open your AI profile'),
      body: tx('tour.openAiProfileBody', 'This profile helps AI match your background and preferred writing style.'),
      requiresTargetClick: true,
      actionHint: tx('tour.openAiProfileAction', 'Click the highlighted AI profile'),
      completionMessage: tx('tour.openAiProfileComplete', 'Profile fields opened.'),
      spotlightPadding: 7,
      advanceDelay: 420,
      placement: 'bottom-left',
    },
    {
      key: 'profile-overview',
      target: '[data-tour="ai-profile-first-field"]',
      stage: 2,
      stageLabel: tx('tour.chapterProfile', 'Personal profile'),
      title: tx('tour.profileOverviewTitle', 'Tell AI how to write for you'),
      body: tx('tour.profileOverviewBody', 'Add only what is useful: identity, research interests, goals, and writing tone.'),
      nextLabel: tx('tour.toMailSettings', 'Configure mailbox'),
      spotlightPadding: 8,
      placement: 'bottom-left',
    },
    {
      key: 'open-mail-settings',
      target: '[data-tour="mail-outgoing-summary"]',
      stage: 3,
      stageLabel: tx('tour.chapterMail', 'Mailbox'),
      title: tx('tour.openMailSettingsTitle', 'Connect your sending mailbox'),
      body: tx('tour.openMailSettingsBody', 'Open SMTP settings. This guide will not enter or save credentials.'),
      requiresTargetClick: true,
      actionHint: tx('tour.openMailSettingsAction', 'Open the highlighted outgoing-mail card'),
      completionMessage: tx('tour.openMailSettingsComplete', 'Mail settings opened.'),
      spotlightPadding: 6,
      advanceDelay: 420,
    },
    {
      key: 'mail-overview',
      target: '[data-tour="mail-sender-field"]',
      stage: 3,
      stageLabel: tx('tour.chapterMail', 'Mailbox'),
      title: tx('tour.mailOverviewTitle', 'Use your provider’s mail settings'),
      body: tx('tour.mailOverviewBody', 'Add the sender, host, port, and app password, then send a test before real mail.'),
      nextLabel: tx('tour.toAiSetup', 'Continue to AI setup'),
      spotlightPadding: 8,
    },
    {
      key: 'open-ai-key',
      target: '[data-tour="ai-key-add"]',
      stage: 4,
      stageLabel: tx('tour.chapterAi', 'AI assistant'),
      title: tx('tour.openAiKeyTitle', 'Choose an AI provider'),
      body: tx('tour.openAiKeyBody', 'You can connect OpenAI, DeepSeek, Claude, or Gemini.'),
      requiresTargetClick: true,
      actionHint: tx('tour.openAiKeyAction', 'Click the highlighted Add button'),
      completionMessage: tx('tour.openAiKeyComplete', 'Provider setup opened.'),
      spotlightPadding: 7,
      advanceDelay: 420,
    },
    {
      key: 'ai-key-overview',
      target: '[data-tour="ai-key-provider-field"]',
      stage: 4,
      stageLabel: tx('tour.chapterAi', 'AI assistant'),
      title: tx('tour.aiKeyOverviewTitle', 'Connect the model you prefer'),
      body: tx('tour.aiKeyOverviewBody', 'Choose a provider and model, then paste your API key. Nothing is saved until you submit.'),
      nextLabel: tx('tour.toAiAssistant', 'See AI email assistant'),
      spotlightPadding: 8,
    },
    {
      key: 'open-ai-composer',
      target: '[data-tour="correspondence-draft-mode"]',
      stage: 4,
      stageLabel: tx('tour.chapterAi', 'AI assistant'),
      title: tx('tour.openAiComposerTitle', 'Open an email draft'),
      body: tx('tour.openAiComposerBody', 'AI lives inside the writing flow, not on a separate page.'),
      requiresTargetClick: true,
      actionHint: tx('tour.openAiComposerAction', 'Click the highlighted Draft email mode'),
      completionMessage: tx('tour.openAiComposerComplete', 'Draft editor opened. Finding the AI assistant…'),
      spotlightPadding: 6,
      advanceDelay: 460,
    },
    {
      key: 'open-ai-assistant',
      target: '[data-tour="composer-ai-trigger"]',
      stage: 4,
      stageLabel: tx('tour.chapterAi', 'AI assistant'),
      title: tx('tour.openAiAssistantTitle', 'Open the AI writing assistant'),
      body: tx('tour.openAiAssistantBody', 'Draft or reply using only the profile and application context you approve.'),
      requiresTargetClick: true,
      actionHint: tx('tour.openAiAssistantAction', 'Click the highlighted AI button'),
      completionMessage: tx('tour.openAiAssistantComplete', 'Assistant opened. You control the context and final send.'),
      spotlightPadding: 7,
      advanceDelay: 520,
    },
    {
      key: 'finish',
      target: null,
      stage: 5,
      stageLabel: tx('tour.completeStage', 'Complete'),
      title: tx('tour.finishTitle', 'Your workspace is ready to explore'),
      body: tx('tour.finishBody', 'Configure only what you need. You can replay this guide from Settings at any time.'),
      items: [
        tx('tour.chapterApplications', 'Applications'),
        tx('tour.chapterProfile', 'Personal profile'),
        tx('tour.chapterMail', 'Mailbox'),
        tx('tour.chapterAi', 'AI assistant'),
      ],
      nextLabel: tx('tour.getStarted', 'Start using PhD Atlas'),
    },
  ], [tx])

  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState<TourDirection>('forward')
  const [exiting, setExiting] = useState(false)
  const [targetRect, setTargetRect] = useState<HighlightRect | null>(null)
  const [targetRectStep, setTargetRectStep] = useState<TourStepKey | null>(null)
  const [targetState, setTargetState] = useState<'idle' | 'checking' | 'found' | 'missing'>('idle')
  const [measureToken, setMeasureToken] = useState(0)
  const [completedActions, setCompletedActions] = useState<Partial<Record<TourStepKey, boolean>>>({})
  const [actionNudge, setActionNudge] = useState(false)
  const current = steps[step]

  const finish = useCallback(() => {
    if (actionAdvanceTimerRef.current) window.clearTimeout(actionAdvanceTimerRef.current)
    if (focusTimerRef.current) window.clearTimeout(focusTimerRef.current)
    setExiting(true)
    window.setTimeout(onComplete, getMotionDelay(180))
  }, [onComplete])

  const advance = useCallback(() => {
    if (step < steps.length - 1) {
      setDirection('forward')
      setStep((value) => Math.min(steps.length - 1, value + 1))
      return
    }
    finish()
  }, [finish, step, steps.length])

  const promptForTargetClick = useCallback(() => {
    if (!current?.requiresTargetClick) return
    setActionNudge(true)
    window.setTimeout(() => setActionNudge(false), 700)
  }, [current?.requiresTargetClick])

  const next = useCallback(() => {
    if (current?.requiresTargetClick && targetState !== 'missing' && !completedActions[current.key]) {
      promptForTargetClick()
      return
    }
    advance()
  }, [advance, completedActions, current, promptForTargetClick, targetState])

  const previous = useCallback(() => {
    if (actionAdvanceTimerRef.current) window.clearTimeout(actionAdvanceTimerRef.current)
    setActionNudge(false)
    setDirection('backward')
    setStep((value) => Math.max(0, value - 1))
  }, [])

  const completeTargetAction = useCallback(() => {
    if (!current?.requiresTargetClick || completedActions[current.key]) return
    setCompletedActions((value) => ({ ...value, [current.key]: true }))
    setActionNudge(false)
    if (actionAdvanceTimerRef.current) window.clearTimeout(actionAdvanceTimerRef.current)
    actionAdvanceTimerRef.current = window.setTimeout(() => {
      actionAdvanceTimerRef.current = null
      advance()
    }, getMotionDelay(current.advanceDelay ?? 440))
  }, [advance, completedActions, current])

  useEffect(() => {
    if (!current) return
    setActionNudge(false)
    // Keep the previous spotlight geometry so the frame morphs instead of popping.
    setTargetState(current.target ? 'checking' : 'idle')
    if (!current.target) {
      setTargetRectStep(null)
    }
    onStepEnter?.(current.key)
    const timers = [
      window.setTimeout(() => setMeasureToken((value) => value + 1), 60),
      window.setTimeout(() => setMeasureToken((value) => value + 1), 180),
      window.setTimeout(() => setMeasureToken((value) => value + 1), 360),
    ]
    return () => timers.forEach((timer) => window.clearTimeout(timer))
    // App recreates the navigation callback during the state changes triggered
    // by a step. The guide should enter once for each step key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.key])

  useEffect(() => {
    if (!current?.target || typeof window === 'undefined') return undefined

    const timers: number[] = []
    const padding = current.spotlightPadding ?? 8
    const updateRect = (shouldScroll = false) => {
      const element = document.querySelector<HTMLElement>(current.target!)
      if (!element || element.getClientRects().length === 0) {
        setTargetRectStep(null)
        setTargetState('missing')
        return
      }

      const apply = () => {
        setTargetRect(measureHighlight(element, padding))
        setTargetRectStep(current.key)
        setTargetState('found')
      }

      const rect = element.getBoundingClientRect()
      if (shouldScroll && !isComfortablyVisible(rect)) {
        element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(apply)
        })
      } else {
        apply()
      }

      if (current.requiresTargetClick) {
        if (focusTimerRef.current) window.clearTimeout(focusTimerRef.current)
        focusTimerRef.current = window.setTimeout(() => {
          actionElementFor(element).focus({ preventScroll: true })
          focusTimerRef.current = null
        }, getMotionDelay(200))
      }
    }

    updateRect(true)
    ;[90, 220, 420, 700].forEach((delay) => {
      timers.push(window.setTimeout(() => updateRect(false), delay))
    })
    const updateFromViewportChange = () => updateRect(false)
    window.addEventListener('resize', updateFromViewportChange)
    window.addEventListener('scroll', updateFromViewportChange, true)

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer))
      window.removeEventListener('resize', updateFromViewportChange)
      window.removeEventListener('scroll', updateFromViewportChange, true)
    }
  }, [current, measureToken])

  useEffect(() => {
    if (!current || typeof window === 'undefined') return undefined
    const handleTargetClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (guideRef.current?.contains(target)) return
      const targetElement = current.target ? document.querySelector<HTMLElement>(current.target) : null
      const actionElement = targetElement ? actionElementFor(targetElement) : null
      if (targetElement?.contains(target) || actionElement?.contains(target)) {
        completeTargetAction()
        return
      }
      promptForTargetClick()
    }

    // A click also fires when a focused button is activated from the keyboard,
    // so the hands-on flow advances consistently for pointer and keyboard users.
    window.addEventListener('click', handleTargetClick, true)
    return () => window.removeEventListener('click', handleTargetClick, true)
  }, [completeTargetAction, current, promptForTargetClick])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        finish()
        return
      }

      const target = event.target
      if (target instanceof Node && !guideRef.current?.contains(target)) return
      if (event.key === 'ArrowRight' || event.key === 'Enter') {
        event.preventDefault()
        next()
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        previous()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [finish, next, previous])

  useEffect(() => () => {
    if (actionAdvanceTimerRef.current) window.clearTimeout(actionAdvanceTimerRef.current)
    if (focusTimerRef.current) window.clearTimeout(focusTimerRef.current)
  }, [])

  useEffect(() => {
    document.documentElement.classList.add('atlas-guide-open')
    return () => document.documentElement.classList.remove('atlas-guide-open')
  }, [])

  if (!current) return null

  // Keep last geometry for morphing; only treat as "active hole" when this step owns it.
  const activeTargetRect = targetRect && targetRectStep === current.key ? targetRect : null
  const spotlightLive = Boolean(activeTargetRect && targetState === 'found')
  const highlightStyle = targetRect ? rectToStyle(targetRect) : undefined
  const masks = activeTargetRect ? maskStyles(activeTargetRect) : null
  const actionCompleted = Boolean(completedActions[current.key])
  const completedChapters = completedChapterCount(current.stage)
  const requiresAction = Boolean(current.requiresTargetClick && targetState !== 'missing')
  const progressLabel = format(tx('tour.progressLabel', '{current} of {total} practices complete'), {
    current: completedChapters,
    total: CHAPTER_COUNT,
  })

  return (
    <div
      className={`atlas-guide-layer ${exiting ? 'exiting' : ''}`}
      data-tour-step={current.key}
      data-tour-direction={direction}
      aria-label={tx('tour.guideLabel', 'Quick start guide')}
    >
      {masks ? (
        <>
          {/* Hit-testing only — dimming comes from the rounded spotlight box-shadow. */}
          <div className="atlas-guide-mask is-hitbox" style={masks.top} onClick={promptForTargetClick} aria-hidden="true" />
          <div className="atlas-guide-mask is-hitbox" style={masks.bottom} onClick={promptForTargetClick} aria-hidden="true" />
          <div className="atlas-guide-mask is-hitbox" style={masks.left} onClick={promptForTargetClick} aria-hidden="true" />
          <div className="atlas-guide-mask is-hitbox" style={masks.right} onClick={promptForTargetClick} aria-hidden="true" />
        </>
      ) : (
        <div className="atlas-guide-mask full" onClick={promptForTargetClick} aria-hidden="true" />
      )}

      {highlightStyle ? (
        <div
          className={`atlas-guide-spotlight${spotlightLive ? ' is-live' : ' is-morphing'}${!current.target || targetState === 'missing' || targetState === 'idle' ? ' is-hidden' : ''}`}
          style={highlightStyle}
          aria-hidden="true"
        />
      ) : null}

      <section
        ref={guideRef}
        className={`atlas-guide-card placement-${current.placement ?? 'top-right'}`}
        role="dialog"
        aria-labelledby="atlas-guide-title"
        aria-describedby="atlas-guide-body"
        aria-live="polite"
      >
        <header className="atlas-guide-header">
          <span>{current.stageLabel}</span>
          <button type="button" className="atlas-guide-skip" onClick={finish}>
            {tx('tour.skip', 'Exit guide')}
          </button>
        </header>

        <div
          className="atlas-guide-progress"
          role="progressbar"
          aria-label={progressLabel}
          aria-valuemin={0}
          aria-valuemax={CHAPTER_COUNT}
          aria-valuenow={completedChapters}
        >
          {Array.from({ length: CHAPTER_COUNT }, (_, index) => {
            const chapter = index + 1
            const active = current.stage === chapter
            const done = current.stage === 5 || chapter < current.stage
            return <span key={chapter} className={`${active ? 'active' : ''} ${done ? 'done' : ''}`} />
          })}
        </div>

        <div className="atlas-guide-step-viewport">
          <div key={current.key} className={`atlas-guide-step ${direction}`}>
            <h2 id="atlas-guide-title">{current.title}</h2>
            <p id="atlas-guide-body">{current.body}</p>

            {current.items ? (
              <ol className={`atlas-guide-practice-list ${current.stage === 5 ? 'complete' : ''}`}>
                {current.items.map((item, index) => (
                  <li key={item}>
                    <span aria-hidden="true">{current.stage === 5 ? <Check size={13} /> : index + 1}</span>
                    {item}
                  </li>
                ))}
              </ol>
            ) : null}

            {current.requiresTargetClick ? (
              <div
                className={`atlas-guide-action-hint ${actionCompleted ? 'complete' : ''} ${actionNudge ? 'attention' : ''} ${targetState === 'missing' ? 'unavailable' : ''}`}
                role="status"
              >
                <span className="atlas-guide-action-icon" aria-hidden="true">
                  {actionCompleted ? <CheckCircle2 size={15} /> : <MousePointer2 size={15} />}
                </span>
                <span>
                  {actionCompleted
                    ? current.completionMessage
                    : targetState === 'missing'
                      ? tx('tour.targetUnavailable', 'This area is not visible right now. Continue to the next step.')
                      : actionNudge
                        ? tx('tour.clickHighlighted', 'Use the highlighted control to continue')
                        : current.actionHint}
                </span>
              </div>
            ) : null}
          </div>
        </div>

        <footer className="atlas-guide-actions">
          <button type="button" className="quiet-action" onClick={previous} disabled={step === 0}>
            {tx('tour.previous', 'Back')}
          </button>
          {requiresAction ? (
            <span className="atlas-guide-waiting">{tx('tour.waitingForAction', 'Waiting for your action')}</span>
          ) : (
            <button type="button" className="primary-action" onClick={next}>
              {current.nextLabel ?? tx('tour.next', 'Continue')}
            </button>
          )}
        </footer>
      </section>
    </div>
  )
}
