import type { VMFirewallInfo } from '@/hooks/useVMFirewallRules'
import type { MicrosegSnapshot } from '@/lib/microseg/types'

/** The security group the micro-segmentation engine attaches to the members of a zone (Go: microseg.ObjectName). */
export const ZONE_GROUP_PREFIX = 'pcz-'

/** What the server read of the guests' rules (hooks/useGroupUsage), as far as membership needs it. */
export type GroupUsageView = { groups: Record<string, Array<{ type: string; vmid: string }>>; partial: boolean; unread: number }

export type GroupMembers = {
  members: VMFirewallInfo[]
  /**
   * The list is the whole membership. False: Proxmox keeps no member list (a guest belongs because one of its rules
   * carries the group), and the rules of some guests could not be read, or of none.
   */
  known: boolean
}

const names = (rules: VMFirewallInfo['rules'], group: string) => rules.some(r => r.type === 'group' && r.action === group)

/**
 * Members of a security group. Proxmox keeps no member list: the server reads the rules of the guests once for every
 * viewer (`usage`), and a guest whose rules were read in this page (its row was opened, it was just attached or
 * detached) is told by them, which are newer. For the group of a zone of the deployed micro-segmentation revision
 * that observes or enforces, the members are the guests tagged `<prefix><zone>`, as the zone map counts them: the
 * engine attaches the group to each of them and removes it from the others, so the tags are the list. `zoneTags`
 * gives those tags as the zone map reads them (read again after every run); the tags of `guests` come from the
 * inventory the app keeps, which can be minutes behind a move between zones.
 */
export function groupMembers(
  group: string,
  guests: VMFirewallInfo[],
  deployed: MicrosegSnapshot | null | undefined,
  usage?: GroupUsageView | null,
  zoneTags?: Map<string, string[]> | null,
): GroupMembers {
  const read = new Set((usage?.groups[group] ?? []).map(m => `${m.type}/${m.vmid}`))
  const carries = (guest: VMFirewallInfo) => (guest.rulesLoaded ? names(guest.rules, group) : read.has(`${guest.type}/${guest.vmid}`))
  const zone = deployed && group.startsWith(ZONE_GROUP_PREFIX)
    ? deployed.zones.find(z => `${ZONE_GROUP_PREFIX}${z.name}` === group && (z.state === 'observe' || z.state === 'enforce'))
    : undefined

  if (!zone || !deployed) return { members: guests.filter(carries), known: !!usage && !usage.partial }

  // PVE lowercases tags; the prefix and the zone name are compared the same way.
  const tag = `${deployed.tag_prefix}${zone.name}`.toLowerCase()

  const tagsOf = (g: VMFirewallInfo) => zoneTags?.get(`${g.type}/${g.vmid}`) ?? g.tags
  // The rules read in this page still count (a group just attached by hand); the shared read does not, it can
  // predate the run that moved a guest to another zone.
  const attachedHere = (g: VMFirewallInfo) => g.rulesLoaded && names(g.rules, group)

  return {
    members: guests.filter(g => attachedHere(g) || tagsOf(g).some(candidate => candidate.toLowerCase() === tag)),
    known: true,
  }
}

/**
 * The groups guests still name although they no longer exist, with those guests: what a deletion left behind before
 * ProxCenter checked for it, or a group deleted in Proxmox. Only what the server read can be told.
 */
export function orphanGroups(usage: GroupUsageView | null | undefined, existing: string[]): Array<{ group: string; members: Array<{ type: string; vmid: string }> }> {
  if (!usage) return []
  const known = new Set(existing)

  return Object.entries(usage.groups)
    .filter(([group, members]) => !known.has(group) && members.length > 0)
    .map(([group, members]) => ({ group, members }))
    .sort((a, b) => a.group.localeCompare(b.group))
}
