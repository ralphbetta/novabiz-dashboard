// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { makeStore } from '.'
import { selectOnline, watchConnection } from './connectivitySlice'
import { THEME_STORAGE_KEY, applyTheme, persistThemePreference, preferences, readThemePreference, resolveTheme } from './preferencesSlice'

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial))
  return {
    get length() { return data.size },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => { data.delete(key) },
    setItem: (key, value) => { data.set(key, value) },
  }
}

function fakeMediaQuery(matches: boolean) {
  const listeners = new Set<() => void>()
  return {
    matches,
    addEventListener: (_: 'change', listener: () => void) => { listeners.add(listener) },
    removeEventListener: (_: 'change', listener: () => void) => { listeners.delete(listener) },
    change(next: boolean) { this.matches = next; for (const listener of listeners) listener() },
  }
}

describe('watchConnection', () => {
  it('records the connection at once and on every online and offline event', () => {
    const store = makeStore()
    const target = new EventTarget() as EventTarget & { navigator: { onLine: boolean } }
    target.navigator = { onLine: false }
    const stop = watchConnection(store.dispatch, target)
    expect(selectOnline(store.getState())).toBe(false)

    target.navigator.onLine = true
    target.dispatchEvent(new Event('online'))
    expect(selectOnline(store.getState())).toBe(true)

    target.navigator.onLine = false
    target.dispatchEvent(new Event('offline'))
    expect(selectOnline(store.getState())).toBe(false)

    stop()
    target.navigator.onLine = true
    target.dispatchEvent(new Event('online'))
    expect(selectOnline(store.getState())).toBe(false)
  })
})

describe('theme preference', () => {
  it('reads only a valid saved value, and falls back to following the phone', () => {
    expect(readThemePreference(memoryStorage({ [THEME_STORAGE_KEY]: 'dark' }))).toBe('dark')
    expect(readThemePreference(memoryStorage({ [THEME_STORAGE_KEY]: 'light' }))).toBe('light')
    expect(readThemePreference(memoryStorage({ [THEME_STORAGE_KEY]: '<script>' }))).toBe('system')
    expect(readThemePreference(memoryStorage())).toBe('system')
    expect(readThemePreference(undefined)).toBe('system')
    const throwing = { ...memoryStorage(), getItem: () => { throw new Error('blocked') } }
    expect(readThemePreference(throwing)).toBe('system')
  })

  it('resolves "system" from the phone’s setting, and a chosen theme regardless of it', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('saves a chosen theme, and removes the key when it goes back to following the phone', () => {
    const store = makeStore()
    const storage = memoryStorage()
    persistThemePreference(store, storage)
    store.dispatch(preferences.themeChosen({ theme: 'dark' }))
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    store.dispatch(preferences.themeChosen({ theme: 'system' }))
    expect(storage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })

  it('survives storage that refuses writes', () => {
    const store = makeStore()
    persistThemePreference(store, { ...memoryStorage(), setItem: () => { throw new Error('quota') } })
    expect(() => store.dispatch(preferences.themeChosen({ theme: 'dark' }))).not.toThrow()
    expect(store.getState().preferences.theme).toBe('dark')
  })

  it('puts the dark class on the page for the preference, and follows the phone while on "system"', () => {
    const store = makeStore()
    const root = document.createElement('html')
    const media = fakeMediaQuery(false)
    const stop = applyTheme(store, root, media)
    expect(root.classList.contains('dark')).toBe(false)

    media.change(true)
    expect(root.classList.contains('dark')).toBe(true)

    store.dispatch(preferences.themeChosen({ theme: 'light' }))
    expect(root.classList.contains('dark')).toBe(false)
    media.change(true)
    expect(root.classList.contains('dark')).toBe(false) // a chosen theme ignores the phone

    store.dispatch(preferences.themeChosen({ theme: 'dark' }))
    expect(root.classList.contains('dark')).toBe(true)
    stop()
    store.dispatch(preferences.themeChosen({ theme: 'light' }))
    expect(root.classList.contains('dark')).toBe(true)
  })
})
