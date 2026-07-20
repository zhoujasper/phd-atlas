import { Check, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { getMotionDelay, overlayExitDurationMs } from '../hooks/useAnimatedClose'

export type ExplorerContextMenuSubmenu = {
  title: string
  subtitle?: string
  backLabel: string
  items: ExplorerContextMenuItem[]
}

export type ExplorerContextMenuItem = {
  id: string
  label: string
  icon?: ReactNode
  disabled?: boolean
  tone?: 'default' | 'danger'
  shortcut?: string
  /** Single key used while the context menu is already open (for example O, C, Enter, or Space). */
  accessKey?: string
  radio?: boolean
  selected?: boolean
  statusTone?: 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'accent' | 'purple'
  /** Precise status slug for color dots (`missing`, `in-progress`, `submitted`, …). */
  statusSlug?: string
  submenu?: ExplorerContextMenuSubmenu
  onSelect?: () => void
}

export type ExplorerContextMenuState = {
  x: number
  y: number
  title: string
  subtitle?: string
  items: ExplorerContextMenuItem[]
  /**
   * Optional snapping/scrolling surface that must stay still while the menu is open.
   * Used by horizontal carousels so residual smooth-scroll momentum cannot move the
   * trigger underneath the fixed menu and immediately dismiss it.
   */
  scrollLockTarget?: HTMLElement | null
}

function isStatusPickerMenu(items: ExplorerContextMenuItem[]) {
  return items.length > 0 && items.every((item) => Boolean(item.statusTone) || item.radio)
}

function resolveMenuPosition(menu: ExplorerContextMenuState) {
  if (typeof window === 'undefined') return { x: menu.x, y: menu.y, transformOrigin: '12px 12px' }
  const padding = 8
  const statusPicker = isStatusPickerMenu(menu.items)
  const width = Math.min(statusPicker ? 248 : 260, Math.max(0, window.innerWidth - padding * 2))
  const estimatedHeader = menu.subtitle ? 54 : 42
  const rowHeight = statusPicker ? 36 : 34
  const estimatedActions = menu.items.length * rowHeight
  const estimatedHeight = Math.min(window.innerHeight - padding * 2, estimatedHeader + estimatedActions + 16)
  const x = Math.min(Math.max(padding, menu.x), Math.max(padding, window.innerWidth - width - padding))
  const y = Math.min(Math.max(padding, menu.y), Math.max(padding, window.innerHeight - estimatedHeight - padding))
  const originInset = 12
  const originX = Math.min(Math.max(originInset, menu.x - x), Math.max(originInset, width - originInset))
  const originY = Math.min(
    Math.max(originInset, menu.y - y),
    Math.max(originInset, estimatedHeight - originInset),
  )
  return {
    x,
    y,
    transformOrigin: `${Math.round(originX)}px ${Math.round(originY)}px`,
  }
}

function normalizeAccessKey(value: string | undefined) {
  if (!value) return null
  const normalized = value.trim().toLowerCase()
  if (normalized === ' ') return 'space'
  return normalized
}

function keyFromEvent(event: KeyboardEvent) {
  if (event.ctrlKey || event.metaKey || event.altKey) return null
  if (event.key === ' ') return 'space'
  return event.key.toLowerCase()
}

const SUBMENU_GAP = 4

function resolveSubmenuPosition(anchor: DOMRect, submenu: ExplorerContextMenuSubmenu) {
  const padding = 8
  const gap = SUBMENU_GAP
  const statusPicker = isStatusPickerMenu(submenu.items)
  const width = Math.min(statusPicker ? 248 : 260, Math.max(0, window.innerWidth - padding * 2))
  const estimatedHeader = submenu.subtitle ? 56 : 44
  const rowHeight = statusPicker ? 36 : 34
  const estimatedHeight = Math.min(
    window.innerHeight - padding * 2,
    estimatedHeader + Math.min(submenu.items.length, 10) * rowHeight + 20,
  )
  if (window.innerWidth < 560) {
    const mobileNavClearance = 84
    return {
      x: padding,
      y: Math.max(padding, window.innerHeight - estimatedHeight - mobileNavClearance),
      side: 'bottom' as const,
    }
  }
  const fitsRight = anchor.right + gap + width <= window.innerWidth - padding
  const fitsLeft = anchor.left - gap - width >= padding
  const side = fitsRight || !fitsLeft ? 'right' : 'left'
  const preferredX = side === 'right' ? anchor.right + gap : anchor.left - width - gap
  return {
    x: Math.min(Math.max(padding, preferredX), Math.max(padding, window.innerWidth - width - padding)),
    y: Math.min(Math.max(padding, anchor.top - 8), Math.max(padding, window.innerHeight - estimatedHeight - padding)),
    side: side as 'left' | 'right',
  }
}

function menuItemClassName(item: ExplorerContextMenuItem, extra: string[] = []) {
  return [
    item.tone === 'danger' ? 'danger' : '',
    item.selected ? 'selected' : '',
    item.statusTone ? `status-${item.statusTone}` : '',
    item.statusSlug ? `status-slug-${item.statusSlug}` : '',
    item.submenu ? 'has-submenu' : '',
    ...extra,
  ].filter(Boolean).join(' ')
}

function MenuItemContent({ item }: { item: ExplorerContextMenuItem }) {
  const showStatusDot = Boolean(item.statusTone || item.statusSlug)
  return (
    <>
      {showStatusDot ? (
        <span className="explorer-context-status-dot" aria-hidden="true" />
      ) : item.icon ? (
        <span className="explorer-context-icon">{item.icon}</span>
      ) : (
        <span className="explorer-context-icon-spacer" aria-hidden="true" />
      )}
      <span className="explorer-context-label">{item.label}</span>
      <span className="explorer-context-trail">
        {item.shortcut ? <kbd className="explorer-context-shortcut" aria-hidden="true">{item.shortcut}</kbd> : null}
        {item.selected ? <Check className="explorer-context-indicator" size={14} strokeWidth={2.4} aria-hidden="true" /> : null}
        {!item.selected && item.submenu ? (
          <ChevronRight className="explorer-context-indicator" size={14} aria-hidden="true" />
        ) : null}
      </span>
    </>
  )
}

/** Barycentric point-in-triangle test (inclusive edges). */
function pointInTriangle(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
) {
  const v0x = cx - ax
  const v0y = cy - ay
  const v1x = bx - ax
  const v1y = by - ay
  const v2x = px - ax
  const v2y = py - ay
  const dot00 = v0x * v0x + v0y * v0y
  const dot01 = v0x * v1x + v0y * v1y
  const dot02 = v0x * v2x + v0y * v2y
  const dot11 = v1x * v1x + v1y * v1y
  const dot12 = v1x * v2x + v1y * v2y
  const denom = dot00 * dot11 - dot01 * dot01
  if (Math.abs(denom) < 1e-8) return false
  const inv = 1 / denom
  const u = (dot11 * dot02 - dot01 * dot12) * inv
  const v = (dot00 * dot12 - dot01 * dot02) * inv
  return u >= -0.01 && v >= -0.01 && u + v <= 1.01
}

/**
 * Safe-triangle zone from the last pointer sample to the submenu’s near edge.
 * Cursor paths through this triangle while aiming at the flyout should not
 * dismiss it when they cross other main-menu rows.
 */
function isPointInSubmenuSafeTriangle(
  x: number,
  y: number,
  originX: number,
  originY: number,
  submenu: DOMRect,
  side: 'left' | 'right' | 'bottom',
) {
  if (side === 'right') {
    const edge = submenu.left
    return pointInTriangle(x, y, originX, originY, edge, submenu.top, edge, submenu.bottom)
  }
  if (side === 'left') {
    const edge = submenu.right
    return pointInTriangle(x, y, originX, originY, edge, submenu.top, edge, submenu.bottom)
  }
  const edge = submenu.top
  return pointInTriangle(x, y, originX, originY, submenu.left, edge, submenu.right, edge)
}

type ActiveSubmenu = {
  parentId: string
  menu: ExplorerContextMenuSubmenu
  position: ReturnType<typeof resolveSubmenuPosition>
  anchorRect: { top: number; bottom: number; left: number; right: number }
}

const SUBMENU_CLOSE_MS = 220
const SUBMENU_CLOSE_SAFE_MS = 420
const CONTEXT_SCROLL_LOCK_CLASS = 'explorer-context-scroll-lock'

export function ExplorerContextMenu({
  menu,
  onClose,
}: {
  menu: ExplorerContextMenuState | null
  onClose: () => void
}) {
  const [position, setPosition] = useState(() => (
    menu ? resolveMenuPosition(menu) : { x: 0, y: 0, transformOrigin: '12px 12px' }
  ))
  const [displayedMenu, setDisplayedMenu] = useState<ExplorerContextMenuState | null>(menu)
  const [activeSubmenu, setActiveSubmenu] = useState<ActiveSubmenu | null>(null)
  const [closing, setClosing] = useState(false)
  const closeTimerRef = useRef<number | null>(null)
  const submenuCloseTimerRef = useRef<number | null>(null)
  const mainMenuRef = useRef<HTMLDivElement | null>(null)
  const submenuRef = useRef<HTMLDivElement | null>(null)
  const lockedScrollTargetRef = useRef<HTMLElement | null>(null)
  const pointerRef = useRef({ x: 0, y: 0 })
  const safeOriginRef = useRef({ x: 0, y: 0 })
  const activeSubmenuRef = useRef<ActiveSubmenu | null>(null)
  activeSubmenuRef.current = activeSubmenu

  const releaseScrollLock = useCallback(() => {
    lockedScrollTargetRef.current?.classList.remove(CONTEXT_SCROLL_LOCK_CLASS)
    lockedScrollTargetRef.current = null
  }, [])

  const stabilizeScrollTarget = useCallback((target: HTMLElement | null | undefined) => {
    const currentTarget = lockedScrollTargetRef.current
    if (currentTarget && currentTarget !== target) currentTarget.classList.remove(CONTEXT_SCROLL_LOCK_CLASS)
    if (!target) {
      lockedScrollTargetRef.current = null
      return
    }

    // Disable snapping before cancelling the in-flight animation. Calling scrollTo
    // with the current coordinates terminates browser smooth-scroll / trackpad
    // momentum without pulling the focused card toward a snap point.
    const left = target.scrollLeft
    const top = target.scrollTop
    target.classList.add(CONTEXT_SCROLL_LOCK_CLASS)
    if (typeof target.scrollTo === 'function') {
      target.scrollTo({ left, top, behavior: 'auto' })
    } else {
      target.scrollLeft = left
      target.scrollTop = top
    }
    lockedScrollTargetRef.current = target
  }, [])

  // Run before the first menu paint, so the card rail cannot advance another
  // visible frame between the contextmenu event and the menu appearing.
  useLayoutEffect(() => {
    if (!menu) return
    stabilizeScrollTarget(menu.scrollLockTarget)
  }, [menu, stabilizeScrollTarget])

  // Keep rendering the last menu briefly after `menu` goes null so the exit animation can play,
  // mirroring the exiting-state pattern used by Select.tsx / DatePicker.tsx / TimePicker.tsx.
  useEffect(() => {
    if (menu) {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
      setPosition(resolveMenuPosition(menu))
      setDisplayedMenu(menu)
      setActiveSubmenu(null)
      setClosing(false)
      return undefined
    }
    if (!displayedMenu) return undefined
    setClosing(true)
    closeTimerRef.current = window.setTimeout(() => {
      setDisplayedMenu(null)
      setClosing(false)
      releaseScrollLock()
      closeTimerRef.current = null
    }, getMotionDelay(overlayExitDurationMs))
    return () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, releaseScrollLock])

  const clearSubmenuClose = () => {
    if (submenuCloseTimerRef.current === null) return
    window.clearTimeout(submenuCloseTimerRef.current)
    submenuCloseTimerRef.current = null
  }

  const scheduleSubmenuClose = (delayMs = SUBMENU_CLOSE_MS) => {
    clearSubmenuClose()
    submenuCloseTimerRef.current = window.setTimeout(() => {
      setActiveSubmenu(null)
      submenuCloseTimerRef.current = null
    }, getMotionDelay(delayMs))
  }

  const openSubmenu = (item: ExplorerContextMenuItem, anchor: HTMLElement) => {
    if (!item.submenu || item.disabled) return
    clearSubmenuClose()
    const rect = anchor.getBoundingClientRect()
    safeOriginRef.current = {
      x: pointerRef.current.x || rect.right,
      y: pointerRef.current.y || (rect.top + rect.height / 2),
    }
    setActiveSubmenu({
      parentId: item.id,
      menu: item.submenu,
      position: resolveSubmenuPosition(rect, item.submenu),
      anchorRect: {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
      },
    })
  }

  const isAimingAtSubmenu = (x: number, y: number) => {
    const current = activeSubmenuRef.current
    const submenuEl = submenuRef.current
    if (!current || !submenuEl) return false
    const sub = submenuEl.getBoundingClientRect()
    // Expand the hit slightly so the gap between panels stays protected.
    const padded = {
      top: sub.top - 4,
      bottom: sub.bottom + 4,
      left: sub.left - 4,
      right: sub.right + 4,
      width: sub.width + 8,
      height: sub.height + 8,
      x: sub.left - 4,
      y: sub.top - 4,
      toJSON: () => ({}),
    } as DOMRect
    if (x >= padded.left && x <= padded.right && y >= padded.top && y <= padded.bottom) {
      return true
    }
    return isPointInSubmenuSafeTriangle(
      x,
      y,
      safeOriginRef.current.x,
      safeOriginRef.current.y,
      padded,
      current.position.side,
    )
  }

  // Track pointer so safe-triangle checks use a fresh origin sample.
  useEffect(() => {
    if (!menu || !activeSubmenu) return undefined
    const onMove = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY }
      // While still inside the safe cone, keep refreshing the origin so the
      // triangle follows the cursor instead of collapsing behind it.
      if (isAimingAtSubmenu(event.clientX, event.clientY)) {
        safeOriginRef.current = { x: event.clientX, y: event.clientY }
        clearSubmenuClose()
      }
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [activeSubmenu, menu])

  useEffect(() => {
    if (!menu) return undefined
    const close = () => onClose()
    // Right-click on focusable rows often focuses the trigger first. Nested scrollers
    // (dashboard application carousel, explorer lists) may then fire scroll/snap events
    // for a frame or two. Closing on those would make the menu flash open and vanish.
    let scrollCloseArmed = false
    let armFrameA = 0
    let armFrameB = 0
    const armScrollClose = () => {
      scrollCloseArmed = true
    }
    armFrameA = window.requestAnimationFrame(() => {
      armFrameB = window.requestAnimationFrame(armScrollClose)
    })
    // Fallback if rAF is throttled (background tab) so intentional page scrolls still dismiss.
    const armTimer = window.setTimeout(armScrollClose, getMotionDelay(120))
    const closeOnScroll = (event: Event) => {
      if (!scrollCloseArmed) return
      // Status flyouts (and any long main menu) scroll internally. Those must
      // not dismiss the menu — only page/ancestor scrolls should.
      const target = event.target
      if (target instanceof Node) {
        if (mainMenuRef.current?.contains(target)) return
        if (submenuRef.current?.contains(target)) return
      }
      onClose()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (activeSubmenu) {
          event.preventDefault()
          setActiveSubmenu(null)
        } else {
          onClose()
        }
        return
      }
      if (event.key === 'ArrowLeft' && activeSubmenu) {
        event.preventDefault()
        setActiveSubmenu(null)
        return
      }
      const pressedKey = keyFromEvent(event)
      if (!pressedKey) return
      const submenuItem = activeSubmenu?.menu.items.find(
        (candidate) => normalizeAccessKey(candidate.accessKey ?? candidate.shortcut) === pressedKey,
      )
      const mainItem = displayedMenu?.items.find(
        (candidate) => normalizeAccessKey(candidate.accessKey ?? candidate.shortcut) === pressedKey,
      )
      const item = submenuItem ?? mainItem
      if (!item || item.disabled) return
      event.preventDefault()
      event.stopPropagation()
      if (item.submenu) {
        const anchor = Array.from(
          mainMenuRef.current?.querySelectorAll<HTMLElement>('[data-menu-item-id]') ?? [],
        ).find((candidate) => candidate.dataset.menuItemId === item.id)
        if (anchor) openSubmenu(item, anchor)
        return
      }
      item.onSelect?.()
      onClose()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', closeOnScroll, true)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(armFrameA)
      window.cancelAnimationFrame(armFrameB)
      window.clearTimeout(armTimer)
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', closeOnScroll, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [activeSubmenu, displayedMenu, menu, onClose])

  useEffect(() => () => {
    clearSubmenuClose()
    releaseScrollLock()
  }, [releaseScrollLock])

  if (!displayedMenu || typeof document === 'undefined') return null

  const bridgeStyle = (() => {
    if (!activeSubmenu || activeSubmenu.position.side === 'bottom') return null
    const sub = {
      left: activeSubmenu.position.x,
      top: activeSubmenu.position.y,
    }
    const anchor = activeSubmenu.anchorRect
    const side = activeSubmenu.position.side
    // Invisible hit strip covering the gap + a diagonal-friendly expansion.
    if (side === 'right') {
      const left = anchor.right
      const width = Math.max(SUBMENU_GAP + 2, sub.left - anchor.right + 2)
      const top = Math.min(anchor.top, sub.top) - 8
      const bottom = Math.max(anchor.bottom, sub.top + 120)
      return {
        left,
        top,
        width,
        height: Math.max(bottom - top, anchor.bottom - anchor.top + 16),
      }
    }
    const width = Math.max(SUBMENU_GAP + 2, anchor.left - (sub.left + 248) + 8)
    const right = anchor.left
    const top = Math.min(anchor.top, sub.top) - 8
    const bottom = Math.max(anchor.bottom, sub.top + 120)
    return {
      left: right - width,
      top,
      width,
      height: Math.max(bottom - top, anchor.bottom - anchor.top + 16),
    }
  })()

  return createPortal(
    <>
      <div
        ref={mainMenuRef}
        className={`explorer-context-menu ${activeSubmenu?.position.side === 'bottom' ? 'submenu-covered' : ''} ${closing ? 'exit' : ''}`}
        style={{ left: position.x, top: position.y, transformOrigin: position.transformOrigin }}
        role="menu"
        aria-label={displayedMenu.title}
        onPointerEnter={() => {
          clearSubmenuClose()
        }}
        onPointerLeave={(event) => {
          if (!activeSubmenu) return
          // Leaving toward the flyout / bridge stays open via safe-triangle grace.
          if (isAimingAtSubmenu(event.clientX, event.clientY)) {
            scheduleSubmenuClose(SUBMENU_CLOSE_SAFE_MS)
            return
          }
          scheduleSubmenuClose(SUBMENU_CLOSE_MS)
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className="explorer-context-head">
          <strong>{displayedMenu.title}</strong>
          {displayedMenu.subtitle ? <span>{displayedMenu.subtitle}</span> : null}
        </div>
        <div className={`explorer-context-actions${isStatusPickerMenu(displayedMenu.items) ? ' is-status-picker' : ''}`}>
          {displayedMenu.items.map((item) => (
          <button
            key={item.id}
            data-menu-item-id={item.id}
            type="button"
            role={item.radio ? 'menuitemradio' : 'menuitem'}
            aria-checked={item.radio ? Boolean(item.selected) : undefined}
            aria-haspopup={item.submenu ? 'menu' : undefined}
            aria-expanded={item.submenu ? activeSubmenu?.parentId === item.id : undefined}
            className={menuItemClassName(item, [activeSubmenu?.parentId === item.id ? 'submenu-open' : ''])}
            disabled={item.disabled}
            onPointerEnter={(event) => {
              pointerRef.current = { x: event.clientX, y: event.clientY }
              if (item.submenu) {
                openSubmenu(item, event.currentTarget)
                return
              }
              // Crossing other rows while aiming at the open flyout should not
              // kill it. Geometry can be temporarily stale while either panel
              // is being positioned, so preserve the flyout for the safe grace
              // period even when the cursor sample sits just outside the cone.
              if (activeSubmenu && activeSubmenu.parentId !== item.id) {
                if (isAimingAtSubmenu(event.clientX, event.clientY)) {
                  scheduleSubmenuClose(SUBMENU_CLOSE_SAFE_MS)
                  return
                }
                scheduleSubmenuClose(SUBMENU_CLOSE_SAFE_MS)
                return
              }
              clearSubmenuClose()
              setActiveSubmenu(null)
            }}
            onFocus={(event) => {
              if (item.submenu) openSubmenu(item, event.currentTarget)
            }}
            onKeyDown={(event) => {
              if (item.submenu && (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault()
                openSubmenu(item, event.currentTarget)
              }
            }}
            onClick={(event) => {
              if (item.submenu) {
                openSubmenu(item, event.currentTarget)
                return
              }
              item.onSelect?.()
              onClose()
            }}
          >
            <MenuItemContent item={item} />
          </button>
          ))}
        </div>
      </div>
      {activeSubmenu && bridgeStyle ? (
        <div
          className="explorer-context-submenu-bridge"
          style={{
            left: bridgeStyle.left,
            top: bridgeStyle.top,
            width: bridgeStyle.width,
            height: bridgeStyle.height,
          }}
          aria-hidden="true"
          onPointerEnter={clearSubmenuClose}
          onPointerMove={(event) => {
            pointerRef.current = { x: event.clientX, y: event.clientY }
            safeOriginRef.current = { x: event.clientX, y: event.clientY }
            clearSubmenuClose()
          }}
        />
      ) : null}
      {activeSubmenu ? (
        <div
          ref={submenuRef}
          className={[
            'explorer-context-menu',
            'explorer-context-submenu',
            `side-${activeSubmenu.position.side}`,
            isStatusPickerMenu(activeSubmenu.menu.items) ? 'is-status-picker' : '',
            closing ? 'exit' : '',
          ].filter(Boolean).join(' ')}
          style={{ left: activeSubmenu.position.x, top: activeSubmenu.position.y }}
          role="menu"
          aria-label={activeSubmenu.menu.title}
          onPointerEnter={() => {
            clearSubmenuClose()
            const el = submenuRef.current
            if (el) {
              const rect = el.getBoundingClientRect()
              // Once inside the flyout, park the safe origin on the near edge
              // so returning to the parent item stays easy.
              if (activeSubmenu.position.side === 'right') {
                safeOriginRef.current = { x: rect.left, y: pointerRef.current.y }
              } else if (activeSubmenu.position.side === 'left') {
                safeOriginRef.current = { x: rect.right, y: pointerRef.current.y }
              } else {
                safeOriginRef.current = { x: pointerRef.current.x, y: rect.top }
              }
            }
          }}
          onPointerLeave={(event) => {
            // Wheel/trackpad scroll keeps the pointer over the flyout; relatedTarget
            // inside the flyout means we are not actually leaving.
            const related = event.relatedTarget
            if (related instanceof Node && submenuRef.current?.contains(related)) {
              clearSubmenuClose()
              return
            }
            if (related instanceof Node && mainMenuRef.current?.contains(related)) {
              clearSubmenuClose()
              return
            }
            if (isAimingAtSubmenu(event.clientX, event.clientY)) {
              scheduleSubmenuClose(SUBMENU_CLOSE_SAFE_MS)
              return
            }
            scheduleSubmenuClose(SUBMENU_CLOSE_MS)
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={(event) => {
            // Keep the flyout open while the user scrolls its own list.
            event.stopPropagation()
            clearSubmenuClose()
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="explorer-context-head">
            <strong>{activeSubmenu.menu.title}</strong>
            {activeSubmenu.menu.subtitle ? <span>{activeSubmenu.menu.subtitle}</span> : null}
          </div>
          <div
            className={`explorer-context-actions${isStatusPickerMenu(activeSubmenu.menu.items) ? ' is-status-picker' : ''}`}
            onScroll={() => clearSubmenuClose()}
            onWheel={() => clearSubmenuClose()}
          >
            {activeSubmenu.menu.items.map((item) => (
              <button
                key={item.id}
                type="button"
                role={item.radio ? 'menuitemradio' : 'menuitem'}
                aria-checked={item.radio ? Boolean(item.selected) : undefined}
                className={menuItemClassName(item)}
                disabled={item.disabled}
                onClick={() => {
                  item.onSelect?.()
                  onClose()
                }}
              >
                <MenuItemContent item={item} />
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </>,
    document.body,
  )
}
