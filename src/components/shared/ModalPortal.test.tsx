import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ModalPortal } from './ModalPortal'

describe('ModalPortal', () => {
  afterEach(() => {
    cleanup()
    document.querySelectorAll('.atlas-shell, .admin-shell').forEach((node) => node.remove())
  })

  it('renders modal content in the top-level overlay host instead of a transformed screen subtree', () => {
    const host = document.createElement('div')
    host.className = 'atlas-shell'
    document.body.append(host)

    render(
      <div data-testid="screen-stage">
        <ModalPortal>
          <div data-testid="modal-layer" />
        </ModalPortal>
      </div>,
    )

    const stage = screen.getByTestId('screen-stage')
    const modal = screen.getByTestId('modal-layer')
    expect(stage).not.toContainElement(modal)
    expect(modal.parentElement).toBe(host)
  })

  it('falls back to document.body when no app shell is mounted', () => {
    render(
      <ModalPortal>
        <div data-testid="body-modal-layer" />
      </ModalPortal>,
    )

    expect(screen.getByTestId('body-modal-layer').parentElement).toBe(document.body)
  })
})
