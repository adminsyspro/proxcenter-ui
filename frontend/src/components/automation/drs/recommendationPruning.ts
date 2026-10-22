// Pure helpers behind the DRS page's pending list: which recommendations it
// shows, and which ones it rejects on its own. A maintenance evacuation or an
// affinity rule violation is mandatory: the page never rejects it for being
// one too many or for a source node that is no longer loaded, since neither
// was raised by load in the first place.

export interface PrunableRecommendation {
  id: string
  connection_id: string
  source_node: string
  maintenance_evacuation?: boolean
  rule_violation?: boolean
}

type ClusterMetrics = Record<string, { nodes?: { node: string; memory_usage: number }[] } | undefined>

/** A recommendation the page must never reject on its own. */
export const isMandatoryRecommendation = (rec: PrunableRecommendation): boolean =>
  !!(rec.maintenance_evacuation || rec.rule_violation)

/**
 * The recommendations kept per cluster, in their given order (best first):
 * every mandatory one, then the others while the cluster has fewer than
 * maxPending.
 */
export const keptRecommendations = <T extends PrunableRecommendation>(recs: T[], maxPending: number): T[] => {
  const mandatoryCount = new Map<string, number>()

  for (const rec of recs) {
    if (isMandatoryRecommendation(rec)) mandatoryCount.set(rec.connection_id, (mandatoryCount.get(rec.connection_id) ?? 0) + 1)
  }

  const kept = new Map<string, number>()

  return recs.filter(rec => {
    const cid = rec.connection_id
    const count = kept.get(cid) ?? 0

    if (!isMandatoryRecommendation(rec) && count + (mandatoryCount.get(cid) ?? 0) >= maxPending) return false
    if (!isMandatoryRecommendation(rec)) kept.set(cid, count + 1)

    return true
  })
}

/** The optional recommendations beyond maxPending in their cluster. */
export const excessRecommendations = <T extends PrunableRecommendation>(recs: T[], maxPending: number): T[] => {
  const kept = new Set(keptRecommendations(recs, maxPending).map(rec => rec.id))

  return recs.filter(rec => !kept.has(rec.id))
}

/**
 * The load-balancing recommendations whose source node is no longer above
 * its cluster's average memory (2 points of tolerance).
 */
export const staleRecommendations = <T extends PrunableRecommendation>(recs: T[], metrics: ClusterMetrics): T[] =>
  recs.filter(rec => {
    if (isMandatoryRecommendation(rec)) return false
    const nodes = metrics[rec.connection_id]?.nodes

    if (!nodes || nodes.length < 2) return false
    const avgMem = nodes.reduce((sum, n) => sum + n.memory_usage, 0) / nodes.length
    const source = nodes.find(n => n.node === rec.source_node)

    return !!source && source.memory_usage <= avgMem + 2
  })
