import * as firewallAPI from '@/lib/api/firewall'

/** A guest as the detach needs it: where its rules are. */
export type DetachTarget = { type: string; vmid: string | number; node: string }

/**
 * Removes from a guest every rule that names this security group, and returns how many were removed. The guest's
 * rules are read first (one call): Proxmox addresses a rule by its position, and the positions known earlier may
 * have moved. A guest carrying the group twice loses both rules, from the last position to the first, so that a
 * deletion never shifts the position of the next one.
 */
export async function detachGroup(connectionId: string, guest: DetachTarget, group: string): Promise<number> {
  const vmid = Number(guest.vmid)
  const rules = await firewallAPI.getVMRules(connectionId, guest.node, guest.type, vmid)
  const positions = (Array.isArray(rules) ? rules : [])
    .filter(r => r.type === 'group' && r.action === group && r.pos !== undefined)
    .map(r => r.pos as number)
    .sort((a, b) => b - a)

  for (const pos of positions) await firewallAPI.deleteVMRule(connectionId, guest.node, guest.type, vmid, pos)

  return positions.length
}

/**
 * The nodes whose own rules name this security group, read now (one call per node): the page only knows the node
 * rules once Firewalling was opened, and a group a node still names must not be deleted. A node whose rules could
 * not be read (it is offline) is returned apart, so that it is said rather than taken for "not using the group".
 */
export async function nodesNamingGroup(connectionId: string, nodes: string[], group: string): Promise<{ naming: string[]; unread: string[] }> {
  const naming: string[] = []
  const unread: string[] = []

  await Promise.all(nodes.map(async node => {
    try {
      const rules = await firewallAPI.getNodeRules(connectionId, node)

      if ((Array.isArray(rules) ? rules : []).some(r => r.type === 'group' && r.action === group)) naming.push(node)
    } catch {
      unread.push(node)
    }
  }))

  const byName = (a: string, b: string) => a.localeCompare(b)

  return { naming: naming.sort(byName), unread: unread.sort(byName) }
}
