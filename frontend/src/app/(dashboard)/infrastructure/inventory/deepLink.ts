/**
 * Deep-links into the inventory: `?selectType=<kind>&selectId=<id>`, produced by
 * the topology sidebar, the command palette and four dashboard widgets.
 *
 * These three kinds select synchronously — they need no VM list — so the page's
 * RBAC effect must not reset the selection to the tree root underneath them.
 * It otherwise does exactly that whenever the RBAC context settles last, which
 * is every cold page load: a pasted link, a new tab, a refresh.
 */

const SELECTABLE_KINDS = new Set(['node', 'cluster', 'pbs'])

export function hasDeepLinkSelection(params: { get(key: string): string | null }): boolean {
  const selectType = params.get('selectType')
  const selectId = params.get('selectId')

  // An incomplete or unknown pair selects nothing, so the default view should
  // still apply rather than leaving the page on an empty selection.
  return !!selectType && !!selectId && SELECTABLE_KINDS.has(selectType)
}
