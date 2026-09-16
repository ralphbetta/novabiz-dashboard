/** Rows-per-page options. Up to 1,000, within the API's page limit (ADR-0016). */
export const PAGE_SIZE_OPTIONS = [25, 50, 100, 500, 1000] as const
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number]
