import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { MaterialRecommender } from '../../data/applications'
import { RecommenderCombobox, type RecommenderComboboxOption } from './RecommenderCombobox'

const profiles: RecommenderComboboxOption[] = [
  {
    key: 'profile:ada',
    profileId: 'ada',
    name: 'Prof. Ada Lovelace',
    email: 'ada@cambridge.example',
    phone: '+44 20 0000 0001',
    title: 'Professor',
    institution: 'University of Cambridge',
    relationship: 'Research supervisor',
    notes: 'Research fit: formal methods and programming languages.',
  },
  {
    key: 'profile:grace',
    profileId: 'grace',
    name: 'Prof. Grace Hopper',
    email: '',
    phone: '+1 555 0100',
    title: 'Program Director',
    institution: 'Yale University',
    relationship: 'Course instructor',
  },
]

const labels = {
  namePlaceholder: 'Type or choose a recommender',
  emailPlaceholder: 'Email address',
  phonePlaceholder: 'Phone number',
  nameLabel: 'Recommender name',
  emailLabel: 'Recommender email',
  phoneLabel: 'Recommender phone',
  listLabel: 'Saved recommenders',
  emptyHint: 'No matching saved recommender',
}

function Harness({
  initial,
  options = profiles,
}: {
  initial?: MaterialRecommender
  options?: readonly RecommenderComboboxOption[]
}) {
  const [value, setValue] = useState<MaterialRecommender>(
    initial ?? {
      id: 'slot-1',
      name: '',
      contact: '',
    },
  )

  return (
    <>
      <RecommenderCombobox value={value} options={options} onChange={setValue} {...labels} />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  )
}

