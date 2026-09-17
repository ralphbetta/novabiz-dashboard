import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

export interface SelectOption<T extends string | number> {
  value: T
  label: string
}

export interface SelectProps<T extends string | number> {
  label: string
  value: T
  options: readonly SelectOption<T>[]
  onChange: (value: T) => void
  /** Wrapper classes, e.g. a width, or `flex items-center gap-2` for a label beside the trigger. */
  className?: string
  labelClassName?: string
  triggerClassName?: string
  /** For forms: marks the value invalid, and links the trigger to the element describing the error. */
  invalid?: boolean
  describedBy?: string | undefined
  /** Called when focus leaves the trigger with the list closed. Form libraries validate here. */
  onBlur?: () => void
  /** The focusable trigger, so a form can move focus to this field when it is invalid. */
  triggerRef?: Ref<HTMLDivElement>
}

const LIST_MAX_HEIGHT = 288
const GAP = 4
const TYPEAHEAD_RESET_MS = 500
const PAGE_JUMP = 10

/**
 * A custom single-select dropdown, replacing the native <select> so the menu matches the app on every platform.
 *
 * Built to the WAI-ARIA Authoring Practices "select-only combobox" pattern, because giving up the native element
 * must not cost keyboard or screen-reader users anything (ADR-0012):
 *   - focus stays on the trigger (role="combobox"); the highlighted option is conveyed by aria-activedescendant;
 *   - closed: ↓ ↑ Enter Space open it; Home/End open on the first/last option; typing jumps to a matching option;
 *   - open: ↓ ↑ Home End PageUp PageDown move; Enter or Space chooses; Escape closes without changing the value;
 *     Tab chooses the highlighted option and moves on; typing jumps by label;
 *   - pointer: clicking outside closes it.
 *
 * The list is rendered in a portal (into the nearest landmark) with fixed positioning, so an `overflow: hidden`
 * card cannot clip it, and it
 * opens upward when there is not enough room below — the rows-per-page menu sits at the bottom of the table.
 */
