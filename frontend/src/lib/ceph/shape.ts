import type { CephHistory } from '@/lib/orchestrator/client'

import type { parseCrushMap } from './crushRules'
import type { CephInventory, CephLive } from './types'

/*
   Shape guards for the cockpit reads. A body that answers 200 without the
   expected shape (a proxy page, the demo fallback `{ data: [] }`, an older
   route) is treated as a failed read rather than rendered: the cockpit then
   shows its error or stale state instead of throwing.
*/

type Rec = Record<string, unknown>

const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const hasArray = (v: unknown, key: string) => isRec(v) && Array.isArray(v[key])

function isHealth(v: unknown): boolean {
  return isRec(v) && typeof v.status === 'string' && Array.isArray(v.checks)
}

export function isCephLive(v: unknown): v is CephLive {
  if (!isRec(v) || !isHealth(v.health)) return false

  const { pg, osd, io, recovery, raw } = v

  return isRec(pg) && isNum(pg.total) && isNum(pg.clean) && Array.isArray(pg.byState)
    && isRec(osd) && isNum(osd.total) && isNum(osd.up) && isNum(osd.in)
    && isRec(io) && isRec(recovery) && isRec(raw)
}

export function isCephInventory(v: unknown): v is CephInventory {
  if (!isRec(v) || !isHealth(v.health)) return false

  return hasArray(v.osds, 'list') && hasArray(v.pools, 'list') && hasArray(v.monitors, 'list') && hasArray(v.mds, 'list')
    && (v.monDisk === undefined || Array.isArray(v.monDisk))
    && hasArray(v.pgs, 'states') && isRec(v.capacity) && isRec(v.performance)
    && isRec(v.managers) && Array.isArray(v.managers.standbys)
    && (v.managers.stopped === undefined || Array.isArray(v.managers.stopped))
}

/** An OSD id as an integer >= 0: a number, or a string of digits as PVE passes it on Ceph 20 ("0"). */
function osdId(raw: unknown): number | null {
  if (isNum(raw)) return Number.isInteger(raw) && raw >= 0 ? raw : null
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) return Number(raw.trim())

  return null
}

/**
 * The inventory with every OSD id as a number, read once here so that no view compares
 * `"0"` with `0`. An OSD whose id is not readable is dropped: it could not be opened anyway.
 */
export function normalizeCephInventory(inv: CephInventory): CephInventory {
  const list = (inv.osds.list as { id: unknown }[]).flatMap(o => {
    const id = osdId(o.id)

    return id === null ? [] : [{ ...o, id }]
  }) as CephInventory['osds']['list']

  const base = { ...inv, osds: { ...inv.osds, list } }

  if (!Array.isArray(inv.monDisk)) return base

  // Malformed entries are dropped: a mon with no usable measure is a mon with no entry.
  const monDisk = inv.monDisk.filter(m => isRec(m) && typeof m.mon === 'string' && isNum(m.availPct) && isNum(m.availBytes) && isNum(m.totalBytes))

  return { ...base, monDisk }
}

export function isCrushMap(v: unknown): v is ReturnType<typeof parseCrushMap> {
  return hasArray(v, 'buckets') && hasArray(v, 'rules') && hasArray(v, 'types')
}

export function isCephHistory(v: unknown): v is CephHistory {
  return hasArray(v, 'points') && hasArray(v, 'slowest_osds')
}
