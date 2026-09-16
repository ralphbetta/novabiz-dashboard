// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { AnnouncerProvider } from './Announcer'
import { useAnnounce } from './announcerContext'

/** Sends the given announcements in one event handler, i.e. within the same few milliseconds. */
function Trigger({ messages }: { messages: [string, 'polite' | 'assertive'][] }) {
  const announce = useAnnounce()
  return <button type="button" onClick={() => messages.forEach(([m, p]) => announce(m, p))}>Announce</button>
}

const renderWith = (messages: [string, 'polite' | 'assertive'][]) =>
  render(<AnnouncerProvider><Trigger messages={messages} /></AnnouncerProvider>)

afterEach(() => { vi.useRealTimers() })

describe('AnnouncerProvider', () => {
  it('renders both live regions empty from the first render', () => {
    renderWith([])
    expect(screen.getByTestId('announcer-polite')).toBeEmptyDOMElement()
    expect(screen.getByTestId('announcer-assertive')).toBeEmptyDOMElement()
  })

  it('review finding: a polite and an assertive message within 50ms are BOTH announced', () => {
    vi.useFakeTimers()
    renderWith([['50 transactions found', 'polite'], ['Transfer failed', 'assertive']])
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Announce' }))
      vi.advanceTimersByTime(100)
    })
    expect(screen.getByTestId('announcer-polite')).toHaveTextContent('50 transactions found')
    expect(screen.getByTestId('announcer-assertive')).toHaveTextContent('Transfer failed')
  })

  it('a newer message in the SAME region replaces the older one', () => {
    vi.useFakeTimers()
    renderWith([['Page 1', 'polite'], ['Page 2', 'polite']])
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Announce' }))
      vi.advanceTimersByTime(100)
    })
    expect(screen.getByTestId('announcer-polite')).toHaveTextContent('Page 2')
  })
})
