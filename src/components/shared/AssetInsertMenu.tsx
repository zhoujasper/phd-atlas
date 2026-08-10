import { Check, ChevronDown, FileText, Layers, Paperclip, Plus, Trash2 } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import type { ProfileAsset } from '../../api/phdApi'
import {
  contentLanguageOptions,
  contentLanguagesFromSettings,
  preferredContentLanguage,
  type ContentLanguagePair,
} from '../../contentLanguages'
import { languageLabel, localizeStaticText } from '../../i18n'
import {
  groupProfileAssetsIntoFamilies,
  profileAssetFamilyId,
  profileKindLabel,
  type ProfileAssetFamily,
} from '../../profileAssets'
import { getMotionDelay } from '../hooks/useAnimatedClose'
import { useContentLanguagePacks, useI18n } from '../hooks/useI18n'
import { useProgressiveList } from './DiscoverWorkspace'
import { InlinePresence } from './InlinePresence'
import {
  addFloatingViewportListeners,
  applyFloatingOverlayStyle,
  FLOATING_CONTROL_BASE_Z_INDEX,
  getAnchoredOverlayStyle,
} from './floatingOverlay'

const assetInsertFocusableSelector = 'button:not([disabled]), input:not([disabled])'

type AssetVersionMotionStyle = CSSProperties & {
  '--asset-version-index': number
}

function AssetInsertLanguageText({
  language,
  contentLanguages,
  primaryText,
  secondaryText,
}: {
  language: InsertLanguage
  contentLanguages: ContentLanguagePair
  primaryText: string
  secondaryText: string
}) {
  const activeIndex = language === contentLanguages.secondary ? 1 : 0

  return (
    <span className="asset-insert-language-text" data-active-index={activeIndex}>
      <span
        className="asset-insert-language-text-layer"
        data-language-index="0"
        lang={contentLanguages.primary}
        aria-hidden={activeIndex !== 0}
      >
        {primaryText}
      </span>
      <span
        className="asset-insert-language-text-layer"
        data-language-index="1"
        lang={contentLanguages.secondary}
        aria-hidden={activeIndex !== 1}
      >
        {secondaryText}
      </span>
    </span>
  )
}

const DESKTOP_ASSET_FAMILY_BATCH_SIZE = 20
const MOBILE_ASSET_FAMILY_BATCH_SIZE = 10
const DESKTOP_ASSET_VERSION_BATCH_SIZE = 20
const MOBILE_ASSET_VERSION_BATCH_SIZE = 10

function useCompactAssetInsertViewport() {
  const [compact, setCompact] = useState(() => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 820px)').matches
  ))

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(max-width: 820px)')
    const sync = () => setCompact(query.matches)
    sync()
    query.addEventListener?.('change', sync)
    return () => query.removeEventListener?.('change', sync)
  }, [])

  return compact
}

function AssetInsertLoadMore({
  className,
  label,
  accessibleLabel,
  busy,
  onLoadMore,
}: {
  className?: string
  label: string
  accessibleLabel?: string
  busy?: boolean
  onLoadMore: () => void
}) {
  const markerRef = useRef<HTMLDivElement>(null)
  const appendFrameRef = useRef<number | null>(null)
  const loadMoreRef = useRef(onLoadMore)
  loadMoreRef.current = onLoadMore

  useEffect(() => {
    const marker = markerRef.current
    if (!marker || typeof IntersectionObserver !== 'function') return
    const scrollRoot = marker.closest('.asset-insert-family-list')
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting) || appendFrameRef.current !== null) return
        appendFrameRef.current = window.requestAnimationFrame(() => {
          appendFrameRef.current = null
          loadMoreRef.current()
        })
      },
      {
        root: scrollRoot,
        rootMargin: '0px 0px 120px',
        threshold: 0.01,
      },
    )
    observer.observe(marker)
    return () => {
      observer.disconnect()
      if (appendFrameRef.current !== null) {
        window.cancelAnimationFrame(appendFrameRef.current)
        appendFrameRef.current = null
      }
    }
  }, [])

  return (
    <div
      ref={markerRef}
      className={clsx('asset-insert-progressive-more', className, busy && 'is-loading')}
      aria-busy={busy || undefined}
    >
      <button type="button" onClick={onLoadMore} aria-label={accessibleLabel ?? label}>
        <Plus size={12} aria-hidden="true" />
        <span>{label}</span>
      </button>
    </div>
  )
}

