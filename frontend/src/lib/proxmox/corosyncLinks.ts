/**
 * Corosync link addresses of one nodelist entry, in link order. Proxmox
 * spells them `ring0_addr` .. `ring7_addr` both in `/cluster/config/nodes`
 * and in the `/cluster/config/join` nodelist, whatever the corosync version:
 * `linkN` only exists in the totem section. Empty for a node without corosync.
 */
export function corosyncLinksOf(entry: unknown): string[] {
  const links: string[] = []
  if (!entry || typeof entry !== 'object') return links
  const record = entry as Record<string, unknown>
  for (let i = 0; i <= 7; i++) {
    const addr = record[`ring${i}_addr`]
    if (typeof addr === 'string' && addr) links.push(addr)
  }
  return links
}
