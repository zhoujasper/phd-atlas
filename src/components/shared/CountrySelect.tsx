import { Check, ChevronDown, Globe2, Search, X } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  CONTINENT_ORDER,
  COUNTRIES,
  type ContinentId,
  type CountryEntry,
  countryDisplayName,
  countryFlagEmoji,
  resolveCountry,
} from '../../data/countries'
import { localeForLanguage } from '../../i18n'
import { getMotionDelay } from '../hooks/useAnimatedClose'
import { useI18n } from '../hooks/useI18n'
import { addFloatingViewportListeners, getAnchoredOverlayStyle } from './floatingOverlay'

type CountryRow = { entry: CountryEntry; label: string; flag: string }

type CountryGroup = {
  continent: ContinentId
  label: string
  countries: CountryRow[]
}

export function CountrySelect({
  value,
  onChange,
  placeholder,
  ariaLabel,
  disabled = false,
  size = 'default',
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  disabled?: boolean
  size?: 'default' | 'small'
}) {
  const { tx, lang } = useI18n()
  const searchInputId = useId()
  const [open, setOpen] = useState(false)
  const [exiting, setExiting] = useState(false)
  const [search, setSearch] = useState('')
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const [expandedContinents, setExpandedContinents] = useState<Set<ContinentId>>(() => new Set())
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({ visibility: 'hidden' })
  const containerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const positionFrameRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const ignoreOutsideUntilRef = useRef(0)
  const openVisible = open && !exiting

  const resolved = useMemo(() => resolveCountry(value), [value])
  const selectedLabel = useMemo(() => {
    if (!value.trim()) return ''
    return countryDisplayName(value, lang)
  }, [lang, value])
  const selectedFlag = resolved ? countryFlagEmoji(resolved.code) : ''

  const displayPlaceholder = placeholder
    ?? tx('dossier.countryPlaceholder', 'Select country / region')

  const continentLabels = useMemo(() => {
    const map = new Map<ContinentId, string>()
    for (const continent of CONTINENT_ORDER) {
      map.set(
        continent,
        tx(`dossier.continents.${continent}`, continent.replace(/_/g, ' ')),
      )
    }
    return map
  }, [tx])

  const labeledCountries = useMemo(() => {
    const locale = localeForLanguage(lang)
    return COUNTRIES.map((entry) => {
      const label = countryDisplayName(entry.name, lang)
      return {
        entry,
        label,
        flag: countryFlagEmoji(entry.code),
        searchText: [
          label,
          entry.name,
          entry.code,
          ...(entry.aliases ?? []),
          continentLabels.get(entry.continent) ?? '',
        ].join(' ').toLowerCase(),
      }
    }).sort((a, b) => {
      if (a.entry.continent !== b.entry.continent) {
        return CONTINENT_ORDER.indexOf(a.entry.continent) - CONTINENT_ORDER.indexOf(b.entry.continent)
      }
      return a.label.localeCompare(b.label, locale)
    })
  }, [continentLabels, lang])

  const groups = useMemo((): CountryGroup[] => {
    const query = search.trim().toLowerCase()
    const filtered = query
      ? labeledCountries.filter((item) => item.searchText.includes(query))
      : labeledCountries

    const countriesByContinent = new Map<ContinentId, CountryRow[]>()
    for (const item of filtered) {
      const countries = countriesByContinent.get(item.entry.continent) ?? []
      countries.push({
        entry: item.entry,
        label: item.label,
        flag: item.flag,
      })
      countriesByContinent.set(item.entry.continent, countries)
    }

    return CONTINENT_ORDER.flatMap((continent) => {
      const countries = countriesByContinent.get(continent)
      if (!countries?.length) return []
      return [{
        continent,
        label: continentLabels.get(continent) ?? continent,
        countries,
      }]
    })
  }, [continentLabels, labeledCountries, search])

  const rows = useMemo(
    () => groups.flatMap((group) => group.countries),
    [groups],
  )

  const rowIndexByCode = useMemo(
    () => new Map(rows.map((row, index) => [row.entry.code, index])),
    [rows],
  )

  const searchActive = search.trim().length > 0

  const navigableIndexes = useMemo(
    () => groups.flatMap((group) => {
      if (!searchActive && !expandedContinents.has(group.continent)) return []
      return group.countries.map((country) => rowIndexByCode.get(country.entry.code) ?? -1)
    }).filter((index) => index >= 0),
    [expandedContinents, groups, rowIndexByCode, searchActive],
  )

  const getDropdownPosition = useCallback((): CSSProperties => {
    return {
      ...getAnchoredOverlayStyle(containerRef.current, {
        minWidth: 300,
        maxWidth: 360,
        estimatedHeight: 400,
        actualHeight: dropdownRef.current?.getBoundingClientRect().height,
        gap: 6,
      }),
      zIndex: 520,
    }
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

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const close = useCallback(() => {
    if (!open || exiting) return
    clearCloseTimer()
    setExiting(true)
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      setOpen(false)
      setExiting(false)
      setHighlightIndex(-1)
      setSearch('')
      setExpandedContinents(new Set())
    }, getMotionDelay(150))
  }, [clearCloseTimer, exiting, open])

  const openMenu = useCallback(() => {
    if (disabled) return
    clearCloseTimer()
    ignoreOutsideUntilRef.current = performance.now() + 120
    setDropdownStyle(getDropdownPosition())
    setExiting(false)
    setOpen(true)
    setSearch('')
    setExpandedContinents(new Set())
    window.requestAnimationFrame(() => setDropdownStyle(getDropdownPosition()))
  }, [clearCloseTimer, disabled, getDropdownPosition])

  const toggle = () => {
    if (disabled) return
    if (openVisible) close()
    else openMenu()
  }

  useEffect(() => {
    if (!open || exiting) return undefined
    function handleClick(event: MouseEvent) {
      if (performance.now() < ignoreOutsideUntilRef.current) return
      const target = event.target as Node
      if (
        containerRef.current
        && !containerRef.current.contains(target)
        && dropdownRef.current
        && !dropdownRef.current.contains(target)
      ) {
        close()
      }
    }
    const attachTimer = window.setTimeout(() => {
      document.addEventListener('mousedown', handleClick, true)
    }, 0)
    return () => {
      window.clearTimeout(attachTimer)
      document.removeEventListener('mousedown', handleClick, true)
    }
  }, [close, exiting, open])

  useEffect(() => {
    if (disabled && open) close()
  }, [close, disabled, open])

  useEffect(() => {
    if (!open) return
    window.setTimeout(() => searchRef.current?.focus(), 0)
  }, [open])

  useEffect(() => {
    if (!open) return
    const selectedIndex = resolved ? rowIndexByCode.get(resolved.code) : undefined
    setHighlightIndex(
      selectedIndex !== undefined && navigableIndexes.includes(selectedIndex)
        ? selectedIndex
        : (navigableIndexes[0] ?? -1),
    )
  }, [navigableIndexes, open, resolved, rowIndexByCode, search])

  useEffect(() => {
    if (!open) return
    const removeViewportListeners = addFloatingViewportListeners(scheduleDropdownPosition)
    return () => {
      removeViewportListeners()
      if (positionFrameRef.current !== null) {
        window.cancelAnimationFrame(positionFrameRef.current)
        positionFrameRef.current = null
      }
    }
  }, [open, scheduleDropdownPosition])

  useEffect(() => () => clearCloseTimer(), [clearCloseTimer])

  useEffect(() => {
    if (!open) return
    function handleKey(event: KeyboardEvent) {
      const target = event.target
      if (
        target instanceof Element
        && target.closest('.country-select-group')
        && event.key !== 'Escape'
      ) {
        return
      }
      switch (event.key) {
        case 'Escape':
          event.preventDefault()
          close()
          break
        case 'ArrowDown': {
          event.preventDefault()
          if (navigableIndexes.length === 0) return
          setHighlightIndex((prev) => {
            const current = navigableIndexes.indexOf(prev)
            const next = current < 0 ? 0 : Math.min(navigableIndexes.length - 1, current + 1)
            return navigableIndexes[next]
          })
          break
        }
        case 'ArrowUp': {
          event.preventDefault()
          if (navigableIndexes.length === 0) return
          setHighlightIndex((prev) => {
            const current = navigableIndexes.indexOf(prev)
            const next = current < 0 ? navigableIndexes.length - 1 : Math.max(0, current - 1)
            return navigableIndexes[next]
          })
          break
        }
        case 'Enter': {
          event.preventDefault()
          const row = highlightIndex >= 0 ? rows[highlightIndex] : null
          if (row) {
            onChange(row.entry.name)
            close()
          }
          break
        }
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [close, highlightIndex, navigableIndexes, onChange, open, rows])

  useEffect(() => {
    if (!open || highlightIndex < 0 || !listRef.current) return
    const item = listRef.current.querySelector(`[data-row-index="${highlightIndex}"]`) as HTMLElement | null
    item?.scrollIntoView({ block: 'nearest' })
  }, [highlightIndex, open])

  const selectCountry = (entry: CountryEntry) => {
    onChange(entry.name)
    close()
  }

  const toggleContinent = (continent: ContinentId) => {
    if (searchActive) return
    setExpandedContinents((current) => {
      const next = new Set(current)
      if (next.has(continent)) next.delete(continent)
      else next.add(continent)
      return next
    })
  }

  const clearValue = (event: ReactMouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    onChange('')
  }

  const height = size === 'small' ? '32px' : '36px'
  const fontSize = size === 'small' ? '12.5px' : '13.5px'
  const isSelected = (entry: CountryEntry) =>
    Boolean(resolved && resolved.code === entry.code)
    || value.trim().toLowerCase() === entry.name.toLowerCase()

  return (
    <div className="country-select-root custom-select-root" ref={containerRef}>
      <button
        type="button"
        className={`custom-select-trigger country-select-trigger ${openVisible ? 'open' : ''}`}
        onMouseDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
          toggle()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
            event.preventDefault()
            if (!openVisible) openMenu()
          }
          if (event.key === 'Escape' && openVisible) {
            event.preventDefault()
            close()
          }
        }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={openVisible}
        aria-label={ariaLabel ?? displayPlaceholder}
        style={{ minHeight: height, fontSize }}
      >
        <span className={`country-select-value ${selectedLabel ? '' : 'placeholder'}`}>
          {selectedLabel ? (
            <>
              <span className="country-select-flag" aria-hidden="true">
                {selectedFlag || <Globe2 size={14} />}
              </span>
              <span className="country-select-label">{selectedLabel}</span>
            </>
          ) : (
            <>
              <span className="country-select-flag is-empty" aria-hidden="true">
                <Globe2 size={14} />
              </span>
              <span className="country-select-label">{displayPlaceholder}</span>
            </>
          )}
        </span>
        <span className="country-select-trailing">
          {selectedLabel && !disabled ? (
            <span
              role="button"
              tabIndex={-1}
              className="country-select-clear"
              onMouseDown={clearValue}
              aria-label={tx('dossier.countryClear', 'Clear country')}
              title={tx('dossier.countryClear', 'Clear country')}
            >
              <X size={12} aria-hidden="true" />
            </span>
          ) : null}
          <ChevronDown
            size={size === 'small' ? 13 : 15}
            aria-hidden="true"
            className={`custom-select-chevron ${openVisible ? 'open' : ''}`}
          />
        </span>
      </button>

      {open && createPortal(
        <div
          className={`custom-select-dropdown country-select-dropdown ${exiting ? 'custom-select-exit' : ''}`}
          role="listbox"
          aria-label={ariaLabel ?? displayPlaceholder}
          ref={dropdownRef}
          style={dropdownStyle}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="country-select-search">
            <Search size={14} aria-hidden="true" className="country-select-search-icon" />
            <label className="sr-only" htmlFor={searchInputId}>
              {tx('dossier.countrySearchPlaceholder', 'Search countries…')}
            </label>
            <input
              id={searchInputId}
              ref={searchRef}
              type="search"
              value={search}
              placeholder={tx('dossier.countrySearchPlaceholder', 'Search countries…')}
              onChange={(event) => setSearch(event.target.value)}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          <div className="country-select-list" ref={listRef} role="presentation">
            {groups.length === 0 ? (
              <div className="country-select-empty">
                <Globe2 size={20} aria-hidden="true" />
                <span>{tx('dossier.countryNoMatches', 'No matching countries')}</span>
              </div>
            ) : groups.map((group) => {
              const expanded = searchActive || expandedContinents.has(group.continent)
              const panelId = `${searchInputId}-${group.continent}`
              return (
                <section
                  key={group.continent}
                  className={`country-select-group-section${expanded ? ' expanded' : ''}`}
                >
                  <button
                    type="button"
                    className="country-select-group"
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    aria-disabled={searchActive || undefined}
                    tabIndex={searchActive ? -1 : 0}
                    onClick={() => toggleContinent(group.continent)}
                  >
                    <span>{group.label}</span>
                    <span className="country-select-group-meta">
                      <span className="country-select-group-count" aria-hidden="true">
                        {group.countries.length}
                      </span>
                      <ChevronDown
                        size={14}
                        aria-hidden="true"
                        className="country-select-group-chevron"
                      />
                    </span>
                  </button>
                  <div
                    id={panelId}
                    className={`collapsible-panel country-select-group-panel${expanded ? ' open' : ''}`}
                    aria-hidden={!expanded}
                  >
                    <div className="collapsible-panel-grid">
                      <div className="collapsible-panel-inner country-select-group-options">
                        {group.countries.map((row) => {
                          const index = rowIndexByCode.get(row.entry.code) ?? -1
                          const selected = isSelected(row.entry)
                          const highlighted = index === highlightIndex
                          return (
                            <button
                              key={row.entry.code}
                              type="button"
                              role="option"
                              tabIndex={-1}
                              aria-selected={selected}
                              data-row-index={index}
                              className={`custom-select-option country-select-option${selected ? ' selected' : ''}${highlighted ? ' highlighted' : ''}`}
                              onClick={() => selectCountry(row.entry)}
                              onMouseEnter={() => setHighlightIndex(index)}
                            >
                              <span className="country-select-option-main">
                                <span className="country-select-flag" aria-hidden="true">{row.flag || '🌐'}</span>
                                <span className="country-select-option-copy">
                                  <strong>{row.label}</strong>
                                  <small>{row.entry.code}</small>
                                </span>
                              </span>
                              {selected ? <Check size={15} strokeWidth={2.4} aria-hidden="true" className="custom-select-check" /> : null}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </section>
              )
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