export function Select<T extends string | number>({
  label,
  value,
  options,
  onChange,
  className = '',
  labelClassName = 'mb-1 block text-xs font-medium text-fg-muted',
  triggerClassName = 'w-full',
  invalid = false,
  describedBy,
  onBlur,
  triggerRef: externalTriggerRef,
}: SelectProps<T>) {
  const id = useId()
  const labelId = `${id}-label`
  const listId = `${id}-listbox`
  const optionId = (index: number) => `${id}-option-${index}`

  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value))
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(selectedIndex)
  const [position, setPosition] = useState<CSSProperties>({ position: 'fixed', visibility: 'hidden' })
  /** Where the list is portalled: the trigger's landmark or dialog. Resolved on open, never during render. */
  const [portalTarget, setPortalTarget] = useState<Element | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const typeahead = useRef<{ text: string; timer: ReturnType<typeof setTimeout> | undefined }>({ text: '', timer: undefined })
  const last = options.length - 1
  useImperativeHandle(externalTriggerRef, () => triggerRef.current as HTMLDivElement, [])

  const openAt = (index: number) => {
    // The trigger's own landmark or dialog keeps the list inside a landmark, and inside a modal dialog's top layer.
    setPortalTarget(triggerRef.current?.closest('main, dialog, [role="dialog"]') ?? document.body)
    setActiveIndex(Math.min(last, Math.max(0, index)))
    setOpen(true)
  }
  const close = () => {
    setOpen(false)
    // A fresh search next time: otherwise letters typed just before choosing would prefix the next search.
    clearTimeout(typeahead.current.timer)
    typeahead.current.text = ''
  }
  const choose = (index: number) => {
    const option = options[index]
    if (option && option.value !== value) onChange(option.value)
    close()
  }

  /** The index of the next option whose label starts with what has been typed, or null. */
  const findByTypeahead = (key: string, from: number): number | null => {
    const state = typeahead.current
    clearTimeout(state.timer)
    state.text += key.toLowerCase()
    state.timer = setTimeout(() => { state.text = '' }, TYPEAHEAD_RESET_MS)
    // The same letter typed repeatedly ("l", "l") means "next option starting with l", so it cycles through the
    // matches; a longer search ("pen") refines the current one. Both follow the WAI-ARIA pattern.
    const repeatedLetter = [...state.text].every((c) => c === state.text[0])
    const search = repeatedLetter ? state.text.charAt(0) : state.text
    const start = repeatedLetter ? from + 1 : from
    for (let offset = 0; offset < options.length; offset++) {
      const index = (start + offset) % options.length
      if (options[index]?.label.toLowerCase().startsWith(search)) return index
    }
    return null
  }

  const isPrintable = (event: KeyboardEvent) => event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault()
        openAt(selectedIndex)
      } else if (event.key === 'Home') {
        event.preventDefault()
        openAt(0)
      } else if (event.key === 'End') {
        event.preventDefault()
        openAt(last)
      } else if (isPrintable(event)) {
        openAt(findByTypeahead(event.key, selectedIndex) ?? selectedIndex)
      }
      return
    }

    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); setActiveIndex((i) => Math.min(last, i + 1)); break
      case 'ArrowUp': event.preventDefault(); setActiveIndex((i) => Math.max(0, i - 1)); break
      case 'Home': event.preventDefault(); setActiveIndex(0); break
      case 'End': event.preventDefault(); setActiveIndex(last); break
      case 'PageDown': event.preventDefault(); setActiveIndex((i) => Math.min(last, i + PAGE_JUMP)); break
      case 'PageUp': event.preventDefault(); setActiveIndex((i) => Math.max(0, i - PAGE_JUMP)); break
      case 'Enter':
      case ' ':
        event.preventDefault()
        choose(activeIndex)
        break
      case 'Escape':
        // Do not let Escape also close a surrounding dialog.
        event.preventDefault()
        event.stopPropagation()
        close()
        break
      case 'Tab':
        choose(activeIndex) // not prevented: focus moves on as usual
        break
      default:
        if (isPrintable(event)) {
          const match = findByTypeahead(event.key, activeIndex)
          if (match !== null) setActiveIndex(match)
        }
    }
  }

  // Place the list against the trigger; flip upward when there is not room below. Kept in sync on scroll and resize.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const trigger = triggerRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const listHeight = Math.min(LIST_MAX_HEIGHT, listRef.current?.scrollHeight ?? LIST_MAX_HEIGHT)
      const spaceBelow = window.innerHeight - rect.bottom
      const openUpward = spaceBelow < listHeight + GAP * 2 && rect.top > spaceBelow
      const width = Math.max(rect.width, 160)
      setPosition({
        position: 'fixed',
        left: Math.max(GAP, Math.min(rect.left, window.innerWidth - width - GAP)),
        width,
        ...(openUpward ? { bottom: window.innerHeight - rect.top + GAP } : { top: rect.bottom + GAP }),
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || listRef.current?.contains(target)) return
      close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  // Keep the highlighted option in view while moving through a long list.
  useEffect(() => {
    if (open) document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [open, activeIndex, id])

  useEffect(() => () => clearTimeout(typeahead.current.timer), [])

  return (
    <div className={className}>
      <span id={labelId} className={labelClassName}>{label}</span>
      <div
        ref={triggerRef}
        role="combobox"
        tabIndex={0}
        aria-labelledby={labelId}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onBlur={() => { if (!open) onBlur?.() }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(activeIndex) : undefined}
        onClick={() => (open ? close() : openAt(selectedIndex))}
        onKeyDown={onKeyDown}
        className={`flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-xl border bg-surface px-3 text-left text-sm text-fg select-none ${open ? 'border-accent' : invalid ? 'border-danger' : 'border-border-control hover:border-border-strong'} ${triggerClassName}`}
      >
        <span className="truncate">{options[selectedIndex]?.label}</span>
        <Icon name="chevron-down" className={`size-4 text-fg-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </div>

      {open && portalTarget
        ? createPortal(
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              aria-labelledby={labelId}
              style={position}
              className="z-50 max-h-72 overflow-auto rounded-xl border border-border bg-surface p-1 shadow-lg"
            >
              {options.map((option, index) => {
                const selected = index === selectedIndex
                const active = index === activeIndex
                return (
                  <li
                    key={String(option.value)}
                    id={optionId(index)}
                    role="option"
                    aria-selected={selected}
                    onPointerMove={() => setActiveIndex(index)}
                    onClick={() => choose(index)}
                    className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm ${active ? 'bg-surface-muted' : ''} ${selected ? 'font-semibold text-fg' : 'text-fg'}`}
                  >
                    <Icon name="check" className={`size-4 text-accent ${selected ? '' : 'invisible'}`} />
                    {option.label}
                  </li>
                )
              })}
            </ul>,
            // Fixed positioning still escapes any overflow-hidden card between the trigger and this target.
            portalTarget,
          )
        : null}
    </div>
  )
}
