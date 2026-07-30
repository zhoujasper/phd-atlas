import { Check, ChevronDown, FileText, Layers, Paperclip, Plus, Trash2 } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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
} from '../../profileAssets'
import { getMotionDelay } from '../hooks/useAnimatedClose'
import { useContentLanguagePacks, useI18n } from '../hooks/useI18n'
import { InlinePresence } from './InlinePresence'
import {
  addFloatingViewportListeners,
  FLOATING_CONTROL_BASE_Z_INDEX,
  getAnchoredOverlayStyle,
} from './floatingOverlay'

const assetInsertFocusableSelector = 'button:not([disabled]), input:not([disabled])'

type AssetVersionMotionStyle = CSSProperties & {
  '--asset-version-index': number
}

function applyAssetInsertPosition(element: HTMLElement, style: CSSProperties) {
  // Position updates can run for several frames while an above-opening group
  // expands. Batch them on the resident portal node instead of rerendering the
  // complete picker for transient geometry.
  for (const [property, value] of Object.entries(style)) {
    const cssProperty = property.startsWith('--')
      ? property
      : property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
    if (value === undefined || value === null) {
      element.style.removeProperty(cssProperty)
      continue
    }
    const unit = typeof value === 'number' && property !== 'zIndex' ? 'px' : ''
    element.style.setProperty(cssProperty, `${value}${unit}`)
  }
  if (style.visibility === undefined) element.style.removeProperty('visibility')
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

  const families = useMemo(() => groupProfileAssetsIntoFamilies(assets), [assets])

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
    applyAssetInsertPosition(dropdown, nextStyle)
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

  /** Selecting an item in a type group replaces the other selected item from that type. */
  const selectVersion = (asset: ProfileAsset) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      const familyId = profileAssetFamilyId(asset)
      const already = current.has(asset.id)
      for (const item of assets) {
        if (profileAssetFamilyId(item) === familyId) next.delete(item.id)
      }
      if (!already) next.add(asset.id)
      return next
    })
  }

  const selectPrimaryOfFamily = (familyId: string) => {
    const family = families.find((item) => item.familyId === familyId)
    if (!family) return
    selectVersion(family.primary)
  }

  const toggleFamilyExpand = (familyId: string) => {
    setExpandedFamilies((current) => {
      const next = new Set(current)
      if (next.has(familyId)) next.delete(familyId)
      else next.add(familyId)
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
                {families.map((family, familyIndex) => {
                  const selectedInFamily = family.versions.find((version) => selectedIds.has(version.id))
                  const checked = Boolean(selectedInFamily)
                  const expanded = expandedFamilies.has(family.familyId) || family.versionCount === 1
                  const versionsId = `${menuId}-versions-${familyIndex}`
                  const summaryAsset = selectedInFamily ?? family.primary
                  const summaryAttachmentCount = summaryAsset.attachments?.length ?? 0
                  const kindLabel = profileKindLabel(family.kind, language, {
                    zh: family.primary.customLabelZh,
                    en: family.primary.customLabelEn,
                  }, pair)
                  return (
                    <div
                      key={family.familyId}
                      className={clsx('asset-insert-family', checked && 'checked', expanded && 'expanded')}
                    >
                      <div className="asset-insert-family-head">
                        <label className={clsx('asset-insert-row asset-insert-family-row', checked && 'checked')}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              if (checked && selectedInFamily) selectVersion(selectedInFamily)
                              else selectPrimaryOfFamily(family.familyId)
                            }}
                          />
                          <span className="asset-insert-check" aria-hidden="true"><Check size={11} /></span>
                          <span className="asset-insert-copy">
                            <span className="asset-insert-name">
                              {kindLabel}
                            </span>
                            <span className="asset-insert-meta">
                              <em className="asset-insert-version-name">
                                {localizeStaticText(summaryAsset.name, language)}
                              </em>
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
                          <div className="asset-insert-versions-inner">
                            {family.versions.map((version, versionIndex) => {
                              const versionChecked = selectedIds.has(version.id)
                              const attachmentCount = version.attachments?.length ?? 0
                              return (
                                <label
                                  key={version.id}
                                  className={clsx('asset-insert-version-row', versionChecked && 'checked')}
                                  style={{ '--asset-version-index': versionIndex } as AssetVersionMotionStyle}
                                >
                                  <input
                                    type="radio"
                                    name={`${menuId}-family-${familyIndex}`}
                                    checked={versionChecked}
                                    onChange={() => selectVersion(version)}
                                  />
                                  <span className="asset-insert-radio" aria-hidden="true" />
                                  <span className="asset-insert-copy">
                                    <span className="asset-insert-name">
                                      {localizeStaticText(version.name, language)}
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
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
              <div className="asset-insert-footer">
                <div className="asset-insert-lang" role="radiogroup" aria-label={tx('profile.selectLanguageToInsert')}>
                  {languageChoices.map((choice) => (
                    <button
                      key={choice.value}
                      type="button"
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
