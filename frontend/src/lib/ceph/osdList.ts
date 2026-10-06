export interface OsdUpIn {
  id: number
  up: boolean
  in: boolean
}

/**
 * Flatten what PVE returns on /nodes/{node}/ceph/osd (a CRUSH tree, sometimes
 * wrapped in `root`, sometimes already flat) into the list of OSD entries.
 * Buckets (root, datacenter, host) carry negative ids and are skipped.
 */
export function flattenOsdTree(raw: unknown): any[] {
  const walk = (items: any[]): any[] => {
    let out: any[] = []
    for (const item of items) {
      if (item?.type === 'osd' || (typeof item?.id === 'number' && item.id >= 0 && !item?.children)) out.push(item)
      if (Array.isArray(item?.children)) out = out.concat(walk(item.children))
    }
    return out
  }

  if (Array.isArray(raw)) {
    if (raw.length > 0 && raw[0]?.children) return walk(raw)
    if (raw.length > 0 && raw[0]?.root?.children) return walk(raw[0].root.children)
    return raw
  }
  if (raw && typeof raw === 'object' && Array.isArray((raw as any).root?.children)) return walk((raw as any).root.children)
  return []
}

/** Up and in flags of one OSD entry, whichever form PVE used. */
export function osdUpIn(osd: any): OsdUpIn {
  const statusStr = String(osd?.status || '').toLowerCase()
  return {
    id: Number(osd?.id),
    up: osd?.up === 1 || osd?.up === true || osd?.up === '1' || statusStr === 'up',
    in: osd?.in === 1 || osd?.in === true || osd?.in === '1' || (osd?.reweight !== undefined && osd.reweight > 0),
  }
}

/** The up/in list of every OSD of a PVE OSD tree answer, sorted by id. */
export function osdUpInList(raw: unknown): OsdUpIn[] {
  return flattenOsdTree(raw)
    .map(osdUpIn)
    .filter(o => Number.isInteger(o.id) && o.id >= 0)
    .sort((a, b) => a.id - b.id)
}
