import type { VMFirewallInfo } from '@/hooks/useVMFirewallRules'
import type { MicrosegSnapshot } from '@/lib/microseg/types'

/** The security group the micro-segmentation engine attaches to the members of a zone (Go: microseg.ObjectName). */
export const ZONE_GROUP_PREFIX = 'pcz-'

export type GroupMembers = {
  members: VMFirewallInfo[]
  /**
   * The list is the whole membership. False: Proxmox keeps no member list (a guest belongs because one of its rules
   * carries the group) and a guest's rules are read only when its row is opened, so only those guests can be told.
   */
  known: boolean
}

const carries = (guest: VMFirewallInfo, group: string) =>
  guest.rulesLoaded && guest.rules.some(r => r.type === 'group' && r.action === group)

/**
 * Members of a security group without reading every guest's rules (UA44). For the group of a zone of the deployed
 * micro-segmentation revision that observes or enforces, the members are the guests tagged `<prefix><zone>`: the
 * engine attaches the group to each of them, so the list is known. For any other group, only the guests whose rules
 * were read can be told; the list is then not known.
 */
export function groupMembers(group: string, guests: VMFirewallInfo[], deployed: MicrosegSnapshot | null | undefined): GroupMembers {
  const zone = deployed && group.startsWith(ZONE_GROUP_PREFIX)
    ? deployed.zones.find(z => `${ZONE_GROUP_PREFIX}${z.name}` === group && (z.state === 'observe' || z.state === 'enforce'))
    : undefined

  if (!zone || !deployed) return { members: guests.filter(g => carries(g, group)), known: false }

  // PVE lowercases tags; the prefix and the zone name are compared the same way.
  const tag = `${deployed.tag_prefix}${zone.name}`.toLowerCase()

  return {
    members: guests.filter(g => carries(g, group) || g.tags.some(candidate => candidate.toLowerCase() === tag)),
    known: true,
  }
}
