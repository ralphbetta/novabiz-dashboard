/**
 * The merchant's display preferences (ADR-0004, ADR-0010): only the theme.
 *
 * `system` follows the phone's light or dark setting and is the default; `light` and `dark` are the merchant's own
 * choice. Saved to localStorage with a small store subscriber, not a persistence library: one field does not need
 * rehydration machinery (ADR-0004).
 */
import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

export type ThemePreference = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

export interface PreferencesState {
  theme: ThemePreference
}

export const THEME_STORAGE_KEY = 'novabiz.theme'

const initialState: PreferencesState = { theme: 'system' }

export const preferencesSlice = createSlice({
  name: 'preferences',
  initialState,
  reducers: {
    themeChosen(state, action: PayloadAction<{ theme: ThemePreference }>) {
      state.theme = action.payload.theme
    },
  },
})

export const preferences = preferencesSlice.actions

const isThemePreference = (value: unknown): value is ThemePreference => value === 'system' || value === 'light' || value === 'dark'

/** The saved preference, or `system` when nothing valid is saved. Stored values are untrusted input. */
export function readThemePreference(storage: Storage | undefined): ThemePreference {
  try {
    const saved = storage?.getItem(THEME_STORAGE_KEY)
    return isThemePreference(saved) ? saved : 'system'
  } catch {
    return 'system'
  }
}

/** The theme to show for a preference, given whether the phone is set to dark. */
export function resolveTheme(preference: ThemePreference, systemDark: boolean): Theme {
  return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference
}

/** The `(prefers-color-scheme: dark)` media query, or the part of it this uses. */
export interface SystemDarkQuery {
  readonly matches: boolean
  addEventListener(type: 'change', listener: () => void): void
  removeEventListener(type: 'change', listener: () => void): void
}

type PreferencesStore = { getState: () => { preferences: PreferencesState }; subscribe: (listener: () => void) => () => void }

/** Saves the preference whenever it changes. `system` is saved by removing the key. Storage failures lose only this. */
export function persistThemePreference(store: PreferencesStore, storage: Storage | undefined): () => void {
  let last = store.getState().preferences.theme
  return store.subscribe(() => {
    const theme = store.getState().preferences.theme
    if (theme === last) return
    last = theme
    try {
      if (theme === 'system') storage?.removeItem(THEME_STORAGE_KEY)
      else storage?.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // Private mode or blocked storage: the choice lasts for this visit.
    }
  })
}

/**
 * Puts the `dark` class on <html> to match the preference, now and whenever the preference or — for `system` — the
 * phone's setting changes. index.html does the same before the first paint, so a dark page does not flash light.
 */
export function applyTheme(
  store: PreferencesStore,
  root: Pick<HTMLElement, 'classList'>,
  systemDark: SystemDarkQuery | undefined,
): () => void {
  let applied: Theme | null = null
  const apply = () => {
    const theme = resolveTheme(store.getState().preferences.theme, systemDark?.matches ?? false)
    if (theme === applied) return // the store changes on every action; the page only when the theme does
    applied = theme
    root.classList.toggle('dark', theme === 'dark')
  }
  apply()
  const unsubscribe = store.subscribe(apply)
  systemDark?.addEventListener('change', apply)
  return () => {
    unsubscribe()
    systemDark?.removeEventListener('change', apply)
  }
}
