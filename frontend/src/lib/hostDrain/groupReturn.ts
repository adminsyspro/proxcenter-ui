// Leaving the maintenance of a group of nodes (roadmap#198). Proxmox HA brings
// its own guests back when each node leaves maintenance; the guests the drain
// moved itself stay where they landed unless the operator asks for them back.
// This finds the last group drain of exactly these nodes and turns the guests
// it moved into a selection drain sending each one to the node it came from.

export interface GroupDrainGuest {
  vmid: number
  status?: string
  mode?: string
  ha?: boolean
  source_node?: string
  target_node?: string
}

export interface GroupDrainRecord {
  id?: string
  node?: string
  status?: string
  created_at?: string
  config?: { nodes?: string[] }
  guests?: GroupDrainGuest[]
}

const byName = (x: string, y: string) => x.localeCompare(y)
const sameNodes = (a: string[], b: string[]) => a.length === b.length && [...a].sort(byName).join(',') === [...b].sort(byName).join(',')

/** The newest drain that put exactly `nodes` in maintenance together. */
export function lastGroupDrain(drains: GroupDrainRecord[], nodes: string[]): GroupDrainRecord | null {
  const groups = drains.filter(d => Array.isArray(d.config?.nodes) && sameNodes(d.config!.nodes!, nodes))
  groups.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))

  return groups[0] ?? null
}

/**
 * The guests a group drain moved itself and that may go back: completed, not
 * HA (Proxmox returns those), from a node of the group to one outside it.
 */
export function returnableGuests(drain: GroupDrainRecord | null): GroupDrainGuest[] {
  const nodes = drain?.config?.nodes || []

  return (drain?.guests || []).filter(g =>
    g.status === 'completed' && !g.ha && g.mode !== 'ha' &&
    !!g.source_node && nodes.includes(g.source_node) &&
    !!g.target_node && !nodes.includes(g.target_node))
}

/**
 * The selection drain that sends each guest back to the node it left. The
 * guests ran there before the maintenance: only the node's memory bounds the
 * return, not the safety ceiling of an evacuation (a node at 80 % before the
 * maintenance would otherwise refuse its own guests back).
 */
export function returnDrainConfig(guests: GroupDrainGuest[]) {
  return {
    vmids: guests.map(g => g.vmid),
    guest_targets: Object.fromEntries(guests.map(g => [String(g.vmid), g.source_node as string])),
    include_stopped: true,
    mem_ceiling_percent: 100,
  }
}
