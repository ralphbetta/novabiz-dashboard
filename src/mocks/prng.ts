/**
 * A small seeded PRNG (mulberry32). Deterministic seed data means screenshots, tests and the
 * interview demo all see the same transactions. Not cryptographic, and never used for anything
 * that needs to be: real idempotency keys come from crypto.randomUUID().
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number
  /** Uniform integer in [min, max], inclusive. */
  int(min: number, max: number): number
  /** True with probability p. */
  chance(p: number): boolean
  pick<T>(items: readonly T[]): T
  hex(length: number): string
  digits(length: number): string
  /** A UUID-v4-shaped string, deterministic from the seed. */
  uuid(): string
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1))

  const fromAlphabet = (alphabet: string, length: number): string => {
    let out = ''
    for (let i = 0; i < length; i++) out += alphabet.charAt(int(0, alphabet.length - 1))
    return out
  }

  return {
    next,
    int,
    chance: (p) => next() < p,
    pick: <T>(items: readonly T[]): T => {
      const item = items[int(0, items.length - 1)]
      if (item === undefined) throw new Error('pick() called with an empty list')
      return item
    },
    hex: (length) => fromAlphabet('0123456789abcdef', length),
    digits: (length) => fromAlphabet('0123456789', length),
    uuid: () => {
      const h = (n: number) => fromAlphabet('0123456789abcdef', n)
      return `${h(8)}-${h(4)}-4${h(3)}-${'89ab'.charAt(int(0, 3))}${h(3)}-${h(12)}`
    },
  }
}