function AssetInsertVersions({
  family,
  familyIndex,
  batchSize,
  selectedIds,
  language,
  contentLanguages,
  menuId,
  onSelectVersion,
}: {
  family: ProfileAssetFamily
  familyIndex: number
  batchSize: number
  selectedIds: Set<string>
  language: InsertLanguage
  contentLanguages: ContentLanguagePair
  menuId: string
  onSelectVersion: (asset: ProfileAsset) => void
}) {
  const { tx } = useI18n()
  const versionIdentityKey = family.versions.map((version) => version.id).join('\u001f')
  const { visibleItems: visibleVersions, hasMore, remainingCount, loadMore } = useProgressiveList(
    family.versions,
    `${family.familyId}\u001f${versionIdentityKey}`,
    batchSize,
  )

  return (
    <>
      <div className="asset-insert-versions-inner">
        {visibleVersions.map((version, versionIndex) => {
          const versionChecked = selectedIds.has(version.id)
          const attachmentCount = version.attachments?.length ?? 0
          return (
            <label
              key={version.id}
              className={clsx('asset-insert-version-row', versionChecked && 'checked')}
              style={{ '--asset-version-index': versionIndex } as AssetVersionMotionStyle}
            >
              <input
                type="checkbox"
                name={`${menuId}-family-${familyIndex}`}
                checked={versionChecked}
                onChange={() => onSelectVersion(version)}
              />
              <span className="asset-insert-version-check" aria-hidden="true"><Check size={10} /></span>
              <span className="asset-insert-copy">
                <span className="asset-insert-name">
                  <AssetInsertLanguageText
                    language={language}
                    contentLanguages={contentLanguages}
                    primaryText={localizeStaticText(version.name, contentLanguages.primary)}
                    secondaryText={localizeStaticText(version.name, contentLanguages.secondary)}
                  />
                </span>
                <span className="asset-insert-meta">
                  {attachmentCount > 0 ? (
                    <em className="asset-insert-attachment-count">
                      <Paperclip size={10} aria-hidden="true" />
                      {attachmentCount}
                    </em>
                  ) : null}
                </span>
              </span>
            </label>
          )
        })}
        {hasMore ? (
          <AssetInsertLoadMore
            label={tx('profile.libraryShowMore', 'Show {count} more materials')
              .replace('{count}', String(Math.min(batchSize, remainingCount)))}
            onLoadMore={loadMore}
          />
        ) : null}
      </div>
    </>
  )
}

/** Any content-language code from the user's dual-language preference. */
export type InsertLanguage = string

