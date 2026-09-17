/**
 * The mock banks' account directory: who holds an account number at a bank (ADR-0018).
 *
 * A real app asks NIBSS for a name enquiry. Here every well-formed account resolves to a stable, made-up holder
 * derived from the bank and the number, so any number a reviewer types gives a believable, repeatable name — except
 * numbers starting 999, which do not exist, so "no account found" can be shown on demand.
 */
import { createRng } from './prng'
import { FIRST_NAMES, LAST_NAMES, SUPPLIERS } from './seed'

/** Account numbers with this prefix are not found at any bank. Documented in the README for demos. */
export const UNKNOWN_ACCOUNT_PREFIX = '999'

/** Fixed holders, for tests and the seeded beneficiaries. Keyed `bankCode:accountNumber`. */
export const KNOWN_ACCOUNTS: Readonly<Record<string, string>> = {
  '058:0123456789': 'Ngozi Okafor',
  '044:0987654321': 'Oyingbo Foodstuff Traders',
  '011:2034567810': 'Kano Grains Depot',
  '057:1122334455': 'Emeka Nwosu',
  '033:2211334455': 'Aba Textile Hub',
  '070:6677889900': 'Folake Adeyemi',
}

/** FNV-1a: a small, stable string hash to seed the name generator. */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** The holder's name, or null when no such account exists. Deterministic: the same inputs always give the same name. */
export function accountHolder(bankCode: string, accountNumber: string): string | null {
  if (accountNumber.startsWith(UNKNOWN_ACCOUNT_PREFIX)) return null
  const known = KNOWN_ACCOUNTS[`${bankCode}:${accountNumber}`]
  if (known) return known
  const rng = createRng(hash(`${bankCode}:${accountNumber}`))
  // Roughly one account in four belongs to a business, as a merchant's payees often do.
  return rng.chance(0.25) ? rng.pick(SUPPLIERS) : `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`
}
