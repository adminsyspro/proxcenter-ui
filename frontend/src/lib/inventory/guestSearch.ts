// Search and sort helpers shared by the inventory guest lists (#937): the tree
// filter, the flat list filter and the Tags column of the VMs table.

/** Tags as PVE lists them (`a;b`) or as the table rows carry them (`['a', 'b']`). */
export type GuestTags = string | string[] | null | undefined

export function guestTagList(tags: GuestTags): string[] {
  if (!tags) return []
  const list = Array.isArray(tags) ? tags : String(tags).split(';')

  return list.map(t => String(t).trim()).filter(Boolean)
}

export type SearchableGuest = {
  name?: string | null
  vmid?: string | number | null
  type?: string | null
  tags?: GuestTags
}

/**
 * Whether a guest matches a query on its name, vmid, type or any of its tags.
 * `q` is expected trimmed and lowercased, as the inventory search box keeps it;
 * an empty query matches everything.
 */
export function guestMatchesSearch(vm: SearchableGuest, q: string): boolean {
  if (!q) return true
  if ([vm.name, vm.vmid, vm.type].some(f => f != null && String(f).toLowerCase().includes(q))) return true

  return guestTagList(vm.tags).some(t => t.toLowerCase().includes(q))
}

/**
 * The value the Tags column sorts on. The DataGrid used to sort the raw array,
 * which compares references and orders nothing. The tags are joined as they
 * are displayed, lowercased so the order ignores case; no tags gives ''.
 */
export function tagsSortValue(tags: GuestTags): string {
  return guestTagList(tags).join(', ').toLowerCase()
}
