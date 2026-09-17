/**
 * Keeps the Mock API panel's network settings across reloads, so a demo set up once stays set up.
 *
 * Only the settings — delay, rates. A forced outcome ("the next transfer will time out") is not kept: it is meant for
 * the next transfer made now, and firing it after a reload would surprise. Saved values are untrusted input and are
 * validated; anything invalid is ignored.
 */
import { ChaosSettingsSchema, createChaosController, type ChaosController } from './chaos'

export const CHAOS_SETTINGS_STORAGE_KEY = 'novabiz.chaosSettings'

export function loadChaosSettings(storage: Storage | undefined) {
  try {
    const raw = storage?.getItem(CHAOS_SETTINGS_STORAGE_KEY)
    if (!raw) return null
    const parsed = ChaosSettingsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Saves the settings whenever they change. Returns a function that stops saving. */
export function persistChaosSettings(chaos: ChaosController, storage: Storage | undefined): () => void {
  let last = JSON.stringify(chaos.getSettings())
  return chaos.subscribe(() => {
    const json = JSON.stringify(chaos.getSettings())
    if (json === last) return
    last = json
    try {
      storage?.setItem(CHAOS_SETTINGS_STORAGE_KEY, json)
    } catch {
      // Private mode or a full quota: the settings last until the page reloads.
    }
  })
}

/**
 * The browser's controller: created with the defaults, then set to the saved settings, then saved on every change.
 * Created from the defaults rather than with the saved settings as its starting point, so `reset()` — used by the
 * console and Playwright — still means "a normal server", not "whatever was saved last time".
 */
export function createStoredChaosController(storage: Storage | undefined): ChaosController {
  const chaos = createChaosController()
  const saved = loadChaosSettings(storage)
  if (saved) chaos.update(saved)
  persistChaosSettings(chaos, storage)
  return chaos
}
