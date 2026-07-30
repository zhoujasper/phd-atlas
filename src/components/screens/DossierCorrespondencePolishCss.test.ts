import { describe, expect, it } from 'vitest'
import dossierStyles from '../../index.css?raw'
import mobileStyles from '../../styles/mobile.css?raw'

const normalizedStyles = dossierStyles.replace(/\r\n/g, '\n')
const normalizedMobileStyles = mobileStyles.replace(/\r\n/g, '\n')

function cssRule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = normalizedStyles.match(new RegExp(`(?:^|\\n)[\\t ]*${escaped}\\s*\\{([^}]*)\\}`))
  expect(match, `Missing CSS rule: ${selector}`).not.toBeNull()
  return match?.[1] ?? ''
}

describe('Dossier correspondence visual polish', () => {
  it('keeps hover paint inside each content-visibility boundary', () => {
    const card = cssRule('.correspondence-event-card')
    const hover = cssRule('.correspondence-event-card:hover')

    expect(card).not.toContain('transform var(')
    expect(hover).not.toContain('transform:')
    expect(hover).toContain('border-color: var(--border-strong)')
    expect(hover).toContain('box-shadow: var(--shadow-xs)')
  })

  it('uses one transparent, integrated action language for reply, copy, edit, and delete', () => {
    const actions = cssRule('.correspondence-event-actions')
    const iconButtons = cssRule(
      '.correspondence-event-actions .copy-button,\n'
      + '.correspondence-event-actions .correspondence-ai-reply-btn,\n'
      + '.correspondence-edit-btn,\n'
      + '.correspondence-delete-btn',
    )
    const iconStage = cssRule('.correspondence-edit-icon-stage')
    const primaryHover = cssRule(
      '.correspondence-event-actions .copy-button:hover,\n'
      + '.correspondence-event-actions .correspondence-ai-reply-btn:hover,\n'
      + '.correspondence-edit-btn:hover,\n'
      + '.correspondence-edit-btn.active',
    )
    const deleteHover = cssRule('.correspondence-delete-btn:hover')
    const pressed = cssRule(
      '.correspondence-event-actions button:is(.copy-button, .correspondence-ai-reply-btn, .correspondence-edit-btn, .correspondence-delete-btn):active:not(:disabled)',
    )
    const primaryPressed = cssRule(
      '.correspondence-event-actions button:is(.copy-button, .correspondence-ai-reply-btn, .correspondence-edit-btn):active:not(:disabled)',
    )
    const deletePressed = cssRule(
      '.correspondence-event-actions button.correspondence-delete-btn:active:not(:disabled)',
    )
    const focusVisible = cssRule(
      '.correspondence-event-actions button:is(.copy-button, .correspondence-ai-reply-btn, .correspondence-edit-btn, .correspondence-delete-btn):focus-visible',
    )

    expect(actions).toContain('align-items: center')
    expect(actions).toContain('pointer-events: none')
    expect(actions).toContain('transform: translate3d(0, 2px, 0)')
    expect(actions).toContain('opacity var(--duration-fast)')
    expect(actions).toContain('transform var(--duration)')
    expect(iconButtons).toContain('width: 28px')
    expect(iconButtons).toContain('height: 28px')
    expect(iconButtons).toContain('display: inline-grid')
    expect(iconButtons).toContain('place-items: center')
    expect(iconButtons).toContain('border: 0')
    expect(iconButtons).toContain('background: transparent')
    expect(iconButtons).not.toContain('var(--surface)')
    expect(iconButtons).toContain('line-height: 1')
    expect(iconStage).toContain('display: grid')
    expect(iconStage).toContain('place-items: center')
    expect(primaryHover).toContain('var(--accent-soft)')
    expect(primaryHover).toContain('transparent')
    expect(primaryHover).not.toContain('var(--surface)')
    expect(deleteHover).toContain('var(--danger-bg)')
    expect(deleteHover).toContain('transparent')
    expect(pressed).toContain('transform: scale(0.9)')
    expect(primaryPressed).toContain('var(--accent-soft)')
    expect(primaryPressed).toContain('transparent')
    expect(deletePressed).toContain('var(--danger-bg)')
    expect(deletePressed).toContain('transparent')
    expect(focusVisible).toContain('var(--accent-ring)')
  })

  it('derives visibly distinct incoming and outgoing bubbles from the active accent', () => {
    const incoming = cssRule('.correspondence-event.incoming:not(.is-note) .correspondence-event-card:not(.draft-card)')
    const outgoing = cssRule('.correspondence-event.outgoing:not(.is-note) .correspondence-event-card:not(.draft-card)')

    expect(incoming).toContain('var(--accent) 3%')
    expect(outgoing).toContain('var(--accent) 12%')
    expect(incoming).not.toBe(outgoing)
  })

  it('uses the shared collapsible motion and a token-based sticky-note treatment', () => {
    const editor = cssRule('.correspondence-edit-panel')
    const note = cssRule('.correspondence-event-card.note-card')
    const noteFold = cssRule('.correspondence-event-card.note-card::after')

    expect(editor).not.toContain('animation:')
    expect(note).toContain('var(--warning-bg)')
    expect(note).toContain('width: min(560px, 100%)')
    expect(normalizedStyles).not.toMatch(
      /(?:^|\n)\.correspondence-event-card\.note-card::before\s*\{/,
    )
    expect(noteFold).toContain('linear-gradient')
    expect(noteFold).toContain('var(--canvas)')
    expect(noteFold).toContain('var(--warning)')
  })

  it('keeps mobile notes on the same inset bubble track as other correspondence', () => {
    const noteTrack = cssRule('.correspondence-event:is(.note, .is-note)')
    const noteCard = cssRule('.correspondence-event:is(.note, .is-note) .correspondence-event-card')

    expect(noteTrack).toContain('grid-template-columns: 28px minmax(0, 1fr) 28px')
    expect(noteCard).toContain('grid-column: 2')
    expect(noteCard).toContain('width: min(680px, 100%)')
  })

  it('keeps the active reply context compact, scroll-bounded, and token based', () => {
    const modeBar = cssRule('.correspondence-mode-bar')
    const context = cssRule('.composer-reply-context')
    const toggle = cssRule('.composer-reply-context-toggle')
    const detail = cssRule('.composer-reply-context-detail')

    expect(modeBar).toContain('scroll-margin-block-start: 16px')
    expect(context).toContain('var(--surface)')
    expect(context).toContain('var(--accent)')
    expect(toggle).toContain('grid-template-columns: 32px minmax(0, 1fr) 28px')
    expect(detail).toContain('max-height: 240px')
    expect(detail).toContain('overflow: auto')
  })

  it('keeps multi-recipient controls compact, progressive, and motion-bounded', () => {
    const toolbar = cssRule('.correspondence-mode-toolbar')
    const modeIndicator = cssRule('.correspondence-mode-bar::before')
    const modeButton = cssRule('.correspondence-mode-bar button')
    const settingsTrigger = cssRule('.correspondence-recipient-settings-trigger')
    const settingsIcon = cssRule('.correspondence-recipient-settings-icon')
    const settingsPopover = cssRule('.correspondence-recipient-settings-popover')
    const temporaryRecipient = cssRule('.composer-recipient-control.temporary')
    const trackingDialog = cssRule('.recipient-tracking-dialog')

    expect(toolbar).toContain('display: flex')
    expect(toolbar).toContain('gap: 6px')
    expect(modeIndicator).toContain('border-radius: var(--radius)')
    expect(modeButton).toContain('height: var(--action-height)')
    expect(modeButton).toContain('min-height: var(--action-height)')
    expect(modeButton).toContain('padding: 0 var(--action-padding-inline-compact)')
    expect(modeButton).toContain('font-size: 12px')
    expect(settingsTrigger).toContain('width: var(--action-height-compact)')
    expect(settingsTrigger).toContain('height: var(--action-height-compact)')
    expect(settingsTrigger).toContain('display: inline-grid')
    expect(settingsTrigger).toContain('place-items: center')
    expect(settingsTrigger).toContain('border: 0')
    expect(settingsTrigger).toContain('background: transparent')
    expect(settingsIcon).toContain('width: 13px')
    expect(settingsIcon).toContain('height: 13px')
    expect(normalizedMobileStyles).toMatch(
      /\.correspondence-recipient-settings-trigger\s*\{[^}]*width:\s*32px[^}]*height:\s*32px[^}]*min-height:\s*32px !important/s,
    )
    expect(settingsPopover).toContain('--anchored-popover-enter-duration: 190ms')
    expect(settingsPopover).toContain('--anchored-popover-exit-duration: 150ms')
    expect(temporaryRecipient).toContain('var(--warning-bg)')
    expect(trackingDialog).toContain('width: min(520px, calc(100% - 32px))')
    expect(normalizedStyles).toContain('grid-template-columns: minmax(0, 1fr) auto')
    expect(normalizedStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.recipient-tracking-dialog,[\s\S]*?animation: none/,
    )
  })

  it('carries mail between the sender and recipient on one responsive behind-card route', () => {
    const routeCard = cssRule('.draft-route-info > div')
    const connector = cssRule('.composer-route-connector')
    const track = cssRule('.composer-route-connector::before')
    const arrowhead = cssRule('.composer-route-connector::after')
    const flight = cssRule('.composer-route-info .composer-route-flight')

    expect(routeCard).toContain('position: relative')
    expect(routeCard).toContain('z-index: 1')
    expect(connector).toContain('width: 42px')
    expect(connector).toContain('height: 46px')
    expect(connector).toContain('isolation: isolate')
    expect(connector).toContain('pointer-events: none')
    expect(connector).not.toContain('background: var(--accent-soft)')
    expect(track).toContain('inset-inline: -14px')
    expect(track).toContain('linear-gradient')
    expect(arrowhead).toContain('clip-path: polygon(0 0, 100% 50%, 0 100%)')
    expect(arrowhead).toContain('right: -7px')
    expect(flight).toContain('border-radius: 50%')
    expect(flight).toContain('background: var(--surface)')
    expect(flight).toContain('animation: composer-route-flight-in 620ms')
    expect(normalizedStyles).toContain('@keyframes composer-route-flight-pass-mobile')
    expect(normalizedStyles).toMatch(
      /@media \(max-width: 820px\)[\s\S]*?\.composer-route-connector::before\s*\{[^}]*inset:\s*-14px auto[^}]*left:\s*50%[^}]*width:\s*1px/s,
    )
    expect(normalizedStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.composer-route-info \.composer-route-flight,[\s\S]*?animation:\s*none/s,
    )
  })
})
