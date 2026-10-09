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

type LinkableVm = { connId: string; node: string; vmid: string | number }

/**
 * The guest a `?vmid=<id>&connId=<conn>&node=<node>` link points at. A vmid is
 * only unique within a cluster, so a link that names its cluster never opens a
 * guest of another one: the node may be stale (the guest migrated), the cluster
 * may not be loaded yet, in which case nothing is found and the caller retries
 * once more of the inventory has arrived. A link without a cluster keeps the
 * first guest carrying the vmid.
 */
export function findDeepLinkedVm<T extends LinkableVm>(
  vms: T[],
  params: { get(key: string): string | null },
): T | undefined {
  const vmid = params.get('vmid')

  if (!vmid) return undefined
  const connId = params.get('connId')
  const node = params.get('node')
  const candidates = vms.filter(vm => String(vm.vmid) === vmid && (!connId || vm.connId === connId))

  return candidates.find(vm => !node || vm.node === node) ?? candidates[0]
}
