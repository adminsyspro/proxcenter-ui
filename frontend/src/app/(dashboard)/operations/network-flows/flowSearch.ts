// Search over sFlow IP pairs, mirroring the orchestrator's IPPair.Matches so a
// pair fetched with ?q= and a pair of the global top N agree on what matches.

export interface IPPair {
  src_ip: string
  dst_ip: string
  src_vmid?: number
  dst_vmid?: number
  src_name?: string
  dst_name?: string
  bytes: number
  packets: number
  protocol: string
  dst_port: number
}

export interface EndpointInfo {
  vmid?: number
  name?: string
}

export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase()
}

// An endpoint matches on an IP containing q, a VM name containing q, or a VMID equal to q.
export function endpointMatches(ip: string, info: EndpointInfo | undefined, q: string): boolean {
  if (!q) return false
  if (ip.includes(q)) return true
  if (info?.name && info.name.toLowerCase().includes(q)) return true
  return /^\d+$/.test(q) && info?.vmid !== undefined && info.vmid > 0 && info.vmid === Number(q)
}

// IP → VM attribution learned from every pair; an IP keeps the first VM seen for it.
export function buildEndpointIndex(pairs: IPPair[]): Map<string, EndpointInfo> {
  const index = new Map<string, EndpointInfo>()
  const learn = (ip: string, vmid?: number, name?: string) => {
    if (!vmid) return
    const known = index.get(ip)
    if (!known) index.set(ip, { vmid, name: name || undefined })
    else if (!known.name && name && known.vmid === vmid) known.name = name
  }
  for (const p of pairs) {
    learn(p.src_ip, p.src_vmid, p.src_name)
    learn(p.dst_ip, p.dst_vmid, p.dst_name)
  }
  return index
}

export function endpointLabel(ip: string, info: EndpointInfo | undefined): string {
  if (!info?.vmid) return ip
  return `${info.name || `VM ${info.vmid}`} (${ip})`
}

// Union of the global top pairs and the pairs the server matched, without duplicates.
export function mergePairs(top: IPPair[], matched: IPPair[]): IPPair[] {
  const seen = new Set(top.map(p => `${p.src_ip}|${p.dst_ip}`))
  return [...top, ...matched.filter(p => !seen.has(`${p.src_ip}|${p.dst_ip}`))]
}
