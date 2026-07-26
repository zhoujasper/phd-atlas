import {
  ChevronDown,
  Paperclip,
  Pencil,
  Trash2,
  UploadCloud,
} from 'lucide-react'
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import clsx from 'clsx'
import type { ProfileAsset } from '../../api/phdApi'
import {
  profileKindLabel,
  type ProfileAssetFamily,
} from '../../profileAssets'
import { profilePresetPresentation } from '../../profilePresets'
import { localeForLanguage } from '../../i18n'
import { useI18n } from '../hooks/useI18n'
import { ProfilePresetIcon } from '../shared/ProfilePresetIcon'
import {
  consumeStackedCardWheelDelta,
  createStackedCardWheelState,
  normalizeStackedCardWheelDelta,
  STACKED_CARD_WHEEL_IDLE_MS,
  type StackedCardWheelDirection,
} from '../shared/stackedCardWheel'

type TeamPortraitDeckTurn = {
  nextVersionId: string
  direction: 'forward' | 'backward'
  fromGesture: boolean
  durationMs: number
}

type PendingTeamPortraitDeckTurn = {
  direction: StackedCardWheelDirection
  fromGesture: boolean
}

type TeamPortraitPointerState = {
  pointerId: number
  startX: number
  startY: number
  lastX: number
  lastY: number
}

const TEAM_PORTRAIT_TURN_DURATION = 280
const TEAM_PORTRAIT_RAPID_TURN_DURATION = 180
const TEAM_PORTRAIT_GESTURE_TURN_DURATION = 240
const TEAM_PORTRAIT_SETTLE_BUFFER = 32
const TEAM_PORTRAIT_MIN_DECK_HEIGHT = 164
const TEAM_PORTRAIT_SWIPE_THRESHOLD = 44
const TEAM_PORTRAIT_CARD_WIDTH = 224
const TEAM_PORTRAIT_CARD_GAP = 28
const TEAM_PORTRAIT_MOBILE_CARD_HEIGHT = 224
const TEAM_PORTRAIT_MOBILE_CARD_GAP = 16
const TEAM_PORTRAIT_COLLAPSED_OFFSET = 8
const TEAM_PORTRAIT_VERSION_CLOSE_DURATION = 440
const TEAM_PORTRAIT_VERSION_CLOSE_STAGGER = 32
const TEAM_PORTRAIT_MAX_STAGGERED_VERSIONS = 12

const teamPortraitDeckTargetDepth = (
  depth: number,
  versionCount: number,
  direction: TeamPortraitDeckTurn['direction'],
) => direction === 'forward'
  ? (depth === 0 ? versionCount - 1 : depth - 1)
  : (depth === versionCount - 1 ? 0 : depth + 1)

