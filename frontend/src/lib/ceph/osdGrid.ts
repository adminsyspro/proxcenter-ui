export type OsdGridState = 'up' | 'out' | 'nearfull' | 'full' | 'down'

export interface OsdGridItem {
  id: number
  state: OsdGridState
}

type HealthChecks = Record<string, { detail?: Array<{ message?: string }> } | null | undefined>

const OSD_ID_RE = /osd\.(\d+)/g

function idsIn(check: { detail?: Array<{ message?: string }> } | null | undefined): number[] {
  const ids: number[] = []
  for (const d of check?.detail || []) {
    OSD_ID_RE.lastIndex = 0
    let m
    while ((m = OSD_ID_RE.exec(d?.message || '')) !== null) ids.push(Number.parseInt(m[1], 10))
  }
  return ids
}

/**
 * State of each OSD for the cluster OSD grids (inventory and dashboard).
 *
 * With the real OSD list (`osds`), each OSD takes its own state. Without it
 * the status summary only gives counts, so which OSD is down comes from the
 * Ceph health details, which name each one (`osd.N ... is down`). Those ids
 * are used alone when present: guessing by position (the last ids are the
 * down ones) is only a fallback for clusters that report no detail, since a
 * failed host rarely carries the highest ids.
 */
export function osdGridStates({ total, up, inCount, healthChecks, osds }: {
  total: number
  up: number
  inCount: number
  healthChecks?: HealthChecks | null
  /** Real per-OSD flags when the caller has them: used instead of any guess. */
  osds?: ReadonlyArray<{ id: number; up: boolean; in: boolean }> | null
}): OsdGridItem[] {
  const checks = healthChecks || {}
  const downIds = new Set<number>()
  const nearFullIds = new Set<number>()
  const fullIds = new Set<number>()

  for (const [name, check] of Object.entries(checks)) {
    const ids = idsIn(check)
    if (name === 'OSD_DOWN' || name === 'OSD_FLAGS') ids.forEach(id => downIds.add(id))
    else if (name === 'OSD_NEARFULL' || name === 'OSD_BACKFILLFULL') ids.forEach(id => nearFullIds.add(id))
    else if (name === 'OSD_FULL') ids.forEach(id => fullIds.add(id))
  }

  if (osds && osds.length > 0) {
    return [...osds].sort((a, b) => a.id - b.id).map(o => {
      let state: OsdGridState = 'up'

      if (!o.up) state = 'down'
      else if (fullIds.has(o.id)) state = 'full'
      else if (nearFullIds.has(o.id)) state = 'nearfull'
      else if (!o.in) state = 'out'
      return { id: o.id, state }
    })
  }

  const downNamed = downIds.size > 0
  const items: OsdGridItem[] = []

  for (let id = 0; id < total; id++) {
    let state: OsdGridState = 'up'

    if (downNamed ? downIds.has(id) : id >= up) state = 'down'
    else if (fullIds.has(id)) state = 'full'
    else if (nearFullIds.has(id)) state = 'nearfull'
    else if (!downNamed && id >= inCount) state = 'out'
    items.push({ id, state })
  }

  return items
}
