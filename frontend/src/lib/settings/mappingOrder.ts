// src/lib/settings/mappingOrder.ts
// Row reordering for the SSO group-to-role mapping forms (issue #992).
//
// Kept out of the tab components so the LDAP and OIDC forms share one
// implementation, and so the rule that decides which role a user ends up with
// can be tested without rendering a form.

/**
 * Move the row at `index` by `delta` positions, returning a NEW array. A move
 * that would leave the list (the first row up, the last row down) returns the
 * original array untouched, so a caller can bind the buttons unconditionally.
 */
export function moveMappingRow<T>(rows: readonly T[], index: number, delta: number): T[] {
  const target = index + delta
  if (index < 0 || index >= rows.length) return rows as T[]
  if (target < 0 || target >= rows.length) return rows as T[]

  const next = [...rows]
  const [row] = next.splice(index, 1)
  next.splice(target, 0, row)
  return next
}