describe('RecommenderCombobox', () => {
  it('atomically autofills separate email and phone fields without copying profile notes into the application', async () => {
    const user = userEvent.setup()
    render(
      <Harness
        initial={{
          id: 'slot-1',
          name: '',
          contact: '',
          notes: 'Private note for this application only.',
        }}
      />,
    )

    const name = screen.getByRole('combobox', { name: labels.nameLabel })
    await user.click(name)
    expect(name).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listbox', { name: labels.listLabel })).not.toBeInTheDocument()

    await user.type(name, 'Cambridge')
    expect(screen.getByRole('option', { name: /Ada Lovelace/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Grace Hopper/ })).not.toBeInTheDocument()

    fireEvent.pointerDown(screen.getByRole('option', { name: /Ada Lovelace/ }))
    expect(name).toHaveValue('Prof. Ada Lovelace')
    expect(screen.getByLabelText(labels.emailLabel)).toHaveValue('ada@cambridge.example')
    expect(screen.getByLabelText(labels.phoneLabel)).toHaveValue('+44 20 0000 0001')
    expect(JSON.parse(screen.getByTestId('value').textContent ?? '{}')).toEqual({
      id: 'slot-1',
      name: 'Prof. Ada Lovelace',
      contact: 'ada@cambridge.example',
      email: 'ada@cambridge.example',
      phone: '+44 20 0000 0001',
      profileId: 'ada',
      notes: 'Private note for this application only.',
    })
    expect(name).toHaveAttribute('aria-expanded', 'false')
    await waitFor(() => expect(document.querySelector('.recommender-combobox')).toHaveClass('is-autofilled'))
  })

  it('retains the original profile link through manual name, email, and phone edits', () => {
    const linked: MaterialRecommender = {
      id: 'slot-1',
      name: 'Prof. Ada Lovelace',
      contact: 'ada@cambridge.example',
      email: 'ada@cambridge.example',
      phone: '+44 20 0000 0001',
      profileId: 'ada',
    }
    const onChange = vi.fn()
    const { rerender } = render(
      <RecommenderCombobox value={linked} options={profiles} onChange={onChange} {...labels} />,
    )

    fireEvent.focus(screen.getByRole('combobox', { name: labels.nameLabel }))
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(labels.emailLabel), {
      target: { value: 'new-address@example.com' },
    })
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: 'slot-1',
        email: 'new-address@example.com',
        phone: '+44 20 0000 0001',
        contact: 'new-address@example.com',
        profileId: 'ada',
      }),
      'input',
    )

    onChange.mockClear()
    rerender(
      <RecommenderCombobox
        value={{ ...linked, contact: 'new-address@example.com', email: 'new-address@example.com' }}
        options={profiles}
        onChange={onChange}
        {...labels}
      />,
    )
    fireEvent.change(screen.getByRole('combobox', { name: labels.nameLabel }), {
      target: { value: 'A free-form referee' },
    })
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: 'slot-1',
        name: 'A free-form referee',
        email: 'new-address@example.com',
        phone: '+44 20 0000 0001',
        profileId: 'ada',
      }),
      'input',
    )

    onChange.mockClear()
    fireEvent.change(screen.getByLabelText(labels.phoneLabel), {
      target: { value: '+44 20 9999 9999' },
    })
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        phone: '+44 20 9999 9999',
        profileId: 'ada',
      }),
      'input',
    )
  })

  it('supports active-descendant keyboard navigation, IME safety, Escape, and ordinary Tab focus', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const name = screen.getByRole('combobox', { name: labels.nameLabel })
    await user.click(name)
    await user.type(name, 'Prof.')
    const firstActiveId = name.getAttribute('aria-activedescendant')
    expect(firstActiveId).toBeTruthy()

    fireEvent.keyDown(name, { key: 'ArrowDown', isComposing: true })
    expect(name).toHaveAttribute('aria-activedescendant', firstActiveId)

    fireEvent.keyDown(name, { key: 'ArrowDown' })
    expect(name.getAttribute('aria-activedescendant')).not.toBe(firstActiveId)
    fireEvent.keyDown(name, { key: 'Enter' })
    expect(name).toHaveValue('Prof. Grace Hopper')
    expect(screen.getByLabelText(labels.emailLabel)).toHaveValue('')
    expect(screen.getByLabelText(labels.phoneLabel)).toHaveValue('+1 555 0100')

    await user.click(name)
    fireEvent.keyDown(name, { key: 'Escape' })
    expect(name).toHaveAttribute('aria-expanded', 'false')

    await user.click(name)
    await user.tab()
    expect(screen.getByLabelText(labels.emailLabel)).toHaveFocus()
    await user.tab()
    expect(screen.getByLabelText(labels.phoneLabel)).toHaveFocus()
    expect(name).toHaveAttribute('aria-expanded', 'false')
  })

  it('exposes native contact semantics and the required identity state without icon-only labels', () => {
    render(
      <RecommenderCombobox
        value={{ id: 'slot-1', name: '', contact: '' }}
        options={profiles}
        onChange={vi.fn()}
        nameRequired
        {...labels}
      />,
    )

    const name = screen.getByRole('combobox', { name: labels.nameLabel })
    const email = screen.getByRole('textbox', { name: labels.emailLabel })
    const phone = screen.getByRole('textbox', { name: labels.phoneLabel })
    expect(name).toBeRequired()
    expect(name).toHaveAttribute('aria-required', 'true')
    expect(email).toHaveAttribute('type', 'email')
    expect(email).toHaveAttribute('autocomplete', 'email')
    expect(phone).toHaveAttribute('type', 'tel')
    expect(phone).toHaveAttribute('autocomplete', 'tel')
  })

  it('keeps the suggestion surface hidden when free-form input has no match', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.type(screen.getByRole('combobox', { name: labels.nameLabel }), 'unmatched person')
    expect(screen.queryByText(labels.emptyHint)).not.toBeInTheDocument()
    expect(screen.queryByRole('listbox', { name: labels.listLabel })).not.toBeInTheDocument()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('autofills an application-derived suggestion without persisting a fake profile link', () => {
    const onChange = vi.fn()
    render(
      <RecommenderCombobox
        value={{ id: 'slot-1', name: '', contact: '' }}
        options={[
          {
            key: 'application:ada@example.edu',
            name: 'Prof. Ada Lovelace',
            email: 'ada@example.edu',
            institution: 'Cambridge',
          },
        ]}
        onChange={onChange}
        {...labels}
      />,
    )

    fireEvent.change(screen.getByRole('combobox', { name: labels.nameLabel }), {
      target: { value: 'Ada' },
    })
    fireEvent.pointerDown(screen.getByRole('option', { name: /Ada Lovelace/ }))

    expect(onChange).toHaveBeenLastCalledWith(
      {
        id: 'slot-1',
        name: 'Prof. Ada Lovelace',
        contact: 'ada@example.edu',
        email: 'ada@example.edu',
        phone: '',
      },
      'selection',
    )
    expect(onChange.mock.calls.at(-1)?.[0]).not.toHaveProperty('profileId')
  })

  it('bounds broad matches and reveals additional options only as the menu is scrolled', async () => {
    const user = userEvent.setup()
    const manyProfiles = Array.from({ length: 386 }, (_, index): RecommenderComboboxOption => ({
      key: `profile:${index + 1}`,
      profileId: `profile-${index + 1}`,
      name: `Recommender ${String(index + 1).padStart(3, '0')}`,
      email: `recommender.${index + 1}@example.edu`,
    }))
    render(<Harness options={manyProfiles} />)

    await user.type(screen.getByRole('combobox', { name: labels.nameLabel }), 'Recommender')
    const listbox = screen.getByRole('listbox', { name: labels.listLabel })
    expect(screen.getAllByRole('option')).toHaveLength(20)
    expect(screen.queryByRole('option', { name: /Recommender 386/ })).not.toBeInTheDocument()

    Object.defineProperties(listbox, {
      clientHeight: { configurable: true, value: 260 },
      scrollHeight: { configurable: true, value: 1040 },
      scrollTop: { configurable: true, value: 780, writable: true },
    })
    fireEvent.scroll(listbox)

    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(40))
    expect(screen.queryByRole('option', { name: /Recommender 386/ })).not.toBeInTheDocument()
  })
})
