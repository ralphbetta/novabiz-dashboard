// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Select, type SelectOption } from './Select'
import { axeViolations } from '../../test/axe'

const STATUSES: SelectOption<string>[] = [
  { value: '', label: 'All statuses' },
  { value: 'successful', label: 'Successful' },
  { value: 'pending', label: 'Pending' },
  { value: 'failed', label: 'Failed' },
]

function Harness({ onChange = () => {} }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState('')
  // Inside <main>, as in the app: axe's region rule expects page content within landmarks.
  return (
    <main>
      <Select label="Status" value={value} options={STATUSES} onChange={(v) => { setValue(v); onChange(v) }} />
      <button type="button">After</button>
    </main>
  )
}

const setup = (onChange?: (value: string) => void) => {
  const user = userEvent.setup()
  render(<Harness {...(onChange ? { onChange } : {})} />)
  const combobox = screen.getByRole('combobox', { name: 'Status' })
  return { user, combobox }
}

describe('Select — semantics', () => {
  it('is a combobox named by its visible label, showing the selected option', () => {
    const { combobox } = setup()
    expect(combobox).toHaveTextContent('All statuses')
    expect(combobox).toHaveAttribute('aria-expanded', 'false')
    expect(combobox).toHaveAttribute('aria-haspopup', 'listbox')
  })

  it('has no axe violations, closed or open', async () => {
    const { user, combobox } = setup()
    expect(await axeViolations(document.body)).toEqual([])
    await user.click(combobox)
    expect(await axeViolations(document.body)).toEqual([])
  })

  it('open: exposes a named listbox, the selected option, and the highlighted option via aria-activedescendant', async () => {
    const { user, combobox } = setup()
    await user.click(combobox)
    const listbox = screen.getByRole('listbox', { name: 'Status' })
    expect(combobox).toHaveAttribute('aria-expanded', 'true')
    expect(combobox).toHaveAttribute('aria-controls', listbox.id)
    expect(screen.getByRole('option', { name: 'All statuses' })).toHaveAttribute('aria-selected', 'true')
    expect(combobox.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'All statuses' }).id)
  })
})

describe('Select — keyboard (WAI-ARIA select-only combobox)', () => {
  it('is reachable with Tab', async () => {
    const { user, combobox } = setup()
    await user.tab()
    expect(combobox).toHaveFocus()
  })

  it.each(['{ArrowDown}', '{ArrowUp}', '{Enter}', ' '])('opens with %s', async (key) => {
    const { user, combobox } = setup()
    combobox.focus()
    await user.keyboard(key)
    expect(combobox).toHaveAttribute('aria-expanded', 'true')
  })

  it('moves with the arrow keys and chooses with Enter, keeping focus on the trigger', async () => {
    const onChange = vi.fn()
    const { user, combobox } = setup(onChange)
    combobox.focus()
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenCalledWith('pending')
    expect(combobox).toHaveTextContent('Pending')
    expect(combobox).toHaveAttribute('aria-expanded', 'false')
    expect(combobox).toHaveFocus()
  })

  it('does not move past the first or last option', async () => {
    const onChange = vi.fn()
    const { user, combobox } = setup(onChange)
    combobox.focus()
    await user.keyboard('{ArrowDown}{ArrowUp}{ArrowUp}{Enter}')
    expect(onChange).not.toHaveBeenCalled() // still on the already-selected first option
    await user.keyboard('{End}{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenLastCalledWith('failed')
  })

  it('Home and End jump to the first and last option', async () => {
    const onChange = vi.fn()
    const { user, combobox } = setup(onChange)
    combobox.focus()
    await user.keyboard('{End}{Enter}')
    expect(onChange).toHaveBeenLastCalledWith('failed')
    await user.keyboard('{Home}{Enter}')
    expect(onChange).toHaveBeenLastCalledWith('')
  })

  it('Escape closes without changing the value', async () => {
    const onChange = vi.fn()
    const { user, combobox } = setup(onChange)
    combobox.focus()
    await user.keyboard('{ArrowDown}{ArrowDown}{Escape}')
    expect(combobox).toHaveAttribute('aria-expanded', 'false')
    expect(combobox).toHaveTextContent('All statuses')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Tab chooses the highlighted option and moves focus on', async () => {
    const onChange = vi.fn()
    const { user, combobox } = setup(onChange)
    combobox.focus()
    await user.keyboard('{ArrowDown}{ArrowDown}')
    await user.tab()
    expect(onChange).toHaveBeenCalledWith('successful')
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus()
  })

  it('typing jumps to the option whose label starts with the typed text', async () => {
    const onChange = vi.fn()
    const { user, combobox } = setup(onChange)
    combobox.focus()
    await user.keyboard('{ArrowDown}pen{Enter}')
    expect(onChange).toHaveBeenLastCalledWith('pending')
  })

  it('starts a fresh search after choosing — letters typed before do not prefix the next search', async () => {
    // Regression: the type-ahead buffer outlived the list, so "f" then "pen" searched for "fpen" and matched nothing.
    const onChange = vi.fn()
    const { user, combobox } = setup(onChange)
    combobox.focus()
    await user.keyboard('f{Enter}')
    expect(onChange).toHaveBeenLastCalledWith('failed')
    await user.keyboard('{ArrowDown}pen{Enter}')
    expect(onChange).toHaveBeenLastCalledWith('pending')
  })

  it('repeating a letter cycles through the options that start with it', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    const DATES: SelectOption<string>[] = [
      { value: 'all', label: 'All time' },
      { value: '7d', label: 'Last 7 days' },
      { value: '30d', label: 'Last 30 days' },
    ]
    render(<main><Select label="Date" value="all" options={DATES} onChange={onChange} /></main>)
    screen.getByRole('combobox', { name: 'Date' }).focus()
    await user.keyboard('{ArrowDown}')
    await user.keyboard('l')
    await user.keyboard('l')
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenLastCalledWith('30d')
  })
})

describe('Select — pointer', () => {
  it('chooses an option by clicking it', async () => {
    const onChange = vi.fn()
    const { user, combobox } = setup(onChange)
    await user.click(combobox)
    await user.click(screen.getByRole('option', { name: 'Failed' }))
    expect(onChange).toHaveBeenCalledWith('failed')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('closes when clicking outside, without changing the value', async () => {
    const onChange = vi.fn()
    const { user, combobox } = setup(onChange)
    await user.click(combobox)
    await user.click(document.body)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('clicking the trigger again closes it', async () => {
    const { user, combobox } = setup()
    await user.click(combobox)
    await user.click(combobox)
    expect(combobox).toHaveAttribute('aria-expanded', 'false')
  })
})
