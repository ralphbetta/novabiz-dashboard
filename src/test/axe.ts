import axe from 'axe-core'

/**
 * Runs axe-core on an element and returns its violations, summarised for a readable test failure.
 * Colour contrast is excluded: jsdom does no layout or painting, so axe cannot compute it there. Contrast is
 * checked against the design tokens directly instead.
 */
export async function axeViolations(element: Element): Promise<string[]> {
  const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } })
  return results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'})`)
}
