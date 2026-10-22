// Client-safe: no server import, the inventory and the Create VM wizard use it.

/** A tenant's vDCs open to blank VMs (#1171). A vDC context, when it names
 *  one of the tenant's active vDCs, narrows the list to it: the inventory
 *  offers Create VM, and the wizard places the VM, in that vDC only. */
export function blankVmVdcs<T extends { id: string; enabled?: boolean | null; allowBlankVms?: boolean; connectionId?: string; connection_id?: string }>(
  vdcs: T[],
  contextVdcId: string | null,
): T[] {
  const active = vdcs.filter(v => (v.connectionId ?? v.connection_id) && v.enabled !== false)
  const inContext = contextVdcId && active.some(v => v.id === contextVdcId)
    ? active.filter(v => v.id === contextVdcId)
    : active
  return inContext.filter(v => v.allowBlankVms === true)
}
