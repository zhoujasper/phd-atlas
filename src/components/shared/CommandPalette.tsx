import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { useI18n } from '../hooks/useI18n'
import { useAnimatedClose } from '../hooks/useAnimatedClose'
import { ModalPortal } from './ModalPortal'

export type CommandPaletteAction = {
  id: string
  label: string
  description?: string
  icon?: ReactNode
  shortcut?: string
  keywords?: string[]
  disabled?: boolean
  onRun: () => void
}

export default function CommandPalette({
  open,
  actions,
  onClose,
}: {
  open: boolean
  actions: CommandPaletteAction[]
  onClose: () => void
}) {
  const { tx } = useI18n()
  const { exiting, requestClose } = useAnimatedClose(open, onClose)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const filteredActions = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return actions
    return actions.filter((action) => {
      const haystack = [
        action.label,
        action.description ?? '',
        action.shortcut ?? '',
        ...(action.keywords ?? []),
      ].join(' ').toLowerCase()
      return haystack.includes(needle)
    })
  }, [actions, query])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, filteredActions.length - 1)))
  }, [filteredActions.length])

  if (!open) return null

  const runAction = (action: CommandPaletteAction) => {
    if (action.disabled) return
    requestClose()
    action.onRun()
  }

  return (
    <ModalPortal>
      <div className={`dialog-layer command-palette-layer${exiting ? ' exiting' : ''}`} onClick={() => requestClose()}>
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label={tx('commandPalette.title')}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="command-palette-search">
          <Search size={16} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                requestClose()
                return
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveIndex((current) => Math.min(current + 1, Math.max(0, filteredActions.length - 1)))
                return
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveIndex((current) => Math.max(current - 1, 0))
                return
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                const action = filteredActions[activeIndex]
                if (action) runAction(action)
              }
            }}
            placeholder={tx('commandPalette.placeholder')}
            aria-label={tx('commandPalette.placeholder')}
          />
          <kbd>{tx('commandPalette.esc')}</kbd>
        </div>
        <div className="command-palette-list" role="listbox" aria-label={tx('commandPalette.title')}>
          {filteredActions.length === 0 ? (
            <div className="command-palette-empty">
              <strong>{tx('commandPalette.empty')}</strong>
              <span>{tx('commandPalette.emptyHint')}</span>
            </div>
          ) : filteredActions.map((action, index) => (
            <button
              key={action.id}
              type="button"
              className={`command-palette-item${index === activeIndex ? ' active' : ''}`}
              disabled={action.disabled}
              role="option"
              aria-selected={index === activeIndex}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => runAction(action)}
            >
              <span className="command-palette-icon" aria-hidden="true">{action.icon}</span>
              <span className="command-palette-copy">
                <strong>{action.label}</strong>
                {action.description ? <em>{action.description}</em> : null}
              </span>
              {action.shortcut ? <kbd>{action.shortcut}</kbd> : null}
            </button>
          ))}
        </div>
      </div>
      </div>
    </ModalPortal>
  )
}
