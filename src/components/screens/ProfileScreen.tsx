import {
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  UploadCloud,
} from 'lucide-react'
import {
  Fragment,
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import clsx from 'clsx'
import type {
  AuthSession,
  ProfileAsset,
  ProfileAssetInput,
  ProfilePreset,
  ProfilePresetColor,
  ProfilePresetIcon as ProfilePresetIconName,
  UserSettingsPatch,
} from '../../api/phdApi'
import { contentLanguagesFromSettings } from '../../contentLanguages'
import { localeForLanguage, localizeStaticText } from '../../i18n'
import {
  groupProfileAssetsIntoFamilies,
  profileKindLabel,
} from '../../profileAssets'
import {
  effectiveProfilePresets,
  newProfilePresetId,
  profilePresetInsertLabels,
  profilePresetPresentation,
  profilePresetText,
} from '../../profilePresets'
import { useContentLanguagePacks, useI18n } from '../hooks/useI18n'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { ExplorerContextMenu, type ExplorerContextMenuState } from '../shared/ExplorerContextMenu'
import { ProfilePresetEditorDialog, type ProfilePresetEditorValue } from '../shared/ProfilePresetEditorDialog'
import { ProfilePresetIcon } from '../shared/ProfilePresetIcon'
import { InfoTooltip } from '../shared/InfoTooltip'
import type { ShareExpiry } from '../shared/shareOptions'
import { AiProfilePanel } from '../shared/AiProfilePanel'

const loadSnippetEditorDialog = () => import('../shared/SnippetEditorDialog').then((module) => ({ default: module.SnippetEditorDialog }))
const loadSnippetPhraseSettingsDialog = () => import('../shared/SnippetPhraseSettingsDialog').then((module) => ({ default: module.SnippetPhraseSettingsDialog }))
const SnippetEditorDialog = lazy(loadSnippetEditorDialog)
const SnippetPhraseSettingsDialog = lazy(loadSnippetPhraseSettingsDialog)

type FamilyCardTurn = {
  nextVersionId: string
  direction: 'forward' | 'backward'
  fromGesture: boolean
  durationMs: number
}

type QueuedFamilyCardTurn = {
  direction: 1 | -1
  fromGesture: boolean
}

type FamilySwipeDeckCard = {
  card: HTMLElement
  depth: number
  baseTransform: string
  baseOpacity: number
  forwardTransform: string
  forwardOpacity: number
  backwardTransform: string
  backwardOpacity: number
}

type FamilySwipeState = {
  pointerId: number
  startX: number
  startY: number
  lastX: number
  lastY: number
  horizontal: boolean | null
  width: number
  pendingDeltaX: number
  frame?: number
  deck: FamilySwipeDeckCard[]
}

const PROFILE_STACK_CARD_WIDTH = 224
const PROFILE_STACK_GAP = 28
const PROFILE_STACK_MOBILE_CARD_HEIGHT = 224
const PROFILE_STACK_MOBILE_GAP = 16
const PROFILE_STACK_COLLAPSED_OFFSET = 8
const PROFILE_STACK_TURN_DURATION = 440
const PROFILE_STACK_GESTURE_DURATION = 380
const PROFILE_STACK_RAPID_TURN_DURATION = 180
const PROFILE_STACK_LAYOUT_DURATION = 560
const PROFILE_STACK_VERSION_CLOSE_DURATION = 440
const PROFILE_STACK_VERSION_CLOSE_STAGGER = 32
const PROFILE_STACK_MAX_STAGGERED_VERSIONS = 12
const PROFILE_STACK_SETTLE_BUFFER = 40
const PROFILE_STACK_MAX_QUEUED_TURNS = 10

const profileStackDepthStyle = (
  depth: number,
  targetDepth: number,
  versionCount: number,
): CSSProperties => {
  const visibleDepth = Math.min(depth, 3)
  const visibleTargetDepth = Math.min(targetDepth, 3)
  const hidden = depth > 3
  const targetHidden = targetDepth > 3
  return {
    ['--snippet-deck-transform' as string]: `var(--snippet-stack-depth-${visibleDepth}-transform)`,
    ['--snippet-deck-opacity' as string]: hidden ? '0' : `var(--snippet-stack-depth-${visibleDepth}-opacity)`,
    ['--snippet-deck-z' as string]: String(hidden ? 0 : Math.max(1, versionCount - depth + 1)),
    ['--snippet-deck-target-transform' as string]: `var(--snippet-stack-depth-${visibleTargetDepth}-transform)`,
    ['--snippet-deck-target-opacity' as string]: targetHidden ? '0' : `var(--snippet-stack-depth-${visibleTargetDepth}-opacity)`,
    ['--snippet-deck-target-z' as string]: String(targetHidden ? 0 : Math.max(1, versionCount - targetDepth + 1)),
  }
}

const profileStackTargetDepth = (
  depth: number,
  versionCount: number,
  direction: FamilyCardTurn['direction'],
) => direction === 'forward'
  ? (depth === 0 ? versionCount - 1 : depth - 1)
  : (depth === versionCount - 1 ? 0 : depth + 1)

const interpolateProfileStackTransform = (from: string, to: string, progress: number) => {
  if (typeof DOMMatrix === 'undefined' || !from || !to) return progress < 0.5 ? from : to
  try {
    const start = new DOMMatrix(from)
    const end = new DOMMatrix(to)
    const lerp = (startValue: number, endValue: number) => startValue + (endValue - startValue) * progress
    // Deck poses only need translation and a uniform scale. Interpolating every
    // matrix component can briefly introduce shear/non-uniform scale on mobile,
    // which looks like the card is being stretched during a fast swipe.
    const startScale = Math.hypot(start.m11, start.m12, start.m13)
    const endScale = Math.hypot(end.m11, end.m12, end.m13)
    return `translate3d(${lerp(start.m41, end.m41)}px, ${lerp(start.m42, end.m42)}px, ${lerp(start.m43, end.m43)}px) scale(${lerp(startScale, endScale)})`
  } catch {
    return progress < 0.5 ? from : to
  }
}

export function ProfileScreen({
  assets,
  session,
  onCreateSnippet,
  onUpdateAsset,
  onDeleteAsset,
  removingAssetIds,
  onUploadFiles,
  onRenameFile,
  onDeleteFile,
  onDownloadFile,
  onCreateShare,
  onRevokeShare,
  onUpdateSettings,
  onCopy,
  deferProgressiveReveal = false,
}: {
  assets: ProfileAsset[]
  session: AuthSession
  onCreateSnippet: (input: ProfileAssetInput, files: File[]) => void
  onUpdateAsset: (id: string, input: Partial<ProfileAssetInput>) => void
  onDeleteAsset: (asset: ProfileAsset) => void
  /** Asset ids retained briefly while their confirmed delete animation runs. */
  removingAssetIds?: ReadonlySet<string>
  onUploadFiles: (assetId: string, files: File[]) => void | Promise<void>
  onRenameFile: (assetId: string, fileId: string, fileName: string) => void
  onDeleteFile: (assetId: string, fileId: string) => void
  onDownloadFile: (fileId: string, fileName: string) => void
  onCreateShare: (assetId: string, expiry: ShareExpiry, note: string) => void
  onRevokeShare: (assetId: string, shareId: string) => void
  onUpdateSettings: (patch: UserSettingsPatch, message?: string) => void
  onCopy?: (value: string, label: string) => void
  /** Hold large asset and preset grids until the enclosing screen handoff ends. */
  deferProgressiveReveal?: boolean
}) {
  const { tx, lang, format } = useI18n()
  const contentLanguages = useMemo(
    () => contentLanguagesFromSettings(session.user.settings),
    [session.user.settings.contentLanguagePrimary, session.user.settings.contentLanguageSecondary],
  )
  useContentLanguagePacks(contentLanguages)
  const [query, setQuery] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [openShareOnEdit, setOpenShareOnEdit] = useState(false)
  const [snippetSeed, setSnippetSeed] = useState<{
    kind: string
    name?: string
    content?: string
    customLabelZh?: string
    customLabelEn?: string
    icon?: ProfilePresetIconName
    color?: ProfilePresetColor
    fromPreset?: boolean
    familyId?: string
    familyName?: string
    versionLabel?: string
    versionNumber?: number
    isPrimary?: boolean
  } | null>(null)
  const [expandedFamilies, setExpandedFamilies] = useState<Set<string>>(() => new Set())
  const [activeFamilyVersionIds, setActiveFamilyVersionIds] = useState<Map<string, string>>(() => new Map())
  const activeFamilyVersionIdsRef = useRef(activeFamilyVersionIds)
  activeFamilyVersionIdsRef.current = activeFamilyVersionIds
  const [familyTurns, setFamilyTurns] = useState<Map<string, FamilyCardTurn>>(() => new Map())
  const familyStackRefs = useRef(new Map<string, HTMLElement>())
  const familyFrontRefs = useRef(new Map<string, HTMLDivElement>())
  const familyWheelStateRef = useRef(new Map<string, {
    delta: number
    releaseTimer?: number
    lastEventAt?: number
    lastDirection?: 1 | -1
  }>())
  const familySwipeStateRef = useRef(new Map<string, FamilySwipeState>())
  const familyBrowseLocksRef = useRef(new Set<string>())
  const familyTurnQueuesRef = useRef(new Map<string, QueuedFamilyCardTurn[]>())
  const familyQueuedTurnFramesRef = useRef(new Map<string, number>())
  const familyTurnAccelerationFramesRef = useRef(new Map<string, number>())
  const swipeClickSuppressionsRef = useRef(new Map<string, number>())
  const familyTurnTimersRef = useRef(new Map<string, number>())
  const familyTurnSettlersRef = useRef(new Map<string, () => void>())
  const pendingFamilyLayoutFlipRef = useRef<Map<HTMLElement, DOMRect> | null>(null)
  const familyLayoutAnimationsRef = useRef<Animation[]>([])
  const [presetEditorOpen, setPresetEditorOpen] = useState(false)
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null)
  const [pendingDeletePreset, setPendingDeletePreset] = useState<ProfilePreset | null>(null)
  /** Newly created preset id — drives a one-shot enter animation after save. */
  const [enteredPresetId, setEnteredPresetId] = useState<string | null>(null)
  /** Preset mid-exit animation; actual removal runs after animation ends. */
  const [exitingPresetId, setExitingPresetId] = useState<string | null>(null)
  const exitingPresetIdRef = useRef<string | null>(null)
  const [phraseSettingsOpen, setPhraseSettingsOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<ExplorerContextMenuState | null>(null)

  const editingAsset = editingId ? assets.find((asset) => asset.id === editingId) ?? null : null

  const displayAssets = useMemo(
    () => deferProgressiveReveal ? [] : assets.map((asset) => ({
        raw: asset,
        display: {
          // Library chrome always follows appearance language.
          name: localizeStaticText(asset.name, lang),
          kind: profileKindLabel(asset.kind, lang, { zh: asset.customLabelZh, en: asset.customLabelEn }, contentLanguages),
          description: localizeStaticText(asset.description, lang),
        },
      })),
    [assets, contentLanguages, deferProgressiveReveal, lang],
  )

  const personalPresets = useMemo(
    // Dual-slot insert copy follows content languages; card titles still use UI lang via profilePresetText.
    () => effectiveProfilePresets(session.user.settings.profilePresets, contentLanguages),
    [contentLanguages, session.user.settings.profilePresets],
  )
  const personalPresetsRef = useRef(personalPresets)
  personalPresetsRef.current = personalPresets
  const editingPreset = editingPresetId
    ? personalPresets.find((preset) => preset.id === editingPresetId) ?? null
    : null

  const filtered = useMemo(() => {
    if (!query.trim()) return displayAssets
    const needle = query.toLowerCase()
    return displayAssets.filter(
      ({ raw, display }) =>
        raw.name.toLowerCase().includes(needle) ||
        raw.description.toLowerCase().includes(needle) ||
        raw.kind.toLowerCase().includes(needle) ||
        (raw.versionLabel || '').toLowerCase().includes(needle) ||
        (raw.familyName || '').toLowerCase().includes(needle) ||
        display.name.toLowerCase().includes(needle) ||
        display.description.toLowerCase().includes(needle) ||
        display.kind.toLowerCase().includes(needle),
    )
  }, [displayAssets, query])

  const filteredAssets = useMemo(() => filtered.map((item) => item.raw), [filtered])
  const families = useMemo(() => groupProfileAssetsIntoFamilies(filteredAssets), [filteredAssets])

  useEffect(() => () => {
    familyTurnTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    familyTurnTimersRef.current.clear()
    familyTurnSettlersRef.current.clear()
    familyWheelStateRef.current.forEach(({ releaseTimer }) => {
      if (releaseTimer !== undefined) window.clearTimeout(releaseTimer)
    })
    familyWheelStateRef.current.clear()
    familySwipeStateRef.current.forEach(({ frame }) => {
      if (frame !== undefined) window.cancelAnimationFrame(frame)
    })
    familySwipeStateRef.current.clear()
    familyBrowseLocksRef.current.clear()
    familyTurnQueuesRef.current.clear()
    familyQueuedTurnFramesRef.current.forEach((frame) => window.cancelAnimationFrame(frame))
    familyQueuedTurnFramesRef.current.clear()
    familyTurnAccelerationFramesRef.current.forEach((frame) => window.cancelAnimationFrame(frame))
    familyTurnAccelerationFramesRef.current.clear()
    swipeClickSuppressionsRef.current.clear()
    familyLayoutAnimationsRef.current.forEach((animation) => animation.cancel())
    familyLayoutAnimationsRef.current = []
  }, [])

  useLayoutEffect(() => {
    const versionLookup = new Map(families.map((family) => [family.familyId, family.versions]))
    const listeners = [...familyStackRefs.current.entries()].map(([familyId, stack]) => {
      const onWheel = (event: WheelEvent) => {
        if (expandedFamilies.has(familyId)) return
        handleFamilyWheel(event, familyId, versionLookup.get(familyId) ?? [])
      }
      // Keep the non-passive listener on the stable family shell. The front card changes
      // identity after every turn, while this article remains mounted for the whole deck.
      stack.addEventListener('wheel', onWheel, { passive: false })
      return { stack, onWheel }
    })

    return () => listeners.forEach(({ stack, onWheel }) => stack.removeEventListener('wheel', onWheel))
  }, [expandedFamilies, families])

  const prefersReducedMotion = () => typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const cycleFamilyVersion = (
    familyId: string,
    versions: ProfileAsset[],
    direction: 1 | -1,
    fromGesture = false,
    rapid = false,
  ) => {
    if (versions.length < 2) return false
    if (familyBrowseLocksRef.current.has(familyId)) {
      const queuedTurns = familyTurnQueuesRef.current.get(familyId) ?? []
      const lastQueuedTurn = queuedTurns.at(-1)
      if (lastQueuedTurn && lastQueuedTurn.direction === -direction) {
        queuedTurns.pop()
      } else if (queuedTurns.length < PROFILE_STACK_MAX_QUEUED_TURNS) {
        queuedTurns.push({ direction, fromGesture })
      }
      if (queuedTurns.length) familyTurnQueuesRef.current.set(familyId, queuedTurns)
      else familyTurnQueuesRef.current.delete(familyId)
      const settleCurrentTurn = familyTurnSettlersRef.current.get(familyId)
      if (settleCurrentTurn && !prefersReducedMotion()) {
        // Accelerate the animations that are already running instead of changing
        // animation-duration through React, which can restart CSS animation and flash.
        const stack = familyStackRefs.current.get(familyId)
        const shortenSettleTimer = () => {
          const activeTimer = familyTurnTimersRef.current.get(familyId)
          if (activeTimer !== undefined) window.clearTimeout(activeTimer)
          familyTurnTimersRef.current.set(familyId, window.setTimeout(
            settleCurrentTurn,
            PROFILE_STACK_RAPID_TURN_DURATION + PROFILE_STACK_SETTLE_BUFFER,
          ))
        }
        const accelerateRunningAnimations = () => {
          let accelerated = false
          stack?.querySelectorAll<HTMLElement>('.snippet-stack-deck-card').forEach((card) => {
            if (typeof card.getAnimations !== 'function') return
            card.getAnimations().forEach((animation) => {
              accelerated = true
              animation.updatePlaybackRate(PROFILE_STACK_TURN_DURATION / PROFILE_STACK_RAPID_TURN_DURATION)
            })
          })
          return accelerated
        }
        if (accelerateRunningAnimations()) {
          shortenSettleTimer()
        } else if (!familyTurnAccelerationFramesRef.current.has(familyId)) {
          // A second wheel event can arrive before React has committed the first
          // turning class. Retry after that commit instead of settling a 440ms
          // animation at 180ms and producing a snap on an immediate page return.
          const frame = window.requestAnimationFrame(() => {
            familyTurnAccelerationFramesRef.current.delete(familyId)
            if (familyBrowseLocksRef.current.has(familyId) && accelerateRunningAnimations()) shortenSettleTimer()
          })
          familyTurnAccelerationFramesRef.current.set(familyId, frame)
        }
      }
      return true
    }

    const activeId = activeFamilyVersionIdsRef.current.get(familyId)
    const activeIndex = Math.max(0, versions.findIndex((version) => version.id === activeId))
    const nextIndex = (activeIndex + direction + versions.length) % versions.length
    const nextVersion = versions[nextIndex]
    if (!nextVersion) return false

    familyBrowseLocksRef.current.add(familyId)
    const durationMs = fromGesture
      ? PROFILE_STACK_GESTURE_DURATION
      : rapid
        ? PROFILE_STACK_RAPID_TURN_DURATION
        : PROFILE_STACK_TURN_DURATION
    const front = familyFrontRefs.current.get(familyId)
    front?.parentElement?.querySelectorAll<HTMLElement>('.snippet-stack-deck-card').forEach((card) => {
      const currentStyle = window.getComputedStyle(card)
      if (currentStyle.transform !== 'none') card.style.setProperty('--snippet-deck-turn-from', currentStyle.transform)
      card.style.setProperty('--snippet-deck-turn-opacity-from', currentStyle.opacity)
    })
    setFamilyTurns((current) => {
      const next = new Map(current)
      next.set(familyId, {
        nextVersionId: nextVersion.id,
        direction: direction > 0 ? 'forward' : 'backward',
        fromGesture,
        durationMs,
      })
      return next
    })

    const previousTimer = familyTurnTimersRef.current.get(familyId)
    if (previousTimer !== undefined) window.clearTimeout(previousTimer)
    const settleTurn = () => {
      const settledFront = familyFrontRefs.current.get(familyId)
      settledFront?.parentElement?.querySelectorAll<HTMLElement>('.snippet-stack-deck-card').forEach((card) => {
        card.style.removeProperty('--snippet-deck-turn-from')
        card.style.removeProperty('--snippet-deck-turn-opacity-from')
        card.style.removeProperty('transform')
        card.style.removeProperty('opacity')
      })
      const nextActiveVersions = new Map(activeFamilyVersionIdsRef.current)
      nextActiveVersions.set(familyId, nextVersion.id)
      activeFamilyVersionIdsRef.current = nextActiveVersions
      setActiveFamilyVersionIds(nextActiveVersions)
      setFamilyTurns((current) => {
        const next = new Map(current)
        next.delete(familyId)
        return next
      })
      familyTurnTimersRef.current.delete(familyId)
      familyTurnSettlersRef.current.delete(familyId)
      familyBrowseLocksRef.current.delete(familyId)
      const accelerationFrame = familyTurnAccelerationFramesRef.current.get(familyId)
      if (accelerationFrame !== undefined) window.cancelAnimationFrame(accelerationFrame)
      familyTurnAccelerationFramesRef.current.delete(familyId)

      const queuedTurns = familyTurnQueuesRef.current.get(familyId)
      const queuedTurn = queuedTurns?.shift()
      if (!queuedTurns?.length) familyTurnQueuesRef.current.delete(familyId)
      if (queuedTurn) {
        const previousFrame = familyQueuedTurnFramesRef.current.get(familyId)
        if (previousFrame !== undefined) window.cancelAnimationFrame(previousFrame)
        const frame = window.requestAnimationFrame(() => {
          familyQueuedTurnFramesRef.current.delete(familyId)
          cycleFamilyVersion(familyId, versions, queuedTurn.direction, queuedTurn.fromGesture, true)
        })
        familyQueuedTurnFramesRef.current.set(familyId, frame)
      }
    }
    familyTurnSettlersRef.current.set(familyId, settleTurn)
    if (prefersReducedMotion()) {
      settleTurn()
    } else {
      familyTurnTimersRef.current.set(familyId, window.setTimeout(
        settleTurn,
        durationMs + PROFILE_STACK_SETTLE_BUFFER,
      ))
    }

    return true
  }

  const handleFamilyWheel = (
    event: WheelEvent,
    familyId: string,
    versions: ProfileAsset[],
  ) => {
    if (event.ctrlKey || event.metaKey || versions.length < 2 || event.deltaY === 0) return

    event.preventDefault()
    const wheelState = familyWheelStateRef.current.get(familyId) ?? { delta: 0 }
    const eventAt = event.timeStamp > 0 ? event.timeStamp : performance.now()
    const rapid = wheelState.lastEventAt !== undefined && eventAt - wheelState.lastEventAt < 130
    wheelState.lastEventAt = eventAt
    if (wheelState.releaseTimer !== undefined) window.clearTimeout(wheelState.releaseTimer)
    wheelState.releaseTimer = window.setTimeout(() => {
      familyWheelStateRef.current.set(familyId, { delta: 0 })
    }, PROFILE_STACK_TURN_DURATION)

    const pageSize = Math.max(event.currentTarget instanceof HTMLElement ? event.currentTarget.clientHeight : 0, 278)
    const normalizedDelta = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? pageSize
        : 1)
    const inputDirection: 1 | -1 = normalizedDelta > 0 ? 1 : -1
    if (wheelState.lastDirection && wheelState.lastDirection !== inputDirection) wheelState.delta = 0
    wheelState.lastDirection = inputDirection
    // Keep every event relative and bounded: high-resolution trackpads retain their
    // fine-grained motion while a single large mouse-wheel delta cannot skip a deck.
    wheelState.delta += Math.max(-120, Math.min(120, normalizedDelta))

    if (Math.abs(wheelState.delta) < 36) {
      familyWheelStateRef.current.set(familyId, wheelState)
      return
    }

    const direction = wheelState.delta > 0 ? 1 : -1
    // One physical wheel event should produce at most one card turn (mouse wheels
    // commonly report 80-120px per notch). Keep the remainder so a continuous
    // trackpad stream can immediately enqueue the following turn without a dead zone.
    wheelState.delta -= direction * 36
    familyWheelStateRef.current.set(familyId, wheelState)
    cycleFamilyVersion(familyId, versions, direction, false, rapid)
  }

  const resetFamilySwipeVisual = (familyId: string, settle = false, preserveTurnOrigin = false) => {
    const front = familyFrontRefs.current.get(familyId)
    if (!front) return

    const transform = front.style.transform
    const opacity = front.style.opacity
    front.classList.remove('is-swiping')
    front.parentElement?.querySelectorAll<HTMLElement>('.snippet-stack-deck-card').forEach((card) => {
      if (preserveTurnOrigin) {
        // The swipe frame is already inline, so preserve it without another forced
        // style calculation at pointer release. cycleFamilyVersion has a computed
        // fallback for non-swipe turns.
        if (card.style.transform) card.style.setProperty('--snippet-deck-turn-from', card.style.transform)
        if (card.style.opacity) card.style.setProperty('--snippet-deck-turn-opacity-from', card.style.opacity)
      } else {
        card.style.removeProperty('--snippet-deck-turn-from')
        card.style.removeProperty('--snippet-deck-turn-opacity-from')
      }
      card.style.removeProperty('transform')
      card.style.removeProperty('opacity')
    })

    if (settle && transform && !prefersReducedMotion() && typeof front.animate === 'function') {
      front.animate(
        [
          { transform, opacity: opacity || '1' },
          { transform: 'translate3d(0, 0, 0) scale(1)', opacity: '1' },
        ],
        { duration: 180, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      )
    }
  }

  const handleFamilyPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
    familyId: string,
  ) => {
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return
    if (event.target instanceof Element && event.target.closest('.snippet-stack-toggle, .snippet-card-actions')) return

    const deckElements = [...(event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('.snippet-stack-deck-card') ?? [])]
    const versionCount = deckElements.length
    const deck = deckElements.map<FamilySwipeDeckCard>((card) => {
      const depth = Number(card.dataset.stackDepth ?? 0)
      const computed = window.getComputedStyle(card)
      const baseTransform = computed.transform === 'none' ? 'matrix(1, 0, 0, 1, 0, 0)' : computed.transform
      const baseOpacity = Number(computed.opacity) || 0
      const poseAt = (targetDepth: number) => {
        const visibleDepth = Math.min(targetDepth, 3)
        return {
          transform: computed.getPropertyValue(`--snippet-stack-depth-${visibleDepth}-transform`).trim() || baseTransform,
          opacity: targetDepth > 3
            ? 0
            : Number(computed.getPropertyValue(`--snippet-stack-depth-${visibleDepth}-opacity`).trim()) || 0,
        }
      }
      const forward = poseAt(profileStackTargetDepth(depth, versionCount, 'forward'))
      const backward = poseAt(profileStackTargetDepth(depth, versionCount, 'backward'))
      return {
        card,
        depth,
        baseTransform,
        baseOpacity,
        forwardTransform: forward.transform,
        forwardOpacity: forward.opacity,
        backwardTransform: backward.transform,
        backwardOpacity: backward.opacity,
      }
    })

    familySwipeStateRef.current.set(familyId, {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      horizontal: null,
      width: Math.max(event.currentTarget.clientWidth, 1),
      pendingDeltaX: 0,
      deck,
    })
  }

  const applyFamilySwipeVisual = (
    front: HTMLDivElement,
    deltaX: number,
    previewDirection: FamilyCardTurn['direction'],
    swipeState: FamilySwipeState,
  ) => {
    const width = swipeState.width
    const offset = Math.max(-width * 0.72, Math.min(width * 0.72, deltaX))
    const progress = Math.max(-1, Math.min(1, offset / width))
    const lift = Math.min(1, Math.abs(progress) * 2)
    const turn = progress * 8
    front.classList.add('is-swiping')
    front.style.transform = `translate3d(${offset}px, ${-lift * 8}px, ${lift * 18}px) rotateY(${turn}deg) scale(${1 - lift * 0.025})`
    front.style.opacity = String(1 - lift * 0.28)

    swipeState.deck.forEach((deckCard) => {
      const { card } = deckCard
      if (card === front) return
      const targetTransform = previewDirection === 'forward' ? deckCard.forwardTransform : deckCard.backwardTransform
      const targetOpacity = previewDirection === 'forward' ? deckCard.forwardOpacity : deckCard.backwardOpacity
      card.style.transform = interpolateProfileStackTransform(deckCard.baseTransform, targetTransform, lift)
      card.style.opacity = String(deckCard.baseOpacity + (targetOpacity - deckCard.baseOpacity) * lift)
    })
  }

  const handleFamilyPointerMove = (
    event: ReactPointerEvent<HTMLDivElement>,
    familyId: string,
  ) => {
    const swipeState = familySwipeStateRef.current.get(familyId)
    if (!swipeState || swipeState.pointerId !== event.pointerId) return

    const coalescedEvents = event.nativeEvent.getCoalescedEvents?.() ?? []
    const latestEvent = coalescedEvents.at(-1) ?? event.nativeEvent
    const deltaX = latestEvent.clientX - swipeState.startX
    const deltaY = latestEvent.clientY - swipeState.startY
    const horizontalDistance = Math.abs(deltaX)
    const verticalDistance = Math.abs(deltaY)

    if (swipeState.horizontal === null) {
      if (Math.max(horizontalDistance, verticalDistance) < 8) return
      swipeState.horizontal = horizontalDistance > verticalDistance
      if (!swipeState.horizontal) {
        familySwipeStateRef.current.delete(familyId)
        return
      }
      if (typeof event.currentTarget.setPointerCapture === 'function') {
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          // Synthetic events and already-cancelled gestures may not own an active pointer.
        }
      }
    }

    if (!swipeState.horizontal) return

    event.preventDefault()
    swipeState.lastX = latestEvent.clientX
    swipeState.lastY = latestEvent.clientY
    swipeState.pendingDeltaX = deltaX
    if (swipeState.frame === undefined) {
      const front = event.currentTarget
      swipeState.frame = window.requestAnimationFrame(() => {
        const latestSwipeState = familySwipeStateRef.current.get(familyId)
        if (!latestSwipeState || latestSwipeState.pointerId !== event.pointerId) return
        latestSwipeState.frame = undefined
        const previewDirection: FamilyCardTurn['direction'] = latestSwipeState.pendingDeltaX < 0 ? 'forward' : 'backward'
        applyFamilySwipeVisual(front, latestSwipeState.pendingDeltaX, previewDirection, latestSwipeState)
      })
    }
  }

  const handleFamilyPointerEnd = (
    event: ReactPointerEvent<HTMLDivElement>,
    familyId: string,
    versions: ProfileAsset[],
  ) => {
    const swipeState = familySwipeStateRef.current.get(familyId)
    if (!swipeState || swipeState.pointerId !== event.pointerId) return
    if (swipeState.frame !== undefined) window.cancelAnimationFrame(swipeState.frame)
    familySwipeStateRef.current.delete(familyId)

    if (!swipeState.horizontal) return
    event.preventDefault()
    if (typeof event.currentTarget.releasePointerCapture === 'function' && event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // The browser may release capture before pointerup after a cancelled gesture.
      }
    }

    const deltaX = event.clientX - swipeState.startX
    const previewDirection: FamilyCardTurn['direction'] = deltaX < 0 ? 'forward' : 'backward'
    applyFamilySwipeVisual(event.currentTarget, deltaX, previewDirection, swipeState)
    const threshold = Math.max(42, Math.min(72, swipeState.width * 0.24))
    const direction = deltaX < 0 ? 1 : -1
    let didBrowse = false
    if (Math.abs(deltaX) >= threshold) {
      didBrowse = cycleFamilyVersion(familyId, versions, direction, true)
    }
    resetFamilySwipeVisual(familyId, !didBrowse, didBrowse)

    if (didBrowse) {
      swipeClickSuppressionsRef.current.set(familyId, Date.now() + PROFILE_STACK_GESTURE_DURATION + 100)
    }
  }

  const handleFamilyPointerCancel = (event: ReactPointerEvent<HTMLDivElement>, familyId: string) => {
    const swipeState = familySwipeStateRef.current.get(familyId)
    if (!swipeState || swipeState.pointerId !== event.pointerId) return
    if (swipeState.frame !== undefined) window.cancelAnimationFrame(swipeState.frame)
    familySwipeStateRef.current.delete(familyId)
    resetFamilySwipeVisual(familyId, Boolean(swipeState.horizontal))
  }

  useLayoutEffect(() => {
    const beforeRects = pendingFamilyLayoutFlipRef.current
    pendingFamilyLayoutFlipRef.current = null
    if (!beforeRects || prefersReducedMotion()) return

    const animations: Animation[] = []
    beforeRects.forEach((before, element) => {
      if (!element.isConnected || typeof element.animate !== 'function') return
      const after = element.getBoundingClientRect()
      const deltaX = before.left - after.left
      const deltaY = before.top - after.top
      if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return

      animations.push(element.animate(
        [
          { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
          { transform: 'translate3d(0, 0, 0)' },
        ],
        {
          duration: PROFILE_STACK_LAYOUT_DURATION,
          easing: 'cubic-bezier(0.16, 0.72, 0.24, 1)',
        },
      ))
    })
    familyLayoutAnimationsRef.current = animations
  }, [expandedFamilies])

  const toggleFamily = (familyId: string) => {
    const stack = familyStackRefs.current.get(familyId)
    const grid = stack?.parentElement
    if (grid) {
      const targets = [...grid.children].filter((child): child is HTMLElement => child instanceof HTMLElement)
      const followingSection = grid.closest('.profile-snippet-section')?.nextElementSibling
      if (followingSection instanceof HTMLElement) targets.push(followingSection)
      pendingFamilyLayoutFlipRef.current = new Map(
        targets.map((element) => [element, element.getBoundingClientRect()]),
      )
      familyLayoutAnimationsRef.current.forEach((animation) => animation.cancel())
      familyLayoutAnimationsRef.current = []
    }
    setExpandedFamilies((current) => {
      const next = new Set(current)
      if (next.has(familyId)) next.delete(familyId)
      else next.add(familyId)
      return next
    })
  }

  const openCreate = (seed?: {
    kind: string
    name?: string
    content?: string
    customLabelZh?: string
    customLabelEn?: string
    icon?: ProfilePresetIconName
    color?: ProfilePresetColor
    fromPreset?: boolean
    familyId?: string
    familyName?: string
    versionLabel?: string
    versionNumber?: number
    isPrimary?: boolean
  }) => {
    void loadSnippetEditorDialog()
    setEditingId(null)
    setSnippetSeed(seed ?? null)
    setOpenShareOnEdit(false)
    setDialogOpen(true)
  }

  const openEdit = (asset: ProfileAsset, options?: { share?: boolean }) => {
    void loadSnippetEditorDialog()
    setEditingId(asset.id)
    setSnippetSeed(null)
    setOpenShareOnEdit(Boolean(options?.share))
    setDialogOpen(true)
  }
  const openPresetEditor = (preset?: ProfilePreset) => {
    // Built-in templates follow language packs and are not user-editable.
    if (preset?.builtIn) return
    setEditingPresetId(preset?.id ?? null)
    setPresetEditorOpen(true)
  }
  const savePreset = (value: ProfilePresetEditorValue) => {
    if (editingPreset?.builtIn) return
    const now = new Date().toISOString()
    const isCreate = !editingPreset
    const preset: ProfilePreset = editingPreset
      ? { ...editingPreset, ...value, builtIn: false, updatedAt: now }
      : {
          ...value,
          id: newProfilePresetId(),
          builtIn: false,
          createdAt: now,
          updatedAt: now,
        }
    const next = editingPreset
      ? personalPresets.map((item) => item.id === preset.id ? preset : item)
      : [...personalPresets, preset]
    if (isCreate) setEnteredPresetId(preset.id)
    onUpdateSettings({ profilePresets: next }, tx('profile.presetSaved'))
  }

  useEffect(() => {
    if (!enteredPresetId) return
    const frame = window.requestAnimationFrame(() => {
      const node = document.querySelector<HTMLElement>(`[data-preset-id="${enteredPresetId}"]`)
      node?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [enteredPresetId])

  const finalizeDeletePreset = (presetId: string) => {
    // Guard against animationend + timeout both firing.
    if (exitingPresetIdRef.current !== presetId) return
    exitingPresetIdRef.current = null
    setExitingPresetId(null)
    if (enteredPresetId === presetId) setEnteredPresetId(null)

    const current = personalPresetsRef.current
    const preset = current.find((item) => item.id === presetId)
    if (!preset || preset.builtIn) return
    onUpdateSettings(
      { profilePresets: current.filter((item) => item.id !== presetId) },
      tx('profile.presetDeleted'),
    )
  }

  const requestDeletePreset = (preset: ProfilePreset) => {
    if (preset.builtIn || exitingPresetIdRef.current) return
    setPendingDeletePreset(null)
    // Prefer reduced-motion users skip the staged exit and remove immediately.
    const reduceMotion = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      onUpdateSettings(
        { profilePresets: personalPresetsRef.current.filter((item) => item.id !== preset.id) },
        tx('profile.presetDeleted'),
      )
      return
    }
    exitingPresetIdRef.current = preset.id
    setExitingPresetId(preset.id)
  }

  // Fallback if animationend is missed (tab background, interrupted layout).
  useEffect(() => {
    if (!exitingPresetId) return
    const timer = window.setTimeout(() => finalizeDeletePreset(exitingPresetId), 420)
    return () => window.clearTimeout(timer)
  }, [exitingPresetId])
  const openPhraseSettings = () => {
    void loadSnippetPhraseSettingsDialog()
    setPhraseSettingsOpen(true)
  }
  const closeContextMenu = () => setContextMenu(null)
  const openSnippetContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    asset: ProfileAsset,
    display: { name: string; kind: string; description: string },
  ) => {
    event.preventDefault()
    const firstAttachment = asset.attachments?.[0] ?? null
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      title: display.name,
      subtitle: display.kind,
      items: [
        {
          id: 'edit',
          label: tx('profile.editSnippet'),
          icon: <Pencil size={14} aria-hidden="true" />,
          shortcut: 'Enter',
          onSelect: () => openEdit(asset),
        },
        {
          id: 'share',
          label: tx('profile.shareUpload'),
          icon: <ExternalLink size={14} aria-hidden="true" />,
          onSelect: () => openEdit(asset, { share: true }),
        },
        {
          id: 'copy-name',
          label: tx('profile.copySnippetName'),
          icon: <Copy size={14} aria-hidden="true" />,
          disabled: !onCopy,
          onSelect: () => onCopy?.(display.name, tx('profile.snippetName')),
        },
        {
          id: 'copy-content',
          label: tx('profile.copySnippetContent'),
          icon: <Copy size={14} aria-hidden="true" />,
          disabled: !display.description.trim() || !onCopy,
          onSelect: () => onCopy?.(display.description, tx('profile.snippetContent')),
        },
        {
          id: 'download',
          label: tx('profile.downloadFirstAttachment'),
          icon: <Download size={14} aria-hidden="true" />,
          disabled: !firstAttachment?.fileId,
          onSelect: () => firstAttachment?.fileId && onDownloadFile(firstAttachment.fileId, firstAttachment.fileName),
        },
        {
          id: 'delete',
          label: tx('profile.deleteSnippet'),
          icon: <Trash2 size={14} aria-hidden="true" />,
          tone: 'danger',
          onSelect: () => onDeleteAsset(asset),
        },
      ],
    })
  }

  return (
    <section className="simple-screen">
      <div className="profile-hero">
        <header>
          <div className="profile-heading-row">
            <div>
              <span className="eyebrow">{tx('profile.eyebrow')}</span>
              <h2>{tx('profile.title')}</h2>
            </div>
            <InfoTooltip
              className="profile-mobile-info"
              content={tx('profile.subtitle')}
              label={tx('profile.subtitle')}
            />
          </div>
          <p className="profile-hero-subtitle muted">{tx('profile.subtitle')}</p>
        </header>

        <AiProfilePanel
          value={session.user.settings.aiProfile}
          onUpdate={onUpdateSettings}
        />
      </div>

      <div className="profile-toolbar">
        <label className="search-field">
          <Search size={15} aria-hidden="true" />
          <span className="sr-only">{tx('profile.searchAssets')}</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tx('profile.searchAssets')}
          />
        </label>
        <button type="button" className="primary-action" onClick={() => openCreate()}>
          <Plus size={14} aria-hidden="true" /> {tx('profile.addSnippet')}
        </button>
      </div>

      {deferProgressiveReveal ? (
        <div className="profile-content-deferred" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ) : (
        <>
      <section className="profile-snippet-section" aria-labelledby="profile-snippet-title">
        <div className="profile-section-head">
          <div>
            <span className="eyebrow">{tx('profile.libraryEyebrow')}</span>
            <div className="profile-section-title-row">
              <h3 id="profile-snippet-title">{tx('profile.libraryTitle')}</h3>
              <InfoTooltip
                className="profile-mobile-info"
                content={tx('profile.libraryGroupHint')}
                label={tx('profile.libraryGroupHint')}
              />
            </div>
            <p className="profile-section-sub muted">
              {tx('profile.libraryGroupHint')}
            </p>
          </div>
          <div className="profile-section-head-actions">
            <button
              type="button"
              className="icon-action"
              title={tx('profile.snippetPhraseSettingsTitle')}
              onClick={openPhraseSettings}
            >
              <Settings size={14} aria-hidden="true" />
            </button>
            <span className="profile-count-badge">{families.length}</span>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="empty-list">
            <FileText size={24} aria-hidden="true" style={{ opacity: 0.3 }} />
            <span>{tx('profile.noSnippets')}</span>
            <p className="muted">{tx('profile.noSnippetsHint')}</p>
            <button type="button" className="primary-action" onClick={() => openCreate()}>
              <Plus size={14} aria-hidden="true" /> {tx('profile.addSnippet')}
            </button>
          </div>
        ) : (
          <div className="snippet-grid snippet-stack-grid">
            {families.map((family, familyIndex) => {
              const open = expandedFamilies.has(family.familyId)
              const multi = family.versionCount > 1
              const turn = familyTurns.get(family.familyId)
              const activeVersion = family.versions.find((version) => (
                version.id === activeFamilyVersionIds.get(family.familyId)
              )) ?? family.primary
              const familyIsRemoving = family.versionCount === 1 && Boolean(removingAssetIds?.has(activeVersion.id))
              const activeVersionIndex = Math.max(0, family.versions.findIndex((version) => version.id === activeVersion.id))
              const expandedVersions = multi
                ? [
                    ...family.versions.slice(activeVersionIndex + 1),
                    ...family.versions.slice(0, activeVersionIndex),
                  ]
                : []
              const expandedVisibleCardCount = Math.min(family.versionCount, 4)
              const expandedStackWidth = (
                expandedVisibleCardCount * PROFILE_STACK_CARD_WIDTH
                + Math.max(0, expandedVisibleCardCount - 1) * PROFILE_STACK_GAP
              )
              const turnDirection = turn?.direction ?? 'forward'
              const primaryDisplay = {
                name: localizeStaticText(activeVersion.name, lang),
                kind: profileKindLabel(family.kind, lang, {
                  zh: activeVersion.customLabelZh,
                  en: activeVersion.customLabelEn,
                }, contentLanguages),
                description: localizeStaticText(activeVersion.description, lang),
              }
              const appearance = profilePresetPresentation(family.kind)

              return (
                <Fragment key={family.familyId}>
                <article
                  ref={(node) => {
                    if (node) familyStackRefs.current.set(family.familyId, node)
                    else familyStackRefs.current.delete(family.familyId)
                  }}
                  className={clsx(
                    'snippet-stack',
                    multi && 'has-stack',
                    family.versionCount > 4 && 'has-overflow-stack',
                    open && 'is-expanded',
                    familyIsRemoving && 'is-removing',
                    turn && 'is-turning',
                    turn && `is-turning-${turn.direction}`,
                    turn?.fromGesture && 'is-gesture-turn',
                  )}
                  style={{
                    animationDelay: `${Math.min(familyIndex, 10) * 35}ms`,
                    ['--snippet-stack-expanded-width' as string]: `${expandedStackWidth}px`,
                    ['--snippet-stack-turn-duration' as string]: `${turn?.durationMs ?? PROFILE_STACK_TURN_DURATION}ms`,
                  }}
                >
                  {/* Real, keyed cards stay mounted at every deck depth. Their animation
                      endpoint exactly matches the next resting depth, so React never has
                      to replace the final frame with a visually different placeholder. */}
                  {(multi ? family.versions : [activeVersion]).map((version, versionIndex) => {
                    const isActive = version.id === activeVersion.id
                    const depth = (versionIndex - activeVersionIndex + family.versionCount) % family.versionCount
                    const targetDepth = turn
                      ? profileStackTargetDepth(depth, family.versionCount, turnDirection)
                      : depth
                    const display = {
                      name: localizeStaticText(version.name, lang),
                      kind: profileKindLabel(family.kind, lang, {
                        zh: version.customLabelZh,
                        en: version.customLabelEn,
                      }, contentLanguages),
                      description: localizeStaticText(version.description, lang),
                    }
                    const versionUpdatedDate = version.updatedAt ? new Date(version.updatedAt) : null
                    const versionUpdatedAt = versionUpdatedDate && !Number.isNaN(versionUpdatedDate.getTime())
                      ? new Intl.DateTimeFormat(localeForLanguage(lang), { month: 'short', day: 'numeric' }).format(versionUpdatedDate)
                      : ''
                    return (
                      <div
                        key={version.id}
                        ref={(node) => {
                          if (node && isActive) {
                            familyFrontRefs.current.set(family.familyId, node)
                          } else if (!node && familyFrontRefs.current.get(family.familyId)?.dataset.assetId === version.id) {
                            familyFrontRefs.current.delete(family.familyId)
                          }
                        }}
                        className={clsx(
                          'snippet-card',
                          isActive && 'snippet-stack-front',
                          multi && 'snippet-stack-deck-card',
                          turn && depth === 0 && 'is-deck-outgoing',
                          turn && depth !== 0 && targetDepth === 0 && 'is-deck-incoming',
                          turn && depth !== 0 && targetDepth !== 0 && 'is-deck-shifting',
                        )}
                        data-asset-id={version.id}
                        data-stack-depth={depth}
                        style={multi ? profileStackDepthStyle(depth, targetDepth, family.versionCount) : undefined}
                        aria-hidden={!isActive || Boolean(turn)}
                        inert={!isActive || Boolean(turn)}
                        onContextMenu={isActive ? (event) => openSnippetContextMenu(event, version, display) : undefined}
                        onPointerDown={isActive ? (event) => {
                          if (multi && !open && !turn) handleFamilyPointerDown(event, family.familyId)
                        } : undefined}
                        onPointerMove={isActive ? (event) => {
                          if (multi && !open && !turn) handleFamilyPointerMove(event, family.familyId)
                        } : undefined}
                        onPointerUp={isActive ? (event) => {
                          if (multi && !open && !turn) handleFamilyPointerEnd(event, family.familyId, family.versions)
                        } : undefined}
                        onPointerCancel={isActive ? (event) => handleFamilyPointerCancel(event, family.familyId) : undefined}
                      >
                        <button
                          type="button"
                          className="snippet-card-main"
                          tabIndex={isActive ? undefined : -1}
                          onClick={isActive ? (event) => {
                            if (turn) {
                              event.preventDefault()
                              return
                            }
                            const suppressUntil = swipeClickSuppressionsRef.current.get(family.familyId) ?? 0
                            if (suppressUntil > Date.now()) {
                              event.preventDefault()
                              return
                            }
                            swipeClickSuppressionsRef.current.delete(family.familyId)
                            openEdit(version)
                          } : undefined}
                          aria-label={`${tx(open ? 'profile.editSnippet' : 'profile.openSnippet')}: ${display.name}`}
                          title={isActive && multi && !open ? tx('profile.scrollStackHint') : undefined}
                        >
                          <ProfilePresetIcon
                            icon={version.icon ?? appearance.icon}
                            color={version.color ?? appearance.color}
                            className="snippet-card-preset-icon"
                          />
                          <div className="snippet-card-info">
                            <div className="snippet-card-title-row">
                              <strong>{display.kind}</strong>
                              <span>
                                {format(
                                  tx(family.versionCount === 1 ? 'profile.groupItemCountOne' : 'profile.groupItemCount'),
                                  { count: family.versionCount },
                                )}
                              </span>
                            </div>
                            <p className="snippet-card-description">{display.name}</p>
                            <div className="snippet-card-detail-list">
                              {(version.attachments?.length ?? 0) > 0 ? (
                                <span><Paperclip size={11} aria-hidden="true" /> {version.attachments?.length}</span>
                              ) : version.uploadReserved ? (
                                <span><UploadCloud size={11} aria-hidden="true" /> {tx('profile.uploadReserved')}</span>
                              ) : null}
                              {versionUpdatedAt ? <span>{format(tx('profile.updatedAt'), { date: versionUpdatedAt })}</span> : null}
                            </div>
                          </div>
                        </button>
                        <div className="snippet-card-foot">
                          <div className="snippet-card-meta" />
                          <div className="snippet-card-actions">
                            <button type="button" tabIndex={isActive ? undefined : -1} className="icon-action" title={tx('profile.editSnippet')} onClick={() => openEdit(version)}>
                              <Pencil size={13} aria-hidden="true" />
                            </button>
                            <button type="button" tabIndex={isActive ? undefined : -1} className="icon-action" title={tx('profile.shareUpload')} onClick={() => openEdit(version, { share: true })}>
                              <ExternalLink size={13} aria-hidden="true" />
                            </button>
                            <button type="button" tabIndex={isActive ? undefined : -1} className="icon-action" title={tx('profile.deleteSnippet')} onClick={() => onDeleteAsset(version)}>
                              <Trash2 size={13} aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}

                  {multi ? (
                    <button
                      type="button"
                      className={clsx('snippet-stack-toggle', open && 'open')}
                      aria-label={`${tx(open ? 'profile.collapseGroup' : 'profile.expandGroup')}: ${primaryDisplay.kind}`}
                      aria-expanded={open}
                      title={tx(open ? 'profile.collapseGroup' : 'profile.expandGroup')}
                      onClick={() => toggleFamily(family.familyId)}
                    >
                      <ChevronDown size={16} aria-hidden="true" />
                    </button>
                  ) : null}
                </article>

                  {/* Expanded versions are siblings of the anchor stack. This keeps the
                      library's visual reading order continuous: the next version takes
                      the next free cell instead of forcing a full-width nested row. */}
                  {multi ? (
                  <div
                    className={clsx('snippet-stack-expand', 'snippet-stack-flow', open && 'open')}
                    aria-hidden={!open}
                    inert={!open}
                    style={{
                      ['--snippet-stack-close-visibility-delay' as string]: `${
                        PROFILE_STACK_VERSION_CLOSE_DURATION
                        + Math.min(expandedVersions.length, PROFILE_STACK_MAX_STAGGERED_VERSIONS) * PROFILE_STACK_VERSION_CLOSE_STAGGER
                        + 40
                      }ms`,
                    }}
                  >
                      <div className="snippet-stack-expand-inner">
                        <div className="snippet-stack-versions">
                          {expandedVersions.map((version, versionIndex) => {
                            const mobileGridIndex = versionIndex + 1
                            const mobileColumn = mobileGridIndex % 2
                            const mobileRow = Math.floor(mobileGridIndex / 2)
                            const display = {
                              name: localizeStaticText(version.name, lang),
                              kind: profileKindLabel(version.kind, lang, {
                                zh: version.customLabelZh,
                                en: version.customLabelEn,
                              }, contentLanguages),
                              description: localizeStaticText(version.description, lang),
                            }
                            const versionUpdatedDate = version.updatedAt ? new Date(version.updatedAt) : null
                            const versionUpdatedAt = versionUpdatedDate && !Number.isNaN(versionUpdatedDate.getTime())
                              ? new Intl.DateTimeFormat(localeForLanguage(lang), { month: 'short', day: 'numeric' }).format(versionUpdatedDate)
                              : ''
                            const versionAppearance = profilePresetPresentation(version.kind)
                            return (
                              <div
                                key={version.id}
                                className={clsx(
                                  'snippet-stack-version',
                                  'snippet-stack-flow-version',
                                  removingAssetIds?.has(version.id) && 'is-removing',
                                )}
                                style={{
                                  ['--snippet-version-index' as string]: String(Math.min(versionIndex + 1, PROFILE_STACK_MAX_STAGGERED_VERSIONS)),
                                  ['--snippet-version-close-index' as string]: String(Math.min(expandedVersions.length - versionIndex, PROFILE_STACK_MAX_STAGGERED_VERSIONS)),
                                  ['--snippet-version-origin-x' as string]: `${PROFILE_STACK_COLLAPSED_OFFSET - (versionIndex + 1) * (PROFILE_STACK_CARD_WIDTH + PROFILE_STACK_GAP)}px`,
                                  ['--snippet-version-mobile-origin-x' as string]: mobileColumn === 0 ? '0px' : 'calc(-100% - 12px)',
                                  ['--snippet-version-mobile-origin-y' as string]: `${PROFILE_STACK_COLLAPSED_OFFSET - mobileRow * (PROFILE_STACK_MOBILE_CARD_HEIGHT + PROFILE_STACK_MOBILE_GAP)}px`,
                                }}
                                onContextMenu={(event) => openSnippetContextMenu(event, version, display)}
                              >
                                <button
                                  type="button"
                                  className="snippet-card-main"
                                  aria-label={`${tx('profile.editSnippet')}: ${display.name}`}
                                  onClick={() => openEdit(version)}
                                >
                                  <ProfilePresetIcon
                                    icon={version.icon ?? versionAppearance.icon}
                                    color={version.color ?? versionAppearance.color}
                                    className="snippet-card-preset-icon"
                                  />
                                  <div className="snippet-card-info">
                                    <div className="snippet-card-title-row">
                                      <strong>{display.kind}</strong>
                                      <span>{format(tx('profile.groupItemCount'), { count: family.versionCount })}</span>
                                    </div>
                                    <p className="snippet-card-description">{display.name}</p>
                                    <div className="snippet-card-detail-list">
                                    {(version.attachments?.length ?? 0) > 0 ? (
                                      <span>
                                        <Paperclip size={11} aria-hidden="true" />
                                        {version.attachments.length}
                                      </span>
                                    ) : version.uploadReserved ? (
                                      <span>
                                        <UploadCloud size={11} aria-hidden="true" />
                                        {tx('profile.uploadReserved')}
                                      </span>
                                    ) : null}
                                    {versionUpdatedAt ? <span>{format(tx('profile.updatedAt'), { date: versionUpdatedAt })}</span> : null}
                                    </div>
                                  </div>
                                </button>
                                <div className="snippet-card-foot">
                                  <div className="snippet-card-meta" />
                                  <div className="snippet-card-actions snippet-version-actions">
                                    <button type="button" className="icon-action" title={tx('profile.editSnippet')} onClick={() => openEdit(version)}>
                                      <Pencil size={13} aria-hidden="true" />
                                    </button>
                                    <button type="button" className="icon-action" title={tx('profile.shareUpload')} onClick={() => openEdit(version, { share: true })}>
                                      <ExternalLink size={13} aria-hidden="true" />
                                    </button>
                                    {(version.attachments?.length ?? 0) > 0 ? (
                                      <button
                                        type="button"
                                        className="icon-action"
                                        title={tx('profile.downloadFirstAttachment')}
                                        onClick={() => {
                                          const attachment = version.attachments?.[0]
                                          if (attachment) onDownloadFile(attachment.fileId, attachment.fileName)
                                        }}
                                      >
                                        <Download size={13} aria-hidden="true" />
                                      </button>
                                    ) : null}
                                    <button type="button" className="icon-action" title={tx('profile.deleteSnippet')} onClick={() => onDeleteAsset(version)}>
                                      <Trash2 size={13} aria-hidden="true" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </Fragment>
              )
            })}
            <button type="button" className="snippet-card snippet-card-add" onClick={() => openCreate()}>
              <Plus size={20} aria-hidden="true" />
              <span>{tx('profile.addSnippet')}</span>
            </button>
          </div>
        )}
      </section>

      <section className="profile-preset-section" aria-labelledby="profile-preset-title">
        <div className="profile-section-head">
          <div>
            <span className="eyebrow">{tx('profile.presetsEyebrow')}</span>
            <h3 id="profile-preset-title">{tx('profile.presetsTitle')}</h3>
          </div>
          <span className="profile-count-badge">{personalPresets.length}</span>
        </div>
        <div className="profile-preset-grid">
          {personalPresets.map((preset) => {
            // Card title/description: appearance (UI) language.
            const display = profilePresetText(preset, lang, contentLanguages)
            // Insert-phrase dual labels: live from first/second content languages (all packs).
            const insertLabels = profilePresetInsertLabels(preset, contentLanguages)
            const isEntering = enteredPresetId === preset.id
            const isExiting = exitingPresetId === preset.id
            return (
              <article
                key={preset.id}
                data-preset-id={preset.id}
                className={`profile-preset-card preset-manageable${isEntering ? ' profile-preset-card-enter' : ''}${isExiting ? ' is-removing' : ''}`}
                onAnimationEnd={(event) => {
                  if (event.target !== event.currentTarget) return
                  if (event.animationName === 'profile-preset-card-enter') {
                    if (enteredPresetId === preset.id) setEnteredPresetId(null)
                    return
                  }
                  if (event.animationName === 'atlas-destroy' && exitingPresetId === preset.id) {
                    finalizeDeletePreset(preset.id)
                  }
                }}
              >
                <button
                  type="button"
                  className="profile-preset-card-main"
                  onClick={() => openCreate({
                    kind: preset.kind,
                    // Card name stays UI language; dual custom labels are insert languages.
                    name: display.name,
                    content: display.content,
                    customLabelEn: insertLabels.primary || undefined,
                    customLabelZh: insertLabels.secondary || undefined,
                    icon: preset.icon,
                    color: preset.color,
                    fromPreset: true,
                  })}
                >
                  <div className="profile-preset-card-top">
                    <ProfilePresetIcon icon={preset.icon} color={preset.color} />
                    {!preset.builtIn ? (
                      <span className="profile-preset-custom-badge">{tx('profile.customPresetBadge')}</span>
                    ) : null}
                  </div>
                  <strong>{display.name}</strong>
                  <em>{display.description}</em>
                  <span className="profile-preset-action"><Plus size={12} aria-hidden="true" /> {tx('profile.usePreset')}</span>
                </button>
                {!preset.builtIn ? (
                  <div className="profile-preset-card-actions">
                    <button type="button" className="icon-action" title={tx('profile.editPreset')} onClick={() => openPresetEditor(preset)}>
                      <Pencil size={13} aria-hidden="true" />
                    </button>
                    <button type="button" className="icon-action" title={tx('profile.deletePreset')} onClick={() => setPendingDeletePreset(preset)}>
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
              </article>
            )
          })}
          <button type="button" className="profile-preset-card profile-preset-add-card" onClick={() => openPresetEditor()}>
            <span className="profile-preset-icon"><Plus size={16} aria-hidden="true" /></span>
            <strong>{tx('profile.addPreset')}</strong>
            <em>{tx('profile.addPresetHint')}</em>
            <span className="profile-preset-action">{tx('profile.customType')}</span>
          </button>
        </div>
      </section>
        </>
      )}

      {dialogOpen ? (
        <Suspense fallback={null}>
          <SnippetEditorDialog
            open
            asset={editingAsset}
            initialKind={snippetSeed?.kind}
            initialName={snippetSeed?.name}
            initialContent={snippetSeed?.content}
            initialCustomLabelZh={snippetSeed?.customLabelZh}
            initialCustomLabelEn={snippetSeed?.customLabelEn}
            initialIcon={snippetSeed?.icon}
            initialColor={snippetSeed?.color}
            initialFamilyId={snippetSeed?.familyId}
            initialFamilyName={snippetSeed?.familyName}
            initialVersionLabel={snippetSeed?.versionLabel}
            initialVersionNumber={snippetSeed?.versionNumber}
            initialIsPrimary={snippetSeed?.isPrimary}
            fromPreset={Boolean(snippetSeed?.fromPreset)}
            initialShowShare={openShareOnEdit}
            contentLanguages={contentLanguages}
            globalPhrase={{
              leadZh: session.user.settings.snippetPhraseLeadZh ?? '',
              tailZh: session.user.settings.snippetPhraseTailZh ?? '',
              leadEn: session.user.settings.snippetPhraseLeadEn ?? '',
              tailEn: session.user.settings.snippetPhraseTailEn ?? '',
            }}
            onClose={() => {
              setDialogOpen(false)
              setSnippetSeed(null)
              setOpenShareOnEdit(false)
            }}
            onCreate={onCreateSnippet}
            onUpdate={onUpdateAsset}
            onUploadFiles={onUploadFiles}
            onRenameFile={onRenameFile}
            onDeleteFile={onDeleteFile}
            onDownloadFile={onDownloadFile}
            onCreateShare={onCreateShare}
            onRevokeShare={onRevokeShare}
          />
        </Suspense>
      ) : null}

      {presetEditorOpen ? (
        <ProfilePresetEditorDialog
          open
          preset={editingPreset}
          contentLanguages={contentLanguages}
          onClose={() => {
            setPresetEditorOpen(false)
            setEditingPresetId(null)
          }}
          onSave={savePreset}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingDeletePreset)}
        title={tx('profile.deletePreset')}
        message={pendingDeletePreset ? format(tx('profile.deletePresetConfirm'), { name: profilePresetText(pendingDeletePreset, lang, contentLanguages).name }) : ''}
        confirmLabel={tx('profile.deletePreset')}
        variant="danger"
        onCancel={() => setPendingDeletePreset(null)}
        onConfirm={() => pendingDeletePreset && requestDeletePreset(pendingDeletePreset)}
      />

      {phraseSettingsOpen ? (
        <Suspense fallback={null}>
          <SnippetPhraseSettingsDialog
            open
            contentLanguages={contentLanguages}
            settings={{
              leadZh: session.user.settings.snippetPhraseLeadZh ?? '',
              tailZh: session.user.settings.snippetPhraseTailZh ?? '',
              leadEn: session.user.settings.snippetPhraseLeadEn ?? '',
              tailEn: session.user.settings.snippetPhraseTailEn ?? '',
            }}
            onClose={() => setPhraseSettingsOpen(false)}
            onSave={(patch) => onUpdateSettings(patch)}
          />
        </Suspense>
      ) : null}
      <ExplorerContextMenu menu={contextMenu} onClose={closeContextMenu} />
    </section>
  )
}
