// Évaluation pré-migration des règles d'affinité HA de PVE 9 (/cluster/ha/rules).
// Le ha-manager refuse de migrer une ressource HA vers un nœud hébergeant une
// ressource en affinité négative avec elle ; ce module permet à l'UI de le
// détecter avant d'envoyer la migration.

export type HaRule = {
  rule: string
  type?: string // 'resource-affinity' | 'node-affinity'
  affinity?: string // 'positive' | 'negative' (resource-affinity uniquement)
  resources?: string // "vm:100,ct:101"
  disable?: number | boolean
}

export type HaStatusEntry = {
  id?: string // "service:vm:100" pour les services
  type?: string // 'service' | 'quorum' | 'master' | 'lrm'
  sid?: string // "vm:100"
  node?: string
  state?: string
}

export type AffinityPeer = {
  sid: string
  rule: string
  node: string | null
  state: string | null
  running: boolean
}

// États CRM où la ressource occupe effectivement son nœud
const ACTIVE_STATES = new Set(['started', 'starting', 'migrate', 'relocate', 'recovery', 'error', 'fence'])

export function parseRuleResources(resources: unknown): string[] {
  if (typeof resources !== 'string') return []

  return resources.split(',').map(s => s.trim()).filter(Boolean)
}

// Map sid -> placement courant, à partir de /cluster/ha/status/current
export function getServicePlacements(status: HaStatusEntry[] | null | undefined): Map<string, { node: string | null; state: string | null }> {
  const placements = new Map<string, { node: string | null; state: string | null }>()

  for (const entry of status || []) {
    if (entry?.type !== 'service') continue
    const sid = entry.sid || (typeof entry.id === 'string' ? entry.id.replace(/^service:/, '') : '')

    if (!sid) continue
    placements.set(sid, { node: entry.node || null, state: entry.state || null })
  }

  return placements
}

// Pairs de vmSid dans les règles resource-affinity actives du type demandé
export function getAffinityPeers(
  vmSid: string,
  rules: HaRule[] | null | undefined,
  affinity: 'negative' | 'positive',
  status?: HaStatusEntry[] | null
): AffinityPeer[] {
  const placements = getServicePlacements(status)
  const peers: AffinityPeer[] = []
  const seen = new Set<string>()

  for (const rule of rules || []) {
    if (rule?.type !== 'resource-affinity' || rule.affinity !== affinity || rule.disable) continue
    const sids = parseRuleResources(rule.resources)

    if (!sids.includes(vmSid)) continue

    for (const sid of sids) {
      if (sid === vmSid || seen.has(sid)) continue
      seen.add(sid)
      const placement = placements.get(sid)
      const state = placement?.state ?? null

      peers.push({
        sid,
        rule: rule.rule,
        node: placement?.node ?? null,
        state,
        running: state !== null && ACTIVE_STATES.has(state),
      })
    }
  }

  return peers
}

// nœud -> ressources en affinité négative avec vmSid placées sur ce nœud
export function computeNegativeAffinityConflicts(
  vmSid: string,
  rules: HaRule[] | null | undefined,
  status: HaStatusEntry[] | null | undefined
): Map<string, AffinityPeer[]> {
  const byNode = new Map<string, AffinityPeer[]>()

  for (const peer of getAffinityPeers(vmSid, rules, 'negative', status)) {
    if (!peer.node) continue
    const list = byNode.get(peer.node)

    if (list) list.push(peer)
    else byNode.set(peer.node, [peer])
  }

  return byNode
}
