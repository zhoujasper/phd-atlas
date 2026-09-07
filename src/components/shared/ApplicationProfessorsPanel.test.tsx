import { preloadLanguage } from '../../i18n'
import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ApplicationProfessorsPanel } from './ApplicationProfessorsPanel'
import { emptyProfessor, type ProfessorApplication } from '../../../shared/applicationProfessors.js'
import { correspondenceAvatarIdentity } from '../../correspondenceIdentity'
import type { ApplicationRecord } from '../../data/applications'

beforeAll(() => preloadLanguage('en', ['dossier']))
afterEach(cleanup)
const first = { ...emptyProfessor(), id: 'first', english: 'Professor First', email: 'first@example.edu', research: 'First research' }
const second = { ...emptyProfessor(), id: 'second', english: 'Professor Second', email: 'second@example.edu', research: 'Second research', correspondenceEmails: ['lab@example.edu'] }

describe('intended supervisor editor', () => {
  it('switches one editor between independent profiles and retains typed fields', async () => {
    const user = userEvent.setup()
    const changed = vi.fn()
    function Harness() {
      const [value, setValue] = useState<ProfessorApplication>({ professor: first, additionalProfessors: [second] })
      return <ApplicationProfessorsPanel value={value} onChange={(next) => { setValue(next); changed(next) }} />
    }
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: /Professor Second second@example.edu/ }))
    const name = screen.getByRole('textbox', { name: 'Professor' })
    expect(name).toHaveValue('Professor Second')
    await user.clear(name)
    await user.type(name, 'Professor New')
    await user.click(screen.getByRole('button', { name: /Professor First first@example.edu/ }))
    expect(name).toHaveValue('Professor First')
    await user.click(screen.getByRole('button', { name: /Professor New second@example.edu/ }))
    expect(name).toHaveValue('Professor New')
    expect(changed.mock.lastCall?.[0].professor.research).toBe('First research')
    expect(changed.mock.lastCall?.[0].additionalProfessors[0].research).toBe('Second research')
  })

  it('preserves contact IDs when changing the default and confirms removal', async () => {
    const user = userEvent.setup()
    let current: ProfessorApplication = { professor: first, additionalProfessors: [second] }
    function Harness() {
      const [value, setValue] = useState(current)
      return <ApplicationProfessorsPanel value={value} onChange={(next) => { current = next; setValue(next) }} />
    }
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: /Professor Second second@example.edu/ }))
    await user.click(screen.getByRole('button', { name: 'Make default' }))
    expect(current.professor.id).toBe('second')
    expect(current.additionalProfessors?.[0].id).toBe('first')
    await user.click(screen.getByRole('button', { name: 'Remove supervisor: Professor Second' }))
    expect(current.professor.id).toBe('second')
    const confirmation = screen.getByRole('group', { name: 'Confirm delete: Professor Second' })
    expect(confirmation).toHaveAccessibleDescription(/Existing messages will remain/)
    expect(within(confirmation).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.click(within(confirmation).getByRole('button', { name: 'Confirm delete' }))
    expect(current.professor.id).toBe('first')
    expect(current.additionalProfessors).toEqual([])
    expect(screen.queryByRole('button', { name: /Remove supervisor:/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Professor First first@example.edu' })).toHaveFocus()
  })

  it('keeps the only profile undeletable, including an empty creation form and read-only profiles', () => {
    const changed = vi.fn()
    const { rerender } = render(<ApplicationProfessorsPanel value={{ professor: emptyProfessor() }} onChange={changed} createMode />)
    expect(screen.queryByRole('button', { name: /Remove supervisor:/ })).not.toBeInTheDocument()
    rerender(<ApplicationProfessorsPanel value={{ professor: first }} onChange={changed} />)
    expect(screen.queryByRole('button', { name: /Remove supervisor:/ })).not.toBeInTheDocument()
    rerender(<ApplicationProfessorsPanel value={{ professor: first, additionalProfessors: [second] }} onChange={changed} readOnly />)
    expect(screen.queryByRole('button', { name: /Remove supervisor:/ })).not.toBeInTheDocument()
    expect(changed).not.toHaveBeenCalled()
  })

  it('confirms on the target card, cancels without editing, and preserves the active profile when deleting another', async () => {
    const user = userEvent.setup()
    const changed = vi.fn()
    function Harness() {
      const [value, setValue] = useState<ProfessorApplication>({ professor: first, additionalProfessors: [second] })
      return <ApplicationProfessorsPanel value={value} onChange={(next) => { setValue(next); changed(next) }} />
    }
    const onOuterKey = vi.fn()
    render(<div onKeyDown={onOuterKey}><Harness /></div>)
    const trigger = screen.getByRole('button', { name: 'Remove supervisor: Professor Second' })
    const firstChoice = screen.getByRole('button', { name: 'Professor First first@example.edu' })
    const openConfirmation = async () => {
      await user.click(trigger)
      const confirmation = screen.getByRole('group', { name: 'Confirm delete: Professor Second' })
      expect(confirmation.closest('.professor-card')).toBe(trigger.closest('.professor-card'))
      expect(firstChoice).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('textbox', { name: 'Professor' })).toHaveValue('Professor First')
      return confirmation
    }
    let confirmation = await openConfirmation()
    await user.keyboard('{Enter}') // Opening focuses Cancel; Enter must never delete.
    expect(screen.queryByRole('group', { name: /Confirm delete:/ })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(changed).not.toHaveBeenCalled()

    confirmation = await openConfirmation()
    fireEvent.keyDown(within(confirmation).getByRole('button', { name: 'Cancel' }), { key: 'Escape', isComposing: true })
    expect(confirmation).toBeInTheDocument()
    onOuterKey.mockClear()
    await user.keyboard('{Escape}')
    expect(onOuterKey).not.toHaveBeenCalled()
    expect(trigger).toHaveFocus()
    expect(changed).not.toHaveBeenCalled()

    confirmation = await openConfirmation()
    await user.click(within(confirmation).getByRole('button', { name: 'Confirm delete' }))
    expect(changed).toHaveBeenCalledTimes(1)
    expect(changed.mock.lastCall?.[0]).toEqual({ professor: first, additionalProfessors: [] })
    expect(firstChoice).toHaveAttribute('aria-pressed', 'true')
    expect(firstChoice).toHaveFocus()
  })

  it('closes stale confirmation when only one profile remains and supports keyboard profile navigation', async () => {
    const user = userEvent.setup()
    const changed = vi.fn()
    const { rerender } = render(<ApplicationProfessorsPanel value={{ professor: first, additionalProfessors: [second] }} onChange={changed} />)
    const firstChoice = screen.getByRole('button', { name: 'Professor First first@example.edu' })
    const secondChoice = screen.getByRole('button', { name: 'Professor Second second@example.edu' })
    await user.click(firstChoice)
    await user.keyboard('{ArrowRight}')
    expect(secondChoice).toHaveFocus()
    expect(screen.getByRole('textbox', { name: 'Professor' })).toHaveValue('Professor Second')
    await user.keyboard('{Home}')
    expect(firstChoice).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Remove supervisor: Professor First' }))
    rerender(<ApplicationProfessorsPanel value={{ professor: first }} onChange={changed} />)
    expect(screen.queryByRole('group', { name: /Confirm delete:/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove supervisor:/ })).not.toBeInTheDocument()
    expect(changed).not.toHaveBeenCalled()
    rerender(<ApplicationProfessorsPanel value={{ professor: first, additionalProfessors: [second] }} onChange={changed} />)
    expect(screen.queryByRole('group', { name: /Confirm delete:/ })).not.toBeInTheDocument()
  })

  it('scrolls the supervisor rail for overflow controls and a newly added selection while keeping input focus', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [value, setValue] = useState<ProfessorApplication>({ professor: first, additionalProfessors: [second] })
      return <ApplicationProfessorsPanel value={value} onChange={setValue} createMode />
    }
    render(<Harness />)
    const rail = screen.getByRole('group', { name: 'Intended supervisors' })
    const scroll = vi.fn()
    Object.defineProperty(rail, 'scrollBy', { configurable: true, value: scroll })
    Object.defineProperty(rail, 'clientWidth', { configurable: true, value: 280 })
    vi.spyOn(rail, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 280 } as DOMRect)
    const firstCard = rail.children[0]
    const secondCard = rail.children[1]
    vi.spyOn(firstCard, 'getBoundingClientRect').mockReturnValue({ left: 2, right: 246 } as DOMRect)
    vi.spyOn(secondCard, 'getBoundingClientRect').mockReturnValue({ left: 254, right: 498 } as DOMRect)
    fireEvent.scroll(rail)
    await user.click(await screen.findByRole('button', { name: 'Scroll supervisors right' }))
    expect(scroll).toHaveBeenLastCalledWith({ left: 224, behavior: 'auto' })
    await user.click(screen.getByRole('button', { name: 'Professor Second second@example.edu' }))
    expect(scroll).toHaveBeenLastCalledWith({ left: 222, behavior: 'auto' })
    await user.click(screen.getByRole('button', { name: 'Add supervisor' }))
    expect(screen.getByRole('textbox', { name: 'Professor' })).toHaveFocus()
    expect(screen.getByRole('textbox', { name: 'Professor' })).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Supervisor details' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('uses the matched alias identity and keeps removed or unknown senders distinct', () => {
    const application = { professor: first, additionalProfessors: [second] }
    const item = { id: 'mail', channel: 'Email', direction: 'incoming', from: 'Second <LAB@example.edu>', to: 'student@example.com', messageType: 'fetched-email' } as ApplicationRecord['communications'][number]
    const account = { name: 'Student', email: 'student@example.com' }
    expect(correspondenceAvatarIdentity(item, application, account).name).toBe('Professor Second')
    const removed = correspondenceAvatarIdentity(item, { ...application, additionalProfessors: [] }, account)
    expect(removed.name).not.toBe('Professor First')
    expect(removed.displayEmail).toBe('lab@example.edu')
  })
})
