import { ChevronDown, Check, Lock, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useState, useRef, useEffect, useCallback, useMemo, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { getMotionDelay } from '../hooks/useAnimatedClose'
import { useI18n } from '../hooks/useI18n'
import { addFloatingViewportListeners, getAnchoredOverlayStyle } from './floatingOverlay'

export type SelectOption<T extends string = string> = {
  value: T
  label: string
  description?: string
  disabled?: boolean
  locked?: boolean
  actionLabel?: string
  /** User-created options expose quiet rename/delete actions in creatable selects. */
  custom?: boolean
}

export type SelectCreateConfig<T extends string = string> = {
  label: string
  placeholder: string
  createAriaLabel: string
  renameAriaLabel: string
  deleteAriaLabel: string
  onCreate: (value: T) => void
  onRename?: (value: T, nextValue: T) => void
  onDelete?: (value: T) => void
}

export function Select<T extends string = string>({
  value,
  options,
  onChange,
  placeholder,
  ariaLabel,
  size = 'default',
  disabled = false,
  searchable = false,
  onLockedOptionClick,
  create,
}: {
  value: T
  options: readonly SelectOption<T>[]
  onChange: (value: T) => void
  placeholder?: string
  ariaLabel?: string
  size?: 'default' | 'small'
  disabled?: boolean
  searchable?: boolean
  onLockedOptionClick?: (option: SelectOption<T>) => void
  create?: SelectCreateConfig<T>
}) {
  const { tx } = useI18n()
  const [open, setOpen] = useState(false)
  const [exiting, setExiting] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const [search, setSearch] = useState('')
  const [editMode, setEditMode] = useState<'create' | 'rename' | null>(null)
  const [editingOption, setEditingOption] = useState<SelectOption<T> | null>(null)
  const [editValue, setEditValue] = useState('')
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({ visibility: 'hidden' })
  const containerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const editRef = useRef<HTMLInputElement>(null)
  const positionFrameRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const ignoreOutsideUntilRef = useRef(0)
  const openVisible = open && !exiting

  const selectedOption = options.find((o) => o.value === value)
  const displayPlaceholder = placeholder ?? tx('selectPlaceholder')
  const filteredOptions = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return options
    return options.filter((option) => [
      option.label,
      option.description,
      option.actionLabel,
    ].filter(Boolean).join(' ').toLowerCase().includes(query))
  }, [options, search])
  const isOptionNavigable = useCallback(
    (option: SelectOption<T>) => !option.disabled || Boolean(option.locked && onLockedOptionClick),
    [onLockedOptionClick],
  )
  const firstNavigableIndex = useMemo(
    () => filteredOptions.findIndex(isOptionNavigable),
    [filteredOptions, isOptionNavigable],
  )
  const nextNavigableIndex = useCallback((start: number, step: 1 | -1) => {
    if (filteredOptions.length === 0) return -1
    let index = start
    for (let checked = 0; checked < filteredOptions.length; checked += 1) {
      index = Math.min(filteredOptions.length - 1, Math.max(0, index))
      if (filteredOptions[index] && isOptionNavigable(filteredOptions[index])) return index
      index += step
    }
    return firstNavigableIndex
  }, [filteredOptions, firstNavigableIndex, isOptionNavigable])

  const getDropdownPosition = useCallback((): CSSProperties => {
    return getAnchoredOverlayStyle(containerRef.current, {
      minWidth: 160,
      maxWidth: 340,
      estimatedHeight: searchable ? 326 : 286,
      actualHeight: dropdownRef.current?.getBoundingClientRect().height,
    })
  }, [searchable])

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
      setEditMode(null)
      setEditingOption(null)
      setEditValue('')
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
    setEditMode(null)
    setEditingOption(null)
    setEditValue('')
    const idx = filteredOptions.findIndex((o) => o.value === value)
    setHighlightIndex(idx >= 0 && isOptionNavigable(filteredOptions[idx]) ? idx : firstNavigableIndex)
    window.requestAnimationFrame(() => setDropdownStyle(getDropdownPosition()))
  }, [clearCloseTimer, disabled, filteredOptions, firstNavigableIndex, getDropdownPosition, isOptionNavigable, value])

  const toggle = () => {
    if (disabled) return
    if (openVisible) close()
    else openMenu()
  }

  // Close on outside click
  useEffect(() => {
    if (!open || exiting) return undefined
    function handleClick(e: MouseEvent) {
      if (performance.now() < ignoreOutsideUntilRef.current) return
      const target = e.target as Node
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
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
  }, [open, exiting, close])

  useEffect(() => {
    if (disabled && open) close()
  }, [disabled, open, close])

  useEffect(() => {
    if (!open || !searchable) return
    window.setTimeout(() => searchRef.current?.focus(), 0)
  }, [open, searchable])

  useEffect(() => {
    if (!open || !editMode) return
    const frame = window.requestAnimationFrame(() => {
      editRef.current?.focus()
      editRef.current?.select()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [editMode, open])

  useEffect(() => {
    if (!open) return
    setHighlightIndex(firstNavigableIndex)
  }, [firstNavigableIndex, open, search])

  // Listen for resize/scroll to keep position updated
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

  // Keyboard navigation
  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (editMode) return
      switch (e.key) {
        case 'Escape':
          e.preventDefault()
          close()
          break
        case 'ArrowDown':
          e.preventDefault()
          setHighlightIndex((prev) => nextNavigableIndex(prev < 0 ? 0 : prev + 1, 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setHighlightIndex((prev) => nextNavigableIndex(prev < 0 ? filteredOptions.length - 1 : prev - 1, -1))
          break
        case 'Enter':
          e.preventDefault()
          if (highlightIndex >= 0 && highlightIndex < filteredOptions.length) {
            const option = filteredOptions[highlightIndex]
            if (option.disabled && option.locked && onLockedOptionClick) {
              onLockedOptionClick(option)
              close()
            } else if (!option.disabled) {
              onChange(option.value as T)
              close()
            }
          }
          break
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, close, editMode, filteredOptions, highlightIndex, onChange, nextNavigableIndex, onLockedOptionClick])

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || highlightIndex < 0 || !listRef.current) return
    const item = listRef.current.children[highlightIndex] as HTMLElement | undefined
    if (item && typeof item.scrollIntoView === 'function') {
      item.scrollIntoView({ block: 'nearest' })
    }
  }, [open, highlightIndex])

  const selectOption = (option: SelectOption<T>) => {
    if (option.disabled && option.locked && onLockedOptionClick) {
      onLockedOptionClick(option)
      close()
      return
    }
    if (option.disabled) return
    onChange(option.value as T)
    close()
  }

  const beginCreate = () => {
    setEditMode('create')
    setEditingOption(null)
    setEditValue(search.trim())
  }

  const beginRename = (option: SelectOption<T>) => {
    setEditMode('rename')
    setEditingOption(option)
    setEditValue(option.label)
  }

  const cancelEdit = () => {
    setEditMode(null)
    setEditingOption(null)
    setEditValue('')
    window.requestAnimationFrame(() => searchRef.current?.focus())
  }

  const commitEdit = () => {
    if (!create) return
    const nextValue = editValue.trim() as T
    if (!nextValue) return
    if (editMode === 'rename' && editingOption) create.onRename?.(editingOption.value, nextValue)
    else create.onCreate(nextValue)
    close()
  }

  const height = size === 'small' ? '32px' : '36px'
  const fontSize = size === 'small' ? '12px' : '14px'

  return (
    <div
      className="custom-select-root"
      ref={containerRef}
      style={{ position: 'relative', width: '100%' }}
    >
      <button
        type="button"
        className={`custom-select-trigger ${openVisible ? 'open' : ''}`}
        onMouseDown={(event) => {
          // Avoid parent <label> activation races; open/close on pointer down.
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
        <span className={selectedOption ? '' : 'placeholder'}>
          {selectedOption?.label ?? displayPlaceholder}
        </span>
        <ChevronDown
          size={size === 'small' ? 13 : 15}
          aria-hidden="true"
          className={`custom-select-chevron ${openVisible ? 'open' : ''}`}
        />
      </button>

      {open && createPortal(
        <div
          className={`custom-select-dropdown ${exiting ? 'custom-select-exit' : ''}`}
          role="listbox"
          aria-label={ariaLabel ?? displayPlaceholder}
          ref={dropdownRef}
          style={dropdownStyle}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {searchable ? (
            <label className="custom-select-search">
              <span className="sr-only">{tx('selectSearchPlaceholder', 'Search options')}</span>
              <input
                ref={searchRef}
                type="search"
                value={search}
                placeholder={tx('selectSearchPlaceholder', 'Search options')}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          ) : null}
          <div className="custom-select-list" ref={listRef}>
            {filteredOptions.length === 0 ? (
              <div className="custom-select-empty">{tx('selectNoOptions', 'No options')}</div>
            ) : filteredOptions.map((option, idx) => {
              const isSelected = option.value === value
              const isHighlighted = idx === highlightIndex
              const isDisabled = Boolean(option.disabled)
              const isLockedAction = Boolean(isDisabled && option.locked && onLockedOptionClick)

              const optionButton = (
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={isDisabled && !isLockedAction}
                  disabled={isDisabled && !isLockedAction}
                  title={isLockedAction ? option.actionLabel : undefined}
                  aria-label={isLockedAction
                    ? [option.label, option.description, option.actionLabel].filter(Boolean).join('. ')
                    : undefined}
                  className={`custom-select-option ${
                    isSelected ? 'selected' : ''
                  } ${
                    isHighlighted ? 'highlighted' : ''
                  } ${
                    isDisabled ? 'disabled' : ''
                  } ${
                    isLockedAction ? 'locked-action' : ''
                  }`}
                  onClick={() => selectOption(option)}
                  onMouseEnter={() => {
                    if (!isDisabled || isLockedAction) setHighlightIndex(idx)
                  }}
                  style={{ fontSize }}
                >
                  <span>
                    {option.label}
                    {option.description ? <small>{option.description}</small> : null}
                  </span>
                  {isLockedAction ? (
                    <Lock size={13} aria-hidden="true" className="custom-select-lock" />
                  ) : isSelected && (
                    <Check size={15} aria-hidden="true" className="custom-select-check" />
                  )}
                </button>
              )
              if (!option.custom || !create || (!create.onRename && !create.onDelete)) {
                return <div key={String(option.value)} className="custom-select-option-row">{optionButton}</div>
              }
              return (
                <div key={String(option.value)} className="custom-select-option-row custom">
                  {optionButton}
                  <span className="custom-select-option-actions">
                    {create.onRename ? (
                      <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); beginRename(option) }}
                        title={create.renameAriaLabel}
                        aria-label={`${create.renameAriaLabel}: ${option.label}`}
                      >
                        <Pencil size={12} aria-hidden="true" />
                      </button>
                    ) : null}
                    {create.onDelete ? (
                      <button
                        type="button"
                        className="danger"
                        onClick={(event) => { event.stopPropagation(); create.onDelete?.(option.value) }}
                        title={create.deleteAriaLabel}
                        aria-label={`${create.deleteAriaLabel}: ${option.label}`}
                      >
                        <Trash2 size={12} aria-hidden="true" />
                      </button>
                    ) : null}
                  </span>
                </div>
              )
            })}
            {create ? (
              <button type="button" className="custom-select-create-option" onClick={beginCreate}>
                <Plus size={14} aria-hidden="true" />
                <span>{create.label}</span>
              </button>
            ) : null}
          </div>
          {create && editMode ? (
            <div className="custom-select-create-panel">
              <input
                ref={editRef}
                value={editValue}
                placeholder={create.placeholder}
                aria-label={editMode === 'rename' ? create.renameAriaLabel : create.createAriaLabel}
                onChange={(event) => setEditValue(event.target.value)}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commitEdit()
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    cancelEdit()
                  }
                }}
              />
              <button type="button" onClick={cancelEdit} aria-label={tx('close')} title={tx('close')}>
                <X size={14} aria-hidden="true" />
              </button>
              <button type="button" className="confirm" disabled={!editValue.trim()} onClick={commitEdit} aria-label={tx('save')} title={tx('save')}>
                <Check size={14} aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </div>,
        document.body,
      )}
    </div>
  )
}
