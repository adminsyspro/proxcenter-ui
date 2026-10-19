// src/lib/backups/namespaceText.ts
// Pure text helper, safe in client bundles (pbsNamespace.ts is server-only).

/** '' for the root namespace; surrounding slashes and blanks dropped. */
export function normalizeNamespace(ns: unknown): string {
  if (typeof ns !== 'string') return ''
  const value = ns.trim()
  // Index scan rather than a /^\/+|\/+$/ regex: the input comes from the
  // request body and the alternation backtracks on long runs of '/'.
  let start = 0
  let end = value.length
  while (start < end && value[start] === '/') start++
  while (end > start && value[end - 1] === '/') end--
  return value.slice(start, end)
}