const teamPortraitDeckDepthStyle = (
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

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function TeamPortraitFamilyDeckComponent({
  family,
  familyIndex,
  open,
  deletingAssetId,
  onToggle,
  onOpen,
  onDelete,
}: {
  family: ProfileAssetFamily
  familyIndex: number
  open: boolean
  deletingAssetId: string | null
  onToggle: () => void
  onOpen: (asset: ProfileAsset) => void
  onDelete: (asset: ProfileAsset) => void
}) {
  const { tx, lang, format } = useI18n()
  const [activeVersionId, setActiveVersionId] = useState(family.primary.id)
  const activeVersionIdRef = useRef(activeVersionId)
  activeVersionIdRef.current = activeVersionId
  const [turn, setTurn] = useState<TeamPortraitDeckTurn | null>(null)
  const rootRef = useRef<HTMLElement>(null)
  const versionsRef = useRef(family.versions)
  versionsRef.current = family.versions
  const openRef = useRef(open)
  openRef.current = open
  const turnLockedRef = useRef(false)
  const pendingTurnRef = useRef<PendingTeamPortraitDeckTurn | null>(null)
  const queuedTurnFrameRef = useRef<number | null>(null)
  const turnTimerRef = useRef<number | null>(null)
  const turnSettlerRef = useRef<(() => void) | null>(null)
  const turnTokenRef = useRef(0)
  const wheelStateRef = useRef(createStackedCardWheelState())
  const wheelReleaseTimerRef = useRef<number | null>(null)
  const pointerStateRef = useRef<TeamPortraitPointerState | null>(null)
  const suppressClickUntilRef = useRef(0)

  const cycleVersion = useCallback((
    direction: StackedCardWheelDirection,
    fromGesture = false,
    rapid = false,
  ) => {
    const versions = versionsRef.current
    if (versions.length < 2) return false

    if (turnLockedRef.current) {
      const pending = pendingTurnRef.current
      if (pending?.direction === -direction) {
        pendingTurnRef.current = null
      } else if (!pending) {
        pendingTurnRef.current = { direction, fromGesture }
      }
      return true
    }

    const activeIndex = Math.max(
      0,
      versions.findIndex((version) => version.id === activeVersionIdRef.current),
    )
    const nextIndex = (activeIndex + direction + versions.length) % versions.length
    const nextVersion = versions[nextIndex]
    if (!nextVersion) return false

    const durationMs = fromGesture
      ? TEAM_PORTRAIT_GESTURE_TURN_DURATION
      : rapid
        ? TEAM_PORTRAIT_RAPID_TURN_DURATION
        : TEAM_PORTRAIT_TURN_DURATION
    const token = ++turnTokenRef.current
    turnLockedRef.current = true
    setTurn({
      nextVersionId: nextVersion.id,
      direction: direction > 0 ? 'forward' : 'backward',
      fromGesture,
      durationMs,
    })

    let settled = false
    const settleTurn = () => {
      if (settled || token !== turnTokenRef.current) return
      settled = true
      if (turnTimerRef.current !== null) {
        window.clearTimeout(turnTimerRef.current)
        turnTimerRef.current = null
      }
      activeVersionIdRef.current = nextVersion.id
      setActiveVersionId(nextVersion.id)
      setTurn(null)
      turnSettlerRef.current = null
      turnLockedRef.current = false

      const pending = pendingTurnRef.current
      pendingTurnRef.current = null
      if (!pending) return
      if (queuedTurnFrameRef.current !== null) {
        window.cancelAnimationFrame(queuedTurnFrameRef.current)
      }
      queuedTurnFrameRef.current = window.requestAnimationFrame(() => {
        queuedTurnFrameRef.current = null
        cycleVersion(pending.direction, pending.fromGesture, true)
      })
    }
    turnSettlerRef.current = settleTurn

    if (prefersReducedMotion()) {
      settleTurn()
    } else {
      turnTimerRef.current = window.setTimeout(
        settleTurn,
        durationMs + TEAM_PORTRAIT_SETTLE_BUFFER,
      )
    }
    return true
  }, [])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return undefined

    const onWheel = (event: WheelEvent) => {
      const versions = versionsRef.current
      if (
        openRef.current
        || event.ctrlKey
        || event.metaKey
        || event.deltaY === 0
        || versions.length < 2
      ) return

      event.preventDefault()
      if (wheelReleaseTimerRef.current !== null) {
        window.clearTimeout(wheelReleaseTimerRef.current)
      }
      wheelReleaseTimerRef.current = window.setTimeout(() => {
        wheelReleaseTimerRef.current = null
        wheelStateRef.current = createStackedCardWheelState()
      }, STACKED_CARD_WHEEL_IDLE_MS)

      const direction = consumeStackedCardWheelDelta(
        wheelStateRef.current,
        normalizeStackedCardWheelDelta(
          event.deltaY,
          event.deltaMode,
          Math.max(root.clientHeight, TEAM_PORTRAIT_MIN_DECK_HEIGHT),
        ),
        event.timeStamp > 0 ? event.timeStamp : performance.now(),
      )
      if (direction) cycleVersion(direction)
    }

    root.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      root.removeEventListener('wheel', onWheel)
      if (wheelReleaseTimerRef.current !== null) {
        window.clearTimeout(wheelReleaseTimerRef.current)
        wheelReleaseTimerRef.current = null
      }
      wheelStateRef.current = createStackedCardWheelState()
    }
  }, [cycleVersion])

  useEffect(() => () => {
    turnTokenRef.current += 1
    if (turnTimerRef.current !== null) window.clearTimeout(turnTimerRef.current)
    if (queuedTurnFrameRef.current !== null) window.cancelAnimationFrame(queuedTurnFrameRef.current)
    if (wheelReleaseTimerRef.current !== null) window.clearTimeout(wheelReleaseTimerRef.current)
    turnTimerRef.current = null
    queuedTurnFrameRef.current = null
    wheelReleaseTimerRef.current = null
    turnSettlerRef.current = null
    pendingTurnRef.current = null
    pointerStateRef.current = null
    turnLockedRef.current = false
  }, [])

  const versionIdentity = family.versions.map((version) => version.id).join('\u0000')
  useEffect(() => {
    const versions = versionsRef.current
    const activeStillExists = versions.some((version) => version.id === activeVersionIdRef.current)
    const turnStillExists = !turn || versions.some((version) => version.id === turn.nextVersionId)
    if (activeStillExists && turnStillExists) return

    turnTokenRef.current += 1
    if (turnTimerRef.current !== null) window.clearTimeout(turnTimerRef.current)
    if (queuedTurnFrameRef.current !== null) window.cancelAnimationFrame(queuedTurnFrameRef.current)
    turnTimerRef.current = null
    queuedTurnFrameRef.current = null
    turnSettlerRef.current = null
    pendingTurnRef.current = null
    turnLockedRef.current = false
    const fallbackId = activeStillExists ? activeVersionIdRef.current : family.primary.id
    activeVersionIdRef.current = fallbackId
    setActiveVersionId(fallbackId)
    setTurn(null)
  }, [family.primary.id, turn, versionIdentity])

  useEffect(() => {
    if (!open) return
    wheelStateRef.current = createStackedCardWheelState()
    if (wheelReleaseTimerRef.current !== null) {
      window.clearTimeout(wheelReleaseTimerRef.current)
      wheelReleaseTimerRef.current = null
    }
  }, [open])

  const activeVersion = family.versions.find((version) => version.id === activeVersionId)
    ?? family.primary
  const activeVersionIndex = Math.max(
    0,
    family.versions.findIndex((version) => version.id === activeVersion.id),
  )
  const multi = family.versionCount > 1
  const expandedVersions = multi
    ? [
        ...family.versions.slice(activeVersionIndex + 1),
        ...family.versions.slice(0, activeVersionIndex),
      ]
    : []
  const expandedVisibleCardCount = Math.min(family.versionCount, 4)
  const expandedStackWidth = (
    expandedVisibleCardCount * TEAM_PORTRAIT_CARD_WIDTH
    + Math.max(0, expandedVisibleCardCount - 1) * TEAM_PORTRAIT_CARD_GAP
  )
  const familyIsRemoving = family.versionCount === 1
    && deletingAssetId === activeVersion.id
  const turnDirection = turn?.direction ?? 'forward'

  const handlePointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
    isActive: boolean,
  ) => {
    if (
      !isActive
      || open
      || turn
      || family.versionCount < 2
      || (event.pointerType !== 'touch' && event.pointerType !== 'pen')
      || (event.target instanceof Element && event.target.closest(
        '.snippet-stack-toggle, .snippet-card-actions',
      ))
    ) return
    pointerStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
    }
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = pointerStateRef.current
    if (!pointer || pointer.pointerId !== event.pointerId) return
    pointer.lastX = event.clientX
    pointer.lastY = event.clientY
  }

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = pointerStateRef.current
    if (!pointer || pointer.pointerId !== event.pointerId) return
    pointerStateRef.current = null
    const deltaX = pointer.lastX - pointer.startX
    const deltaY = pointer.lastY - pointer.startY
    if (
      Math.abs(deltaX) < TEAM_PORTRAIT_SWIPE_THRESHOLD
      || Math.abs(deltaX) <= Math.abs(deltaY) * 1.1
    ) return
    suppressClickUntilRef.current = Date.now() + 360
    cycleVersion(deltaX < 0 ? 1 : -1, true)
  }

  return (
    <Fragment>
      <article
        ref={rootRef}
        className={clsx(
          'snippet-stack',
          'team-portrait-profile-stack',
          multi && 'has-stack',
          family.versionCount > 4 && 'has-overflow-stack',
          open && 'is-expanded',
          open && 'is-open',
          familyIsRemoving && 'is-removing',
          turn && 'is-turning',
          turn && `is-turning-${turn.direction}`,
          turn?.fromGesture && 'is-gesture-turn',
        )}
        role="listitem"
        style={{
          ['--team-library-card-index' as string]: String(Math.min(familyIndex, 8)),
          ['--snippet-stack-expanded-width' as string]: `${expandedStackWidth}px`,
          ['--snippet-stack-turn-duration' as string]: `${turn?.durationMs ?? TEAM_PORTRAIT_TURN_DURATION}ms`,
        }}
        onAnimationEnd={(event) => {
          if (
            event.target instanceof HTMLElement
            && event.target.classList.contains('is-deck-outgoing')
          ) {
            turnSettlerRef.current?.()
          }
        }}
      >
        {family.versions.map((version, versionIndex) => {
          const isActive = version.id === activeVersion.id
          const depth = (
            versionIndex - activeVersionIndex + family.versionCount
          ) % family.versionCount
          const targetDepth = turn
            ? teamPortraitDeckTargetDepth(depth, family.versionCount, turnDirection)
            : depth
          const appearance = profilePresetPresentation(version.kind)
          const kindLabel = profileKindLabel(version.kind, lang, {
            zh: version.customLabelZh,
            en: version.customLabelEn,
          })
          const deleting = deletingAssetId === version.id
          const attachmentCount = version.attachments?.length ?? 0
          const updatedDate = version.updatedAt ? new Date(version.updatedAt) : null
          const updatedAt = updatedDate && !Number.isNaN(updatedDate.getTime())
            ? new Intl.DateTimeFormat(localeForLanguage(lang), {
                month: 'short',
                day: 'numeric',
              }).format(updatedDate)
            : ''

          return (
            <div
              key={version.id}
              className={clsx(
                'snippet-card',
                'snippet-stack-card-layout',
                'team-portrait-profile-deck-card',
                isActive && 'snippet-stack-front',
                isActive && 'is-deck-front',
                multi && 'snippet-stack-deck-card',
                multi && depth > 3 && (!turn || targetDepth > 3) && 'is-deck-dormant',
                turn && (depth <= 3 || targetDepth <= 3) && 'is-deck-active-turn',
                turn && depth === 0 && 'is-deck-outgoing',
                turn && depth !== 0 && targetDepth === 0 && 'is-deck-incoming',
                turn && depth !== 0 && targetDepth !== 0 && 'is-deck-shifting',
              )}
              data-asset-id={version.id}
              data-stack-depth={depth}
              style={multi
                ? teamPortraitDeckDepthStyle(depth, targetDepth, family.versionCount)
                : undefined}
              aria-hidden={!isActive || Boolean(turn)}
              inert={!isActive || Boolean(turn)}
              onPointerDown={(event) => handlePointerDown(event, isActive)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerEnd}
              onPointerCancel={() => {
                pointerStateRef.current = null
              }}
            >
              <button
                type="button"
                className="snippet-card-main team-portrait-profile-card-main"
                tabIndex={isActive ? undefined : -1}
                disabled={deleting}
                aria-label={`${tx('profile.openSnippet')}: ${version.name}`}
                title={isActive && multi && !open
                  ? tx('profile.scrollStackHint')
                  : undefined}
                onClick={isActive ? (event) => {
                  if (turn || suppressClickUntilRef.current > Date.now()) {
                    event.preventDefault()
                    return
                  }
                  onOpen(version)
                } : undefined}
              >
                <ProfilePresetIcon
                  icon={version.icon ?? appearance.icon}
                  color={version.color ?? appearance.color}
                  className="snippet-card-preset-icon"
                />
                <div className="snippet-card-info">
                  <div className="snippet-card-title-row">
                    <strong>{kindLabel}</strong>
                    <span className="snippet-family-count" aria-hidden={open || undefined}>
                      {format(
                        tx(family.versionCount === 1
                          ? 'profile.groupItemCountOne'
                          : 'profile.groupItemCount'),
                        { count: family.versionCount },
                      )}
                    </span>
                  </div>
                  <p className="snippet-card-description">{version.name}</p>
                  <div className="snippet-card-detail-list">
                    {attachmentCount > 0 ? (
                      <span>
                        <Paperclip size={11} aria-hidden="true" />
                        {format(
                          tx(attachmentCount === 1
                            ? 'profile.attachmentCount'
                            : 'profile.attachmentCountPlural'),
                          { count: attachmentCount },
                        )}
                      </span>
                    ) : version.uploadReserved ? (
                      <span>
                        <UploadCloud size={11} aria-hidden="true" />
                        {tx('profile.uploadReserved')}
                      </span>
                    ) : null}
                    {updatedAt ? (
                      <span>{format(tx('profile.updatedAt'), { date: updatedAt })}</span>
                    ) : null}
                  </div>
                </div>
              </button>
              <div className="snippet-card-foot">
                <div className="snippet-card-meta" />
                <div className="snippet-card-actions">
                  <button
                    type="button"
                    tabIndex={isActive ? undefined : -1}
                    className="icon-action"
                    title={tx('profile.editSnippet')}
                    disabled={deleting}
                    onClick={() => onOpen(version)}
                  >
                    <Pencil size={13} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    tabIndex={isActive ? undefined : -1}
                    className="icon-action"
                    title={tx('profile.deleteSnippet')}
                    disabled={deleting}
                    onClick={() => onDelete(version)}
                  >
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
            aria-label={`${format(tx('profile.groupItemCount'), {
              count: family.versionCount,
            })}: ${tx(open ? 'profile.collapseGroup' : 'profile.expandGroup')}`}
            aria-expanded={open}
            title={tx(open ? 'profile.collapseGroup' : 'profile.expandGroup')}
            disabled={Boolean(turn)}
            onClick={onToggle}
          >
            <ChevronDown size={16} aria-hidden="true" />
          </button>
        ) : null}
      </article>

      {multi ? (
        <div
          className={clsx(
            'snippet-stack-expand',
            'snippet-stack-flow',
            'team-portrait-profile-expand-flow',
            open && 'open',
          )}
          aria-hidden={!open}
          inert={!open}
          style={{
            ['--snippet-stack-close-visibility-delay' as string]: `${
              TEAM_PORTRAIT_VERSION_CLOSE_DURATION
              + Math.min(
                expandedVersions.length,
                TEAM_PORTRAIT_MAX_STAGGERED_VERSIONS,
              ) * TEAM_PORTRAIT_VERSION_CLOSE_STAGGER
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
                const appearance = profilePresetPresentation(version.kind)
                const kindLabel = profileKindLabel(version.kind, lang, {
                  zh: version.customLabelZh,
                  en: version.customLabelEn,
                })
                const deleting = deletingAssetId === version.id
                const attachmentCount = version.attachments?.length ?? 0
                const updatedDate = version.updatedAt ? new Date(version.updatedAt) : null
                const updatedAt = updatedDate && !Number.isNaN(updatedDate.getTime())
                  ? new Intl.DateTimeFormat(localeForLanguage(lang), {
                      month: 'short',
                      day: 'numeric',
                    }).format(updatedDate)
                  : ''

                return (
                  <div
                    key={version.id}
                    className={clsx(
                      'snippet-stack-version',
                      'snippet-stack-flow-version',
                      'snippet-stack-card-layout',
                      'team-portrait-profile-version',
                      deleting && 'is-removing',
                    )}
                    role="listitem"
                    style={{
                      ['--snippet-version-index' as string]: String(Math.min(
                        versionIndex + 1,
                        TEAM_PORTRAIT_MAX_STAGGERED_VERSIONS,
                      )),
                      ['--snippet-version-close-index' as string]: String(Math.min(
                        expandedVersions.length - versionIndex,
                        TEAM_PORTRAIT_MAX_STAGGERED_VERSIONS,
                      )),
                      ['--snippet-version-origin-x' as string]: `${
                        TEAM_PORTRAIT_COLLAPSED_OFFSET
                        - (versionIndex + 1) * (
                          TEAM_PORTRAIT_CARD_WIDTH + TEAM_PORTRAIT_CARD_GAP
                        )
                      }px`,
                      ['--snippet-version-mobile-origin-x' as string]: mobileColumn === 0
                        ? '0px'
                        : 'calc(-100% - 12px)',
                      ['--snippet-version-mobile-origin-y' as string]: `${
                        TEAM_PORTRAIT_COLLAPSED_OFFSET
                        - mobileRow * (
                          TEAM_PORTRAIT_MOBILE_CARD_HEIGHT
                          + TEAM_PORTRAIT_MOBILE_CARD_GAP
                        )
                      }px`,
                    }}
                  >
                    <button
                      type="button"
                      className="snippet-card-main team-portrait-profile-card-main"
                      disabled={deleting}
                      aria-label={`${tx('profile.openSnippet')}: ${version.name}`}
                      onClick={() => onOpen(version)}
                    >
                      <ProfilePresetIcon
                        icon={version.icon ?? appearance.icon}
                        color={version.color ?? appearance.color}
                        className="snippet-card-preset-icon"
                      />
                      <div className="snippet-card-info">
                        <div className="snippet-card-title-row">
                          <strong>{kindLabel}</strong>
                        </div>
                        <p className="snippet-card-description">{version.name}</p>
                        <div className="snippet-card-detail-list">
                          {attachmentCount > 0 ? (
                            <span>
                              <Paperclip size={11} aria-hidden="true" />
                              {format(
                                tx(attachmentCount === 1
                                  ? 'profile.attachmentCount'
                                  : 'profile.attachmentCountPlural'),
                                { count: attachmentCount },
                              )}
                            </span>
                          ) : version.uploadReserved ? (
                            <span>
                              <UploadCloud size={11} aria-hidden="true" />
                              {tx('profile.uploadReserved')}
                            </span>
                          ) : null}
                          {updatedAt ? (
                            <span>{format(tx('profile.updatedAt'), {
                              date: updatedAt,
                            })}</span>
                          ) : null}
                        </div>
                      </div>
                    </button>
                    <div className="snippet-card-foot">
                      <div className="snippet-card-meta" />
                      <div className="snippet-card-actions snippet-version-actions">
                        <button
                          type="button"
                          className="icon-action"
                          title={tx('profile.editSnippet')}
                          disabled={deleting}
                          onClick={() => onOpen(version)}
                        >
                          <Pencil size={13} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="icon-action"
                          title={tx('profile.deleteSnippet')}
                          disabled={deleting}
                          onClick={() => onDelete(version)}
                        >
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
}

export const TeamPortraitFamilyDeck = memo(TeamPortraitFamilyDeckComponent)
