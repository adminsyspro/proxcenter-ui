/**
 * React keys for a list whose items carry no ID: each item's own key, with an
 * occurrence suffix when two items read the same (a field changed twice in a
 * burst), so the key follows the item rather than its position.
 */
export function withKeys<T>(items: readonly T[], keyOf: (item: T) => string): Array<{ key: string; item: T }> {
  const seen = new Map<string, number>()

  return items.map(item => {
    const base = keyOf(item)
    const n = seen.get(base) ?? 0

    seen.set(base, n + 1)

    return { key: n === 0 ? base : `${base}#${n}`, item }
  })
}

/** A raw config line's key: the field and both of its values */
export const fieldKey = (f: { field?: string; oldValue?: string | null; newValue?: string | null }) =>
  [f.field, f.oldValue, f.newValue].join('\u0000')

/** A described fact's key: its kind and what it is about */
export const factKey = (f: { kind: string; label?: unknown }) => `${f.kind}:${JSON.stringify(f.label ?? null)}`
