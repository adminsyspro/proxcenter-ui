// Shared ordering and option shaping for the guest NIC bridge / VNet pickers
// (NIC add/edit, create VM/CT, template deploy, migration review). Pure: no
// React, no fetch, so every dialog sorts and labels the same way (#195).

/** One row of a bridge picker, already shaped for display and search. */
export type BridgePickerOption = {
  /** Value written into the NIC config (`bridge=<iface>`). */
  iface: string
  /** Main text of the row, also shown in the input once picked. */
  label: string
  /** Dimmed text right after the label (e.g. the hashed PVE id of a VNet). */
  hint?: string
  /** Right-aligned caption (type tag, alias, zone, vDC, subnet). */
  detail?: string
  /** Remix icon class shown before the label. */
  icon?: string
  /** Tint the icon with the primary colour (tenant VNets). */
  accentIcon?: boolean
}

/** Entry kept by the NIC add/edit and create CT dialogs. */
export type BridgeEntry = { iface: string; label: string; kind: 'vnet' | 'shared' | 'bridge' }

/** Offered when the node's network list cannot be read. */
export const FALLBACK_BRIDGES: readonly BridgeEntry[] = [
  { iface: 'vmbr0', label: 'vmbr0', kind: 'bridge' },
  { iface: 'vmbr1', label: 'vmbr1', kind: 'bridge' },
]

const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Natural, case-insensitive order: VLAN2 < vlan10 < VLAN100. */
export function naturalCompare(a: string, b: string): number {
  return COLLATOR.compare(a, b)
}

/** Copy of `items` in natural order of `key`, ties kept in input order. */
export function sortNaturally<T>(items: readonly T[], key: (item: T) => string): T[] {
  return items
    .map((item, index) => ({ item, index, k: key(item) }))
    .sort((x, y) => naturalCompare(x.k, y.k) || x.index - y.index)
    .map(x => x.item)
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Text a `network-choices` row is shown (and therefore sorted) under. */
export function networkChoiceLabel(choice: unknown): string {
  const c = (choice ?? {}) as Record<string, unknown>
  const name = str(c.name)
  if (c.kind === 'vnet') return str(c.displayName) || name
  if (c.kind === 'shared') return str(c.label) || name
  return name
}

const KIND_RANK: Record<string, number> = { vnet: 1, shared: 2 }

/**
 * Sort a raw `network-choices` answer: physical bridges first, then SDN VNets,
 * then shared bridges (the order both server branches already group by), each
 * group in natural order of its display label, then of its PVE name.
 */
export function sortNetworkChoices<T>(choices: readonly T[]): T[] {
  const field = (c: T, k: string) => str((c as Record<string, unknown> | null)?.[k])
  const rank = (c: T) => KIND_RANK[field(c, 'kind')] ?? 0
  return choices
    .map((item, index) => ({ item, index }))
    .sort((x, y) =>
      rank(x.item) - rank(y.item)
      || naturalCompare(networkChoiceLabel(x.item), networkChoiceLabel(y.item))
      || naturalCompare(field(x.item, 'name'), field(y.item, 'name'))
      || x.index - y.index)
    .map(x => x.item)
}

/** Map a raw `network-choices` answer to sorted {iface,label,kind} entries. */
export function toBridgeEntries(data: unknown): BridgeEntry[] {
  if (!Array.isArray(data)) return []
  return sortNetworkChoices(data)
    .filter(c => str((c as Record<string, unknown> | null)?.name))
    .map(c => ({
      iface: str(c.name),
      label: networkChoiceLabel(c),
      kind: c.kind === 'vnet' || c.kind === 'shared' ? c.kind : 'bridge',
    }))
}

/** Picker row for an entry: friendly label first, PVE name dimmed when it differs. */
export function bridgeEntryOption(entry: Pick<BridgeEntry, 'iface' | 'label'>): BridgePickerOption {
  const label = entry.label || entry.iface
  return { iface: entry.iface, label, ...(label === entry.iface ? {} : { hint: entry.iface }) }
}

// Short type tags shown in the caption of a row.
const TYPE_TAG: Record<string, string> = { vnet: 'VNet', shared: 'Shared', OVSBridge: 'OVS' }

/**
 * Picker row for the create VM wizard bridges ({iface,type,label,vdc}): the
 * VNet display name leads and demotes the hashed id; other kinds lead with the
 * iface and carry their type tag, label and vDC in the caption.
 */
export function typedBridgeOption(b: { iface: string; type?: string | null; label?: string | null; vdc?: string | null }): BridgePickerOption {
  const tag = TYPE_TAG[b.type ?? ''] ?? null
  const isNamedVnet = b.type === 'vnet' && !!b.label && b.label !== b.iface
  const label = isNamedVnet ? (b.label as string) : b.iface
  const extraLabel = !isNamedVnet && b.label && b.label !== b.iface ? b.label : null
  const vdc = b.vdc && b.vdc !== '*' ? b.vdc : null
  const detail = [tag, extraLabel, vdc].filter(Boolean).join(' · ')
  return { iface: b.iface, label, ...(isNamedVnet ? { hint: b.iface } : {}), ...(detail ? { detail } : {}) }
}

/**
 * Rows of the template deploy wizard picker: VNets first, then shared
 * uplinks, then (full cluster view only) raw bridges, each group in natural
 * order of its shown name. The wizard auto-picks the first tenant row from
 * this same list so the picker and the deploy payload agree.
 */
export function orderDeployBridges<T extends { iface: string; type?: string | null; displayName?: string | null }>(
  bridges: readonly T[],
  fullClusterNet: boolean,
): T[] {
  const vnets = sortNaturally(bridges.filter(b => b.type === 'vnet'), b => b.displayName || b.iface)
  const shared = sortNaturally(bridges.filter(b => b.type === 'shared'), b => b.iface)
  if (!fullClusterNet) return [...vnets, ...shared]
  const raw = sortNaturally(bridges.filter(b => b.type !== 'vnet' && b.type !== 'shared'), b => b.iface)
  return [...vnets, ...shared, ...raw]
}

/**
 * Picker row for the template deploy wizard: a VNet leads with its display
 * name, a shield icon and its subnet; a raw bridge or shared uplink leads with
 * its iface and a short type tag.
 */
export function deployBridgeOption(b: {
  iface: string
  type?: string | null
  displayName?: string | null
  subnet?: { cidr: string; gateway: string } | null
}): BridgePickerOption {
  if (b.type === 'vnet') {
    return {
      iface: b.iface,
      label: b.displayName || b.iface,
      icon: 'ri-shield-keyhole-line',
      accentIcon: true,
      ...(b.subnet ? { detail: `${b.subnet.cidr} · gw ${b.subnet.gateway}` } : {}),
    }
  }
  const tag = TYPE_TAG[b.type ?? ''] ?? 'Bridge'
  return { iface: b.iface, label: b.iface, icon: 'ri-git-branch-line', detail: tag }
}

/** Picker row for the migration review: PVE name first, its kind caption on the right. */
export function migrationBridgeOption(c: { name: string; label: string; kind: 'bridge' | 'vnet' | 'shared' }): BridgePickerOption {
  return {
    iface: c.name,
    label: c.name,
    icon: c.kind === 'vnet' ? 'ri-node-tree' : 'ri-router-line',
    ...(c.label ? { detail: c.label } : {}),
  }
}

/** Every searchable text of a row, so typing an alias, id, tag or zone finds it. */
export function bridgeOptionSearchText(o: BridgePickerOption): string {
  return [o.label, o.iface, o.hint, o.detail].filter(Boolean).join(' ')
}
