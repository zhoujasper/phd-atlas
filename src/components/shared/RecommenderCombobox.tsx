import { Check, Mail, Phone, UserRound } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import type { MaterialRecommender } from '../../data/applications'
import {
  materialRecommenderEmail,
  materialRecommenderPhone,
  materialRecommenderWithContacts,
} from '../../profileRecommenders'
import { getMotionDelay } from '../hooks/useAnimatedClose'
import {
  addFloatingViewportListeners,
  applyFloatingOverlayStyle,
  FLOATING_CONTROL_BASE_Z_INDEX,
  getAnchoredOverlayStyle,
} from './floatingOverlay'

export type RecommenderComboboxProps = {
  value: MaterialRecommender
  options: readonly RecommenderComboboxOption[]
  onChange: (next: MaterialRecommender, reason: RecommenderComboboxChangeReason) => void
  namePlaceholder: string
  emailPlaceholder?: string
  phonePlaceholder?: string
  /** Backward-compatible fallback for isolated consumers. */
  contactPlaceholder?: string
  nameLabel: string
  emailLabel?: string
  phoneLabel?: string
  /** Backward-compatible fallback for isolated consumers. */
  contactLabel?: string
  /** A teacher cannot leave the local draft state without an identity. */
  nameRequired?: boolean
  listLabel: string
  emptyHint: string
}

export type RecommenderComboboxChangeReason = 'input' | 'selection'

const INITIAL_RECOMMENDER_OPTION_COUNT = 20
const RECOMMENDER_OPTION_BATCH_SIZE = 20

export type RecommenderComboboxOption = {
  /** Stable render/search key. Application-derived suggestions deliberately have no profileId. */
  key: string
  profileId?: string
  name: string
  email: string
  phone?: string
  title?: string
  institution?: string
  relationship?: string
  /** Directory-only note metadata; application notes always remain application-private. */
  notes?: string
  updatedAt?: string
}

function normalizeSearchPart(value: string | undefined) {
  return value?.trim().toLowerCase() ?? ''
}

function filterProfiles(options: readonly RecommenderComboboxOption[], query: string) {
  const normalizedQuery = normalizeSearchPart(query)
  // The directory is an autofill aid, not a second full people browser. Keep
  // the surface closed until the user provides a real search term.
  if (!normalizedQuery) return []

  return options.filter((option) =>
    [option.name, option.email, option.phone, option.title, option.institution, option.relationship].some((part) =>
      normalizeSearchPart(part).includes(normalizedQuery),
    ),
  )
}

/**
 * Free-form recommender fields with an optional link to the personal recommender library.
 * The application keeps explicit name/email/phone snapshots. A linked profile id remains
 * resident while the user edits; the Save boundary decides whether identity changes sync
 * everywhere or become an independent recommender.
 */
