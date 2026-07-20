import { Check, ChevronDown, FileText, Layers, Paperclip, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
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
import { addFloatingViewportListeners, getAnchoredOverlayStyle } from './floatingOverlay'

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
  const { tx, lang } = useI18n()
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
  const containerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const positionFrameRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)

  const families = useMemo(() => groupProfileAssetsIntoFamilies(assets), [assets])

  const getDropdownPosition = useCallback((): CSSProperties => {
    return getAnchoredOverlayStyle(containerRef.current, {
      minWidth: 300,
      maxWidth: 400,
      estimatedHeight: 360,
      actualHeight: dropdownRef.current?.getBoundingClientRect().height,
    })
  }, [])

  const updateDropdownPosition = useCallback(() => {
    setDropdownStyle(getDropdownPosition())
  }, [getDropdownPosition])

  const scheduleDropdownPosition = useCallback(() => {
    if (positionFrameRef.current !== null) return
    positionFrameRef.current = window.requestAnimationFrame(() => {
      positionFrameRef.current = null
      updateDropdownPosition()
    })
  }, [updateDropdownPosition])

  const close = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    setExiting(true)
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      setOpen(false)
      setExiting(false)
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
    setDropdownStyle(getDropdownPosition())
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

  useEffect(() => () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!open) return undefined
    function handleClick(event: MouseEvent) {
      const target = event.target as Node
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        close()
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
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
      <button type="button" className="quiet-action" onClick={toggle} aria-haspopup="true" aria-expanded={open}>
        <FileText size={12} aria-hidden="true" /> {tx('dossier.insertAsset')}
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          className={`asset-insert-menu asset-insert-menu-families ${exiting ? 'exit' : ''}`}
          style={dropdownStyle}
          role="dialog"
          aria-label={tx('profile.selectSnippets')}
        >
          {assets.length === 0 ? (
            <p className="asset-insert-empty">{tx('profile.noSnippetsToInsert')}</p>
          ) : (
            <>
              <div className="asset-insert-head">
                <span className="asset-insert-title">{tx('profile.selectSnippets')}</span>
                <button type="button" className="asset-insert-select-all" onClick={toggleAll}>
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
                {families.map((family) => {
                  const selectedInFamily = family.versions.find((version) => selectedIds.has(version.id))
                  const checked = Boolean(selectedInFamily)
                  const expanded = expandedFamilies.has(family.familyId) || family.versionCount === 1
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
                        <label className="asset-insert-row asset-insert-family-row">
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
                              <em>
                                <Layers size={10} aria-hidden="true" />
                                {family.versionCount}
                              </em>
                              <InlinePresence present={Boolean(selectedInFamily)} parentGap="6px">
                                <em className="asset-insert-version-chip">
                                  {selectedInFamily ? localizeStaticText(selectedInFamily.name, language) : ''}
                                </em>
                              </InlinePresence>
                            </span>
                          </span>
                        </label>
                        {family.versionCount > 1 ? (
                          <button
                            type="button"
                            className="asset-insert-expand"
                            aria-expanded={expanded}
                            onClick={() => toggleFamilyExpand(family.familyId)}
                          >
                            <ChevronDown size={14} className={clsx(expanded && 'open')} aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                      {family.versionCount > 1 ? (
                        <div className={clsx('asset-insert-versions', expanded && 'open')}>
                          <div className="asset-insert-versions-inner">
                            {family.versions.map((version) => {
                              const versionChecked = selectedIds.has(version.id)
                              const attachmentCount = version.attachments?.length ?? 0
                              return (
                                <label
                                  key={version.id}
                                  className={clsx('asset-insert-version-row', versionChecked && 'checked')}
                                >
                                  <input
                                    type="radio"
                                    name={`family-${family.familyId}`}
                                    checked={versionChecked}
                                    onChange={() => selectVersion(version)}
                                  />
                                  <span className="asset-insert-radio" aria-hidden="true" />
                                  <span className="asset-insert-copy">
                                    <span className="asset-insert-name">
                                      {localizeStaticText(version.name, language)}
                                    </span>
                                    <span className="asset-insert-meta">
                                      {kindLabel}
                                      {attachmentCount > 0 ? (
                                        <em><Paperclip size={10} aria-hidden="true" /> {attachmentCount}</em>
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
