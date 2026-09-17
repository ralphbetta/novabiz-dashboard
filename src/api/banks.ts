/**
 * The banks a merchant can send to, shared by the Send Money form and the mock server, so both accept exactly the
 * same codes.
 *
 * Illustrative list with CBN institution codes. A real app would load this from the bank's API; it is static here
 * because there is no real backend (ADR-0015). Verify against a current NIBSS list before any real use.
 */
export const BANKS = [
  { code: '011', name: 'First Bank of Nigeria', shortName: 'FirstBank' },
  { code: '044', name: 'Access Bank', shortName: 'Access' },
  { code: '058', name: 'Guaranty Trust Bank', shortName: 'GTBank' },
  { code: '033', name: 'United Bank for Africa', shortName: 'UBA' },
  { code: '057', name: 'Zenith Bank', shortName: 'Zenith' },
  { code: '070', name: 'Fidelity Bank', shortName: 'Fidelity' },
  { code: '232', name: 'Sterling Bank', shortName: 'Sterling' },
  { code: '035', name: 'Wema Bank', shortName: 'Wema' },
] as const

export type Bank = (typeof BANKS)[number]

export function bankByCode(code: string): Bank | undefined {
  return BANKS.find((bank) => bank.code === code)
}