export function RecommenderCombobox({
  value,
  options,
  onChange,
  namePlaceholder,
  emailPlaceholder,
  phonePlaceholder,
  contactPlaceholder,
  nameLabel,
  emailLabel,
  phoneLabel,
  contactLabel,
  nameRequired = false,
  listLabel,
}: RecommenderComboboxProps) {
  const reactId = useId()
  const listId = `${reactId}-recommender-list`
  const rootRef = useRef<HTMLDivElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const positionFrameRef = useRef<number | null>(null)
  const composingRef = useRef(false)
  const autofillTimerRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const menuMountedRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [menuMounted, setMenuMounted] = useState(false)
  const [menuExiting, setMenuExiting] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const [visibleOptionCount, setVisibleOptionCount] = useState(INITIAL_RECOMMENDER_OPTION_COUNT)
  const [autofillFeedback, setAutofillFeedback] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({
    visibility: 'hidden',
  })
  const [menuPositionReady, setMenuPositionReady] = useState(false)

  const filteredOptions = useMemo(() => filterProfiles(options, query), [options, query])
  const renderedOptions = useMemo(
    () => filteredOptions.slice(0, visibleOptionCount),
    [filteredOptions, visibleOptionCount],
  )
  const resolvedEmailLabel = emailLabel ?? contactLabel ?? ''
  const resolvedPhoneLabel = phoneLabel ?? ''
  const resolvedEmailPlaceholder = emailPlaceholder ?? contactPlaceholder ?? ''
  const resolvedPhonePlaceholder = phonePlaceholder ?? ''
  const currentEmail = materialRecommenderEmail(value)
  const currentPhone = materialRecommenderPhone(value)

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current === null) return
    window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }, [])

  const closeMenu = useCallback(() => {
    setOpen(false)
    setQuery('')
    setActiveIndex(-1)
    if (!menuMountedRef.current) return
    clearCloseTimer()
    setMenuExiting(true)
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      menuMountedRef.current = false
      setMenuMounted(false)
      setMenuExiting(false)
      setMenuPositionReady(false)
      setMenuStyle({ visibility: 'hidden' })
    }, getMotionDelay(150))
  }, [clearCloseTimer])

  const getMenuPosition = useCallback(
    () =>
      getAnchoredOverlayStyle(nameInputRef.current, {
        minWidth: 280,
        maxWidth: 440,
        estimatedHeight: 260,
        actualHeight: listRef.current?.offsetHeight,
        gap: 6,
        viewportPadding: 8,
        baseZIndex: FLOATING_CONTROL_BASE_Z_INDEX,
      }),
    [],
  )

  const scheduleMenuPosition = useCallback(() => {
    if (positionFrameRef.current !== null) return
    positionFrameRef.current = window.requestAnimationFrame(() => {
      positionFrameRef.current = null
      const nextStyle = getMenuPosition()
      const menu = listRef.current
      if (!menu) {
        setMenuStyle(nextStyle)
        return
      }
      applyFloatingOverlayStyle(menu, nextStyle)
    })
  }, [getMenuPosition])

  const openMenu = useCallback(() => {
    const nextQuery = value.name
    const nextOptions = filterProfiles(options, nextQuery)
    if (nextOptions.length === 0) {
      closeMenu()
      return
    }
    const linkedIndex = value.profileId
      ? nextOptions.findIndex((option) => option.profileId === value.profileId)
      : -1

    setQuery(nextQuery)
    setVisibleOptionCount(Math.min(INITIAL_RECOMMENDER_OPTION_COUNT, nextOptions.length))
    setActiveIndex(
      linkedIndex >= 0 && linkedIndex < INITIAL_RECOMMENDER_OPTION_COUNT
        ? linkedIndex
        : nextOptions.length > 0 ? 0 : -1,
    )
    clearCloseTimer()
    if (!menuMountedRef.current || menuExiting) {
      setMenuStyle({ visibility: 'hidden' })
      setMenuPositionReady(false)
    }
    menuMountedRef.current = true
    setMenuMounted(true)
    setMenuExiting(false)
    setOpen(true)
  }, [clearCloseTimer, closeMenu, menuExiting, options, value.name, value.profileId])

  useEffect(() => {
    if (!open) return
    if (filteredOptions.length === 0) {
      closeMenu()
      return
    }
    setActiveIndex((current) => {
      if (current >= 0 && current < filteredOptions.length) return current
      return 0
    })
  }, [closeMenu, filteredOptions.length, open])

  useEffect(() => {
    setVisibleOptionCount((current) => (
      Math.min(
        filteredOptions.length,
        Math.max(current, Math.min(INITIAL_RECOMMENDER_OPTION_COUNT, filteredOptions.length)),
      )
    ))
  }, [filteredOptions.length])

  useEffect(() => {
    if (!open || activeIndex < 0 || activeIndex < visibleOptionCount) return
    setVisibleOptionCount(Math.min(
      filteredOptions.length,
      Math.ceil((activeIndex + 1) / RECOMMENDER_OPTION_BATCH_SIZE) * RECOMMENDER_OPTION_BATCH_SIZE,
    ))
  }, [activeIndex, filteredOptions.length, open, visibleOptionCount])

  useEffect(() => {
    if (!open || activeIndex < 0) return
    const activeOption = listRef.current?.querySelector<HTMLElement>(`[data-recommender-option-index="${activeIndex}"]`)
    activeOption?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex, open, visibleOptionCount])

  useEffect(() => {
    if (!menuMounted || !menuPositionReady) return
    const removeViewportListeners = addFloatingViewportListeners(scheduleMenuPosition)
    return () => {
      removeViewportListeners()
      if (positionFrameRef.current !== null) {
        window.cancelAnimationFrame(positionFrameRef.current)
        positionFrameRef.current = null
      }
    }
  }, [menuMounted, menuPositionReady, scheduleMenuPosition])

  // Resolve the mounted portal's real box before the first paint. A Resize
  // Observer then follows filtered rows and localized text without making the
  // whole combobox rerender for every transient geometry frame.
  useLayoutEffect(() => {
    if (!menuMounted || menuPositionReady || !listRef.current) return undefined
    setMenuStyle(getMenuPosition())
    setMenuPositionReady(true)
  }, [getMenuPosition, menuMounted, menuPositionReady])

  useEffect(() => {
    if (!menuMounted || !menuPositionReady) return undefined
    const menu = listRef.current
    if (!menu || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => scheduleMenuPosition())
    observer.observe(menu)
    return () => observer.disconnect()
  }, [menuMounted, menuPositionReady, scheduleMenuPosition])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && !rootRef.current?.contains(target) && !listRef.current?.contains(target))
        closeMenu()
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [closeMenu, open])

  useEffect(
    () => () => {
      clearCloseTimer()
      if (autofillTimerRef.current !== null) window.clearTimeout(autofillTimerRef.current)
    },
    [clearCloseTimer],
  )

  const triggerAutofillFeedback = useCallback(() => {
    if (autofillTimerRef.current !== null) window.clearTimeout(autofillTimerRef.current)
    setAutofillFeedback(true)
    autofillTimerRef.current = window.setTimeout(() => {
      autofillTimerRef.current = null
      setAutofillFeedback(false)
    }, 520)
  }, [])

  const selectProfile = useCallback(
    (profile: RecommenderComboboxOption) => {
      const next = materialRecommenderWithContacts(
        { ...value, name: profile.name },
        profile.email,
        profile.phone ?? '',
      )
      if (profile.profileId) {
        next.profileId = profile.profileId
      } else {
        delete next.profileId
      }
      onChange(next, 'selection')
      closeMenu()
      triggerAutofillFeedback()
    },
    [closeMenu, onChange, triggerAutofillFeedback, value],
  )

  const emitManualChange = useCallback(
    (field: 'name' | 'email' | 'phone', nextValue: string) => {
      const next = field === 'name'
        ? { ...value, name: nextValue }
        : materialRecommenderWithContacts(
            value,
            field === 'email' ? nextValue : currentEmail,
            field === 'phone' ? nextValue : currentPhone,
          )
      // Deliberately retain profileId. Save owns the sync/independent decision;
      // dropping it on the first keystroke loses the original relationship.
      onChange(next, 'input')
    },
    [currentEmail, currentPhone, onChange, value],
  )

  const handleNameChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextName = event.currentTarget.value
    const nextOptions = filterProfiles(options, nextName)
    emitManualChange('name', nextName)
    if (nextOptions.length === 0) {
      closeMenu()
      return
    }
    setQuery(nextName)
    setVisibleOptionCount(Math.min(INITIAL_RECOMMENDER_OPTION_COUNT, nextOptions.length))
    setActiveIndex(0)
    clearCloseTimer()
    if (!menuMountedRef.current || menuExiting) {
      setMenuStyle({ visibility: 'hidden' })
      setMenuPositionReady(false)
    }
    menuMountedRef.current = true
    setMenuMounted(true)
    setMenuExiting(false)
    setOpen(true)
    scheduleMenuPosition()
  }

  const handleEmailChange = (event: ChangeEvent<HTMLInputElement>) => {
    emitManualChange('email', event.currentTarget.value)
  }

  const handlePhoneChange = (event: ChangeEvent<HTMLInputElement>) => {
    emitManualChange('phone', event.currentTarget.value)
  }

  const handleNameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (composingRef.current || event.nativeEvent.isComposing) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) {
        openMenu()
        return
      }
      setActiveIndex((current) =>
        filteredOptions.length > 0 ? Math.min(filteredOptions.length - 1, current + 1) : -1,
      )
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        openMenu()
        return
      }
      setActiveIndex((current) =>
        filteredOptions.length > 0 ? Math.max(0, current - 1) : -1,
      )
      return
    }

    if (event.key === 'Enter' && open && activeIndex >= 0) {
      const profile = filteredOptions[activeIndex]
      if (profile) {
        event.preventDefault()
        selectProfile(profile)
      }
      return
    }

    if (event.key === 'Escape' && open) {
      event.preventDefault()
      closeMenu()
      return
    }

    if (event.key === 'Tab' && open) closeMenu()
  }

  const loadMoreOptions = useCallback(() => {
    setVisibleOptionCount((current) => (
      Math.min(filteredOptions.length, current + RECOMMENDER_OPTION_BATCH_SIZE)
    ))
  }, [filteredOptions.length])

  const activeOptionId =
    open && activeIndex >= 0 && filteredOptions[activeIndex] ? `${listId}-option-${activeIndex}` : undefined

  return (
    <div
      ref={rootRef}
      className={`recommender-combobox${open ? ' is-open' : ''}${value.profileId ? ' is-linked' : ''}${autofillFeedback ? ' is-autofilled' : ''}`}
      data-profile-id={value.profileId || undefined}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget
        if (
          nextTarget instanceof Node &&
          (rootRef.current?.contains(nextTarget) || listRef.current?.contains(nextTarget))
        )
          return
        closeMenu()
      }}
      >
      <div className="recommender-combobox-field recommender-combobox-name-field">
        <span className="recommender-combobox-field-label" aria-hidden="true">
          {nameLabel}
          {nameRequired ? <span className="field-required-mark">*</span> : null}
        </span>
        <div className="recommender-combobox-control">
          <UserRound className="recommender-combobox-field-icon" size={14} aria-hidden="true" />
          <input
            ref={nameInputRef}
            type="text"
            className="recommender-combobox-input recommender-combobox-name-input"
            value={value.name}
            placeholder={namePlaceholder}
            aria-label={nameLabel}
            aria-required={nameRequired || undefined}
            required={nameRequired}
            role="combobox"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={activeOptionId}
            autoComplete="off"
            onFocus={openMenu}
            onClick={() => {
              if (!open) openMenu()
            }}
            onChange={handleNameChange}
            onKeyDown={handleNameKeyDown}
            onCompositionStart={() => {
              composingRef.current = true
            }}
            onCompositionEnd={() => {
              composingRef.current = false
            }}
          />
        </div>

        {menuMounted &&
          typeof document !== 'undefined' &&
          createPortal(
            <div
              ref={listRef}
              id={listId}
              className={`recommender-combobox-menu${menuExiting ? ' is-exiting' : ' is-open'}`}
              role="listbox"
              aria-label={listLabel}
              aria-hidden={!open}
              inert={!open || undefined}
              style={menuStyle}
              data-floating-overlay="true"
              onScroll={(event) => {
                const menu = event.currentTarget
                if (menu.scrollHeight - menu.scrollTop - menu.clientHeight <= 80) loadMoreOptions()
              }}
            >
              {filteredOptions.length > 0 ? (
                renderedOptions.map((profile, index) => {
                  const selected = Boolean(profile.profileId && profile.profileId === value.profileId)
                  const metadata = [profile.title, profile.institution, profile.relationship]
                    .filter((part): part is string => Boolean(part?.trim()))
                    .join(' · ')
                  return (
                    <button
                      key={profile.key}
                      id={`${listId}-option-${index}`}
                      type="button"
                      className={`recommender-combobox-option${index === activeIndex ? ' is-active' : ''}${selected ? ' is-selected' : ''}`}
                      role="option"
                      aria-selected={selected}
                      tabIndex={-1}
                      data-recommender-option-index={index}
                      onPointerMove={() => setActiveIndex(index)}
                      onPointerDown={(event) => {
                        event.preventDefault()
                        selectProfile(profile)
                      }}
                    >
                      <span className="recommender-combobox-option-avatar" aria-hidden="true">
                        <UserRound size={14} />
                      </span>
                      <span className="recommender-combobox-option-copy">
                        <strong>{profile.name}</strong>
                        {metadata && <small>{metadata}</small>}
                        {(profile.email || profile.phone) && (
                          <span className="recommender-combobox-option-contacts">
                            {profile.email && (
                              <span>
                                <Mail size={11} aria-hidden="true" />
                                {profile.email}
                              </span>
                            )}
                            {profile.phone && (
                              <span>
                                <Phone size={11} aria-hidden="true" />
                                {profile.phone}
                              </span>
                            )}
                          </span>
                        )}
                      </span>
                      <Check className="recommender-combobox-option-check" size={14} aria-hidden="true" />
                    </button>
                  )
                })
              ) : null}
            </div>,
            document.body,
          )}
      </div>

      <div className="recommender-combobox-field recommender-combobox-email-field">
        <span className="recommender-combobox-field-label" aria-hidden="true">{resolvedEmailLabel}</span>
        <div className="recommender-combobox-control">
          <Mail className="recommender-combobox-field-icon" size={14} aria-hidden="true" />
          <input
            type="email"
            className="recommender-combobox-input recommender-combobox-email-input recommender-combobox-contact-input"
            value={currentEmail}
            placeholder={resolvedEmailPlaceholder}
            aria-label={resolvedEmailLabel}
            autoComplete="email"
            onFocus={closeMenu}
            onChange={handleEmailChange}
          />
        </div>
      </div>

      <div className="recommender-combobox-field recommender-combobox-phone-field">
        <span className="recommender-combobox-field-label" aria-hidden="true">{resolvedPhoneLabel}</span>
        <div className="recommender-combobox-control">
          <Phone className="recommender-combobox-field-icon" size={14} aria-hidden="true" />
          <input
            type="tel"
            className="recommender-combobox-input recommender-combobox-phone-input"
            value={currentPhone}
            placeholder={resolvedPhonePlaceholder}
            aria-label={resolvedPhoneLabel}
            autoComplete="tel"
            onFocus={closeMenu}
            onChange={handlePhoneChange}
          />
        </div>
      </div>
    </div>
  )
}
