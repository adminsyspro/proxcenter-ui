// Ctrl/Cmd+click picks guests in the inventory tree for a power action
// (roadmap#197). The tree renders its guests in two shapes: the flat lists
// (VmItem, `data-vmkey`) and the MUI tree items, whose DOM id ends with their
// itemId `vm:<connId>:<node>:<type>:<vmid>`. Both lead back to the same key,
// `<connId>:<node>:<type>:<vmid>`.

const TREE_GUEST_MARK = '-vm:'

/** The guest key of the row an event happened in, or null outside a guest row. */
export function guestKeyFromTarget(target: EventTarget | null): string | null {
  if (!target || typeof (target as Element).closest !== 'function') return null
  const el = target as Element
  const flat = el.closest('[data-vmkey]')

  if (flat) return flat.getAttribute('data-vmkey') || null

  const id = el.closest('[role="treeitem"]')?.id ?? ''
  const at = id.indexOf(TREE_GUEST_MARK)

  return at >= 0 ? id.slice(at + TREE_GUEST_MARK.length) || null : null
}

export function togglePick(picked: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(picked)

  if (next.has(key)) next.delete(key)
  else next.add(key)

  return next
}

const cssValue = (key: string) => key.replaceAll('\\', '\\\\').replaceAll('"', '\\"')

/** sx rules that tint the picked rows, in both shapes. */
export function pickedRowsSx(picked: ReadonlySet<string>): Record<string, { bgcolor: string }> {
  const sx: Record<string, { bgcolor: string }> = {}

  for (const key of picked) {
    sx[`& [data-vmkey="${cssValue(key)}"], & [id$="${TREE_GUEST_MARK}${cssValue(key)}"] > .MuiTreeItem-content`] = { bgcolor: 'action.selected' }
  }

  return sx
}
