/** One page of `items`, the page clamped to the last one when the list shrank. */
export function pageOf<T>(items: T[], page: number, perPage: number): { rows: T[]; page: number } {
  const last = Math.max(0, Math.ceil(items.length / perPage) - 1)
  const p = Math.min(Math.max(0, page), last)
  return { rows: items.slice(p * perPage, (p + 1) * perPage), page: p }
}