export function AssetInsertMenu({
  assets,
  initialSelection,
  contentLanguages,
  onInsert,
}: {
  assets: ProfileAsset[]
  /** The snippet selection currently reflected in the compose body, if any — reopening the picker defaults to it so the user can tweak (rather than start over) and end up replacing the existing insertion in place. */
  initialSelection?: { ids: string[]; language: InsertLanguage }
  /** Account dual-language pair from Settings. Defaults to en + zh. */
  contentLanguages?: ContentLanguagePair
  onInsert: (selected: ProfileAsset[], language: InsertLanguage) => void
}) {
  const { tx, lang, format } = useI18n()
  const pair = useMemo(
    () => contentLanguages ?? contentLanguagesFromSettings(null),
    [contentLanguages],
  )
  useContentLanguagePacks(pair)
  const languageChoices = useMemo(() => contentLanguageOptions(pair), [pair])
  const [open, setOpen] = useState(false)
  const [exiting, setExiting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [expandedFamilies, setExpandedFamilies] = useState<Set<string>>(() => new Set())
  const [language, setLanguage] = useState<InsertLanguage>(() => preferredContentLanguage(pair, lang))
  const hasInitialSelection = Boolean(initialSelection && initialSelection.ids.length > 0)
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({ visibility: 'hidden' })
  const menuId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const positionFrameRef = useRef<number | null>(null)
  const openFocusFrameRef = useRef<number | null>(null)
  const restoreFocusFrameRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  // Family whose versions were just revealed and still need scrolling into view.
  const pendingRevealFamilyRef = useRef<string | null>(null)
  const revealFrameRef = useRef<number | null>(null)

  const families = useMemo(() => groupProfileAssetsIntoFamilies(assets), [assets])
  const compactViewport = useCompactAssetInsertViewport()
  const familyBatchSize = compactViewport
    ? MOBILE_ASSET_FAMILY_BATCH_SIZE
    : DESKTOP_ASSET_FAMILY_BATCH_SIZE
  const versionBatchSize = compactViewport
    ? MOBILE_ASSET_VERSION_BATCH_SIZE
    : DESKTOP_ASSET_VERSION_BATCH_SIZE
  const familiesResetKey = useMemo(
    () => families.map((family) => family.familyId).join('\u001f'),
    [families],
  )
  const {
    visibleItems: visibleFamilies,
    hasMore: hasMoreFamilies,
    remainingCount: remainingFamilyCount,
    loadMore: loadMoreFamilies,
  } = useProgressiveList(families, familiesResetKey, familyBatchSize)
  const [familyLoadPending, startFamilyLoad] = useTransition()
  const loadMoreFamiliesWithTransition = useCallback(
    () => startFamilyLoad(loadMoreFamilies),
    [loadMoreFamilies, startFamilyLoad],
  )

  const getDropdownPosition = useCallback((): CSSProperties => {
    return getAnchoredOverlayStyle(containerRef.current, {
      minWidth: 360,
      maxWidth: 420,
      estimatedHeight: 420,
      // The popover entrance scales the painted surface. offsetHeight keeps
      // anchoring tied to its stable layout box instead of the transient frame.
      actualHeight: dropdownRef.current?.offsetHeight,
      baseZIndex: FLOATING_CONTROL_BASE_Z_INDEX,
    })
  }, [])

  const updateDropdownPosition = useCallback(() => {
    const nextStyle = getDropdownPosition()
    const dropdown = dropdownRef.current
    if (!dropdown) {
      setDropdownStyle(nextStyle)
      return
    }
    applyFloatingOverlayStyle(dropdown, nextStyle)
  }, [getDropdownPosition])

  const scheduleDropdownPosition = useCallback(() => {
    if (positionFrameRef.current !== null) return
    positionFrameRef.current = window.requestAnimationFrame(() => {
      positionFrameRef.current = null
      updateDropdownPosition()
    })
  }, [updateDropdownPosition])

  const close = useCallback((restoreFocus = true) => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    setExiting(true)
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      setOpen(false)
      setExiting(false)
      if (restoreFocus) {
        restoreFocusFrameRef.current = window.requestAnimationFrame(() => {
          restoreFocusFrameRef.current = null
          if (triggerRef.current?.isConnected) triggerRef.current.focus()
        })
      }
    }, getMotionDelay(150))
  }, [])

  const toggle = () => {
    if (open) {
      close()
      return
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    if (restoreFocusFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreFocusFrameRef.current)
      restoreFocusFrameRef.current = null
    }
    setDropdownStyle({ visibility: 'hidden' })
    const initialIds = initialSelection?.ids ?? []
    setSelectedIds(new Set(initialIds))
    // Auto-expand type groups that already contain the current selection.
    const expand = new Set<string>()
    for (const asset of assets) {
      if (initialIds.includes(asset.id) || (asset.familyId && initialIds.some((id) => {
        const other = assets.find((item) => item.id === id)
        return other && profileAssetFamilyId(other) === profileAssetFamilyId(asset)
      }))) {
        expand.add(profileAssetFamilyId(asset))
      }
    }
    for (const family of groupProfileAssetsIntoFamilies(assets)) {
      if (family.versionCount > 1 && expand.has(family.familyId)) expand.add(family.familyId)
    }
    setExpandedFamilies(expand)
    const initialLang = initialSelection?.language
    const allowed = new Set([pair.primary, pair.secondary])
    setLanguage(
      initialLang && allowed.has(initialLang)
        ? initialLang
        : preferredContentLanguage(pair, lang),
    )
    setExiting(false)
    setOpen(true)
  }

  useLayoutEffect(() => {
    if (!open) return
    // Mount hidden, measure the real surface, then anchor before first paint.
    setDropdownStyle(getDropdownPosition())
  }, [getDropdownPosition, open])

  useEffect(() => {
    if (!open) return undefined
    const removeViewportListeners = addFloatingViewportListeners(scheduleDropdownPosition)
    return () => {
      removeViewportListeners()
      if (positionFrameRef.current !== null) {
        window.cancelAnimationFrame(positionFrameRef.current)
        positionFrameRef.current = null
      }
    }
  }, [open, scheduleDropdownPosition])

  useEffect(() => {
    if (!open) return undefined
    const dropdown = dropdownRef.current
    if (!dropdown || typeof ResizeObserver === 'undefined') return undefined

    // Expanded version groups change the intrinsic height. Re-anchor the
    // fixed popover while the resident disclosure animates.
    const observer = new ResizeObserver(scheduleDropdownPosition)
    observer.observe(dropdown)
    return () => observer.disconnect()
  }, [open, scheduleDropdownPosition])

  // A group can expand entirely below the fold of a bounded scroll list, which
  // looks exactly like a disclosure that refused to open. Once the rows have
  // real height, scroll the minimum amount that brings them into view.
  useEffect(() => {
    const familyId = pendingRevealFamilyRef.current
    if (!open || !familyId) return undefined
    pendingRevealFamilyRef.current = null

    const reveal = () => {
      revealFrameRef.current = null
      const list = dropdownRef.current?.querySelector<HTMLElement>('.asset-insert-family-list')
      const group = dropdownRef.current?.querySelector<HTMLElement>(
        `[data-family-id="${CSS.escape(familyId)}"]`,
      )
      if (!list || !group) return
      const listRect = list.getBoundingClientRect()
      const groupRect = group.getBoundingClientRect()
      const overflowBelow = groupRect.bottom - listRect.bottom
      const overflowAbove = listRect.top - groupRect.top
      // Prefer keeping the group's header visible when it is taller than the list.
      const delta = overflowAbove > 0
        ? -overflowAbove
        : overflowBelow > 0
          ? Math.min(overflowBelow, Math.max(0, groupRect.top - listRect.top))
          : 0
      if (delta === 0) return
      list.scrollBy({
        top: delta,
        behavior: getMotionDelay(1) === 0 ? 'auto' : 'smooth',
      })
    }

    // Two frames: the first paints the closed row so the expansion can animate,
    // the second measures it after the grid row has taken its open size.
    revealFrameRef.current = window.requestAnimationFrame(() => {
      revealFrameRef.current = window.requestAnimationFrame(reveal)
    })
    return () => {
      if (revealFrameRef.current !== null) {
        window.cancelAnimationFrame(revealFrameRef.current)
        revealFrameRef.current = null
      }
    }
  }, [expandedFamilies, open])

  useEffect(() => () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    if (openFocusFrameRef.current !== null) {
      window.cancelAnimationFrame(openFocusFrameRef.current)
      openFocusFrameRef.current = null
    }
    if (restoreFocusFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreFocusFrameRef.current)
      restoreFocusFrameRef.current = null
    }
    if (revealFrameRef.current !== null) {
      window.cancelAnimationFrame(revealFrameRef.current)
      revealFrameRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!open) return undefined
    openFocusFrameRef.current = window.requestAnimationFrame(() => {
      openFocusFrameRef.current = null
      const preferred = dropdownRef.current?.querySelector<HTMLInputElement>(
        '.asset-insert-family-row input:checked',
      )
      const firstFamily = dropdownRef.current?.querySelector<HTMLInputElement>(
        '.asset-insert-family-row input',
      )
      ;(preferred ?? firstFamily)?.focus()
    })

    function handleClick(event: MouseEvent) {
      const target = event.target as Node
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        close(false)
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close()
        return
      }
      if (event.key !== 'Tab' || !dropdownRef.current?.contains(document.activeElement)) return

      const focusable = Array.from(
        dropdownRef.current.querySelectorAll<HTMLElement>(assetInsertFocusableSelector),
      ).filter((element) => !element.closest('[inert]'))
      if (focusable.length === 0) return

      event.preventDefault()
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement)
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
        : (currentIndex >= focusable.length - 1 ? 0 : currentIndex + 1)
      focusable[nextIndex]?.focus()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      if (openFocusFrameRef.current !== null) {
        window.cancelAnimationFrame(openFocusFrameRef.current)
        openFocusFrameRef.current = null
      }
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open, close])

  /** Versions are independently selectable: one, several, or none per type. */
  const selectVersion = (asset: ProfileAsset) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(asset.id)) next.delete(asset.id)
      else next.add(asset.id)
      return next
    })
  }

  const selectPrimaryOfFamily = (familyId: string) => {
    const family = families.find((item) => item.familyId === familyId)
    if (!family) return
    setSelectedIds((current) => {
      const next = new Set(current)
      next.add(family.primary.id)
      return next
    })
  }

  const clearFamily = (familyId: string) => {
    const family = families.find((item) => item.familyId === familyId)
    if (!family) return
    setSelectedIds((current) => {
      const next = new Set(current)
      for (const version of family.versions) next.delete(version.id)
      return next
    })
  }

  const toggleFamilyExpand = (familyId: string) => {
    setExpandedFamilies((current) => {
      const next = new Set(current)
      if (next.has(familyId)) {
        next.delete(familyId)
        return next
      }
      next.add(familyId)
      // The list is a bounded scroll area, so rows revealed below the fold read
      // as "nothing happened". Bring the group into view once it has grown.
      pendingRevealFamilyRef.current = familyId
      return next
    })
  }

  const allSelected = families.length > 0 && families.every((family) => (
    family.versions.some((version) => selectedIds.has(version.id))
  ))

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set())
      return
    }
    setSelectedIds(new Set(families.map((family) => family.primary.id)))
  }

  const handleInsert = () => {
    const selected = assets.filter((asset) => selectedIds.has(asset.id))
    if (selected.length === 0 && !hasInitialSelection) return
    onInsert(selected, language)
    close()
  }

  return (
    <div className="asset-insert-menu-wrap" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="quiet-action"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
      >
        <FileText size={12} aria-hidden="true" /> {tx('dossier.insertAsset')}
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          id={menuId}
          ref={dropdownRef}
          className={`asset-insert-menu asset-insert-menu-families ${exiting ? 'exit' : ''}`}
          style={dropdownStyle}
          data-floating-overlay="true"
          role="dialog"
          aria-label={tx('profile.selectSnippets')}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {assets.length === 0 ? (
            <p className="asset-insert-empty">{tx('profile.noSnippetsToInsert')}</p>
          ) : (
            <>
              <div className="asset-insert-head">
                <span className="asset-insert-title-group">
                  <span className="asset-insert-title">{tx('profile.selectSnippets')}</span>
                  <InlinePresence
                    present={selectedIds.size > 0}
                    className="asset-insert-selected-count-presence"
                    durationMs={180}
                  >
                    <output
                      className="asset-insert-selected-count"
                      aria-live="polite"
                      aria-label={format(tx('notifications.selectedCount'), { count: selectedIds.size })}
                    >
                      {selectedIds.size}
                    </output>
                  </InlinePresence>
                </span>
                <button
                  type="button"
                  className="asset-insert-select-all"
                  aria-pressed={allSelected}
                  onClick={toggleAll}
                >
                  <InlinePresence present={allSelected}>
                    <span>{tx('profile.clearSelection')}</span>
                  </InlinePresence>
                  <InlinePresence present={!allSelected}>
                    <span>{tx('profile.selectAllSnippets')}</span>
                  </InlinePresence>
                </button>
              </div>
              <p className="asset-insert-hint">
                {tx('profile.insertGroupHint')}
              </p>
              <div className="asset-insert-list asset-insert-family-list">
                {visibleFamilies.map((family, familyIndex) => {
                  const selectedInFamily = family.versions.filter((version) => selectedIds.has(version.id))
                  const checked = selectedInFamily.length > 0
                  const expanded = expandedFamilies.has(family.familyId) || family.versionCount === 1
                  const versionsId = `${menuId}-versions-${familyIndex}`
                  const summaryAsset = selectedInFamily[0] ?? family.primary
                  const summaryAttachmentCount = summaryAsset.attachments?.length ?? 0
                  const kindLabel = profileKindLabel(family.kind, language, {
                    zh: family.primary.customLabelZh,
                    en: family.primary.customLabelEn,
                  }, pair)
                  const primaryKindLabel = profileKindLabel(family.kind, pair.primary, {
                    zh: family.primary.customLabelZh,
                    en: family.primary.customLabelEn,
                  }, pair)
                  const secondaryKindLabel = profileKindLabel(family.kind, pair.secondary, {
                    zh: family.primary.customLabelZh,
                    en: family.primary.customLabelEn,
                  }, pair)
                  return (
                    <div
                      key={family.familyId}
                      data-family-id={family.familyId}
                      className={clsx('asset-insert-family', checked && 'checked', expanded && 'expanded')}
                    >
                      <div className="asset-insert-family-head">
                        <label className={clsx('asset-insert-row asset-insert-family-row', checked && 'checked')}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              // Unchecking a type clears every version picked
                              // inside it, so the row and its group never disagree.
                              if (checked) clearFamily(family.familyId)
                              else selectPrimaryOfFamily(family.familyId)
                            }}
                          />
                          <span className="asset-insert-check" aria-hidden="true"><Check size={11} /></span>
                          <span className="asset-insert-copy">
                            <span className="asset-insert-name">
                              <AssetInsertLanguageText
                                language={language}
                                contentLanguages={pair}
                                primaryText={primaryKindLabel}
                                secondaryText={secondaryKindLabel}
                              />
                            </span>
                            <span className="asset-insert-meta">
                              <em className="asset-insert-version-name">
                                <AssetInsertLanguageText
                                  language={language}
                                  contentLanguages={pair}
                                  primaryText={localizeStaticText(summaryAsset.name, pair.primary)}
                                  secondaryText={localizeStaticText(summaryAsset.name, pair.secondary)}
                                />
                              </em>
                              {selectedInFamily.length > 1 ? (
                                <em className="asset-insert-extra-count">
                                  {format(tx('profile.plusMoreVersions'), { count: selectedInFamily.length - 1 })}
                                </em>
                              ) : null}
                              {family.versionCount > 1 ? (
                                <em className="asset-insert-version-count">
                                  <Layers size={10} aria-hidden="true" />
                                  {family.versionCount}
                                </em>
                              ) : null}
                              {summaryAttachmentCount > 0 ? (
                                <em className="asset-insert-attachment-count">
                                  <Paperclip size={10} aria-hidden="true" />
                                  {summaryAttachmentCount}
                                </em>
                              ) : null}
                            </span>
                          </span>
                        </label>
                        {family.versionCount > 1 ? (
                          <button
                            type="button"
                            className="asset-insert-expand"
                            aria-expanded={expanded}
                            aria-controls={versionsId}
                            aria-label={`${tx(expanded ? 'profile.collapseGroup' : 'profile.expandGroup')}: ${kindLabel}`}
                            onClick={() => toggleFamilyExpand(family.familyId)}
                          >
                            <span className={clsx('asset-insert-expand-icon', expanded && 'open')} aria-hidden="true">
                              <ChevronDown size={14} />
                            </span>
                          </button>
                        ) : null}
                      </div>
                      {family.versionCount > 1 ? (
                        <div
                          id={versionsId}
                          className={clsx('asset-insert-versions', expanded && 'open')}
                          role="group"
                          aria-label={kindLabel}
                          aria-hidden={!expanded}
                          inert={expanded ? undefined : true}
                        >
                          <AssetInsertVersions
                            family={family}
                            familyIndex={familyIndex}
                            batchSize={versionBatchSize}
                            selectedIds={selectedIds}
                            language={language}
                            contentLanguages={pair}
                            menuId={menuId}
                            onSelectVersion={selectVersion}
                          />
                        </div>
                      ) : null}
                    </div>
                  )
                })}
                {hasMoreFamilies ? (
                  <AssetInsertLoadMore
                    label={tx('profile.libraryShowMore', 'Show {count} more materials')
                      .replace('{count}', String(Math.min(familyBatchSize, remainingFamilyCount)))}
                    busy={familyLoadPending}
                    onLoadMore={loadMoreFamiliesWithTransition}
                  />
                ) : null}
              </div>
              <div className="asset-insert-footer">
                <div
                  className="asset-insert-lang"
                  data-active-index={language === pair.secondary ? 1 : 0}
                  role="radiogroup"
                  aria-label={tx('profile.selectLanguageToInsert')}
                >
                  <span className="asset-insert-lang-indicator" aria-hidden="true" />
                  {languageChoices.map((choice) => (
                    <button
                      key={choice.value}
                      type="button"
                      role="radio"
                      aria-checked={language === choice.value}
                      className={language === choice.value ? 'active' : ''}
                      onClick={() => setLanguage(choice.value)}
                    >
                      {choice.label || languageLabel(choice.value)}
                    </button>
                  ))}
                </div>
                <button type="button" className="primary-action" disabled={selectedIds.size === 0 && !hasInitialSelection} onClick={handleInsert}>
                  {selectedIds.size === 0 && hasInitialSelection ? (
                    <>
                      <Trash2 size={12} aria-hidden="true" /> {tx('profile.removeInsertion')}
                    </>
                  ) : hasInitialSelection ? (
                    <>
                      <Plus size={12} aria-hidden="true" /> {tx('profile.updateInsertion')}
                    </>
                  ) : (
                    <>
                      <Plus size={12} aria-hidden="true" /> {tx('profile.insert')}
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
