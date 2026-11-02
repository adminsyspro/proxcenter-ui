export interface OsdLoad {
  id: number
  host: string
  deviceClass: string
  usedBytes: number
  totalBytes: number
  crushWeight: number
  up: boolean
  in: boolean
  /** False when the fill of the OSD could not be read (no size, down, no fill while it holds PGs): its data cannot be estimated. */
  loadKnown?: boolean
}

export interface OutImpact {
  movedBytes: number
  maxProjectedRatio: number
  maxProjectedOsd: number | null
  overNearfull: boolean
  overFull: boolean
  receivers: number
  /** The figures above are a guess at best: the load of the OSD (or of a receiver) is not known. */
  unknown: boolean
}

/**
 * Remplissage projeté des autres OSD quand on sort `targetId`.
 * Modèle : les données de la cible restent d'abord sur son hôte (un out ne change pas le poids
 * CRUSH de l'hôte, les PG restent sur l'hôte : domaine de panne host, cas PVE standard) et sont
 * réparties entre les autres OSD up et in de la même classe de CET hôte, au prorata du poids CRUSH.
 * Sans tel OSD, elles sont réparties entre tous les OSD up et in de la même classe.
 */
export function osdOutImpact(osds: OsdLoad[], targetId: number, ratios: { nearfull: number; full: number }): OutImpact {
  const target = osds.find(o => o.id === targetId)

  if (!target) {
    return { movedBytes: 0, maxProjectedRatio: 0, maxProjectedOsd: null, overNearfull: false, overFull: false, receivers: 0, unknown: false }
  }

  const eligible = osds.filter(
    o => o.id !== targetId && o.up && o.in && o.deviceClass === target.deviceClass && o.crushWeight > 0 && o.totalBytes > 0,
  )
  const sameHost = eligible.filter(o => o.host === target.host)
  const receivers = sameHost.length > 0 ? sameHost : eligible

  // cible déjà out : ses données ont déjà été déplacées, la sortir ne change rien
  if (!target.in) {
    return { movedBytes: 0, maxProjectedRatio: 0, maxProjectedOsd: null, overNearfull: false, overFull: false, receivers: receivers.length, unknown: false }
  }

  const movedBytes = target.usedBytes
  const unknown = target.loadKnown === false || receivers.some(o => o.loadKnown === false)

  if (receivers.length === 0) {
    return { movedBytes, maxProjectedRatio: 1, maxProjectedOsd: null, overNearfull: true, overFull: true, receivers: 0, unknown }
  }

  const totalWeight = receivers.reduce((sum, o) => sum + o.crushWeight, 0)
  let maxProjectedRatio = 0
  let maxProjectedOsd: number | null = null

  for (const o of receivers) {
    const projected = (o.usedBytes + (movedBytes * o.crushWeight) / totalWeight) / o.totalBytes

    if (projected > maxProjectedRatio) {
      maxProjectedRatio = projected
      maxProjectedOsd = o.id
    }
  }

  return {
    movedBytes,
    maxProjectedRatio,
    maxProjectedOsd,
    overNearfull: maxProjectedRatio >= ratios.nearfull,
    overFull: maxProjectedRatio >= ratios.full,
    receivers: receivers.length,
    unknown,
  }
}
