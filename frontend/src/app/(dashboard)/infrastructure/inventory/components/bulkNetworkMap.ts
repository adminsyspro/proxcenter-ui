/**
 * Network table of the bulk migration dialog (ui#1333): one row per source
 * network of the selected VMs, each with the target bridge or VNet and the
 * VLAN tag its adapters get. A row left on "default" sends nothing: its
 * adapters land on the dialog's bridge and tag, as before.
 */

import type { MigrationNetworkMapEntry } from '@/lib/migration/target-overrides'

export interface BulkNetworkRow {
  /** The source port group, as the engines match it. */
  source: string
  /** Selected VMs with an adapter on it. */
  vmCount: number
  /** Target bridge or VNet; '' keeps the dialog's bridge. */
  bridge: string
  /** '' keeps the dialog's tag. */
  vlanTag: string
}

/**
 * The rows for the networks of the current selection: a row the operator
 * already edited keeps its choice, a network the saved table knows takes its
 * saved bridge and tag, any other starts on the default.
 */
export function mergeNetworkRows(
  networks: Array<{ name: string; vmCount: number }>,
  saved: MigrationNetworkMapEntry[],
  current: BulkNetworkRow[],
): BulkNetworkRow[] {
  return networks.map(n => {
    const edited = current.find(r => r.source === n.name)
    if (edited) return { ...edited, vmCount: n.vmCount }
    const s = saved.find(r => r.source === n.name)
    return { source: n.name, vmCount: n.vmCount, bridge: s?.bridge ?? '', vlanTag: s?.vlanTag ? String(s.vlanTag) : '' }
  })
}

function tagOf(raw: string): number | undefined {
  const n = Number(raw)
  return raw.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= 4094 ? n : undefined
}

/** True when a row's tag is set but not a valid 802.1Q id. */
export function rowTagInvalid(row: BulkNetworkRow): boolean {
  return row.vlanTag.trim() !== '' && tagOf(row.vlanTag) === undefined
}

/** The `networkMap` of the batch request: the rows with a bridge, undefined when none has one. */
export function buildNetworkMapPayload(rows: BulkNetworkRow[], canEditVlan: boolean): MigrationNetworkMapEntry[] | undefined {
  const out = rows.flatMap(r => {
    const bridge = r.bridge.trim()
    if (!bridge) return []
    const tag = canEditVlan ? tagOf(r.vlanTag) : undefined
    return [{ source: r.source, bridge, ...(tag !== undefined && { vlanTag: tag }) }]
  })
  return out.length > 0 ? out : undefined
}
