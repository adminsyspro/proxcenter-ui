import type { CephInventory } from './types'
import { resolvePveNode } from './osdTable'

/*
   Rows of the Services tab of the Ceph cockpit: monitors, managers and metadata servers
   of the inventory in one list, each with the PVE node its actions must target, and the
   versions that run in the cluster (a gap between them means an unfinished upgrade).
*/

export type ServiceKind = 'mon' | 'mgr' | 'mds'
export const SERVICE_KINDS: ServiceKind[] = ['mon', 'mgr', 'mds']

export type ServiceState = 'quorum' | 'outOfQuorum' | 'active' | 'standby' | 'standbyReplay' | 'stopped' | 'other'

export interface ServiceRow {
  kind: ServiceKind
  /** The PVE service name: mon.pve1. */
  service: string
  host: string
  /** The PVE node of the host, null when the host matches none (or several) of the connection's nodes. */
  node: string | null
  state: ServiceState
  /** Raw MDS state, shown as is when it is none of the known ones. */
  rawState: string | null
  dot: 'ok' | 'warn' | 'info'
  leader: boolean
  /** Rank of a monitor or of an MDS, null when the daemon holds none. */
  rank: number | null
  addr: string | null
  version: string | null
  running: boolean
}

const tidyAddr = (addr: string | null | undefined): string | null => {
  if (!addr) return null

  // PVE writes v2:10.0.0.1:3300/0 or 10.0.0.1:6789/0: the nonce after the slash is noise.
  return addr.replace(/\/\d+$/, '') || null
}

function mdsState(raw: string): { state: ServiceState; dot: ServiceRow['dot']; running: boolean } {
  const s = raw.toLowerCase()

  if (s.includes('replay')) return { state: 'standbyReplay', dot: 'info', running: true }
  if (s.includes('standby')) return { state: 'standby', dot: 'info', running: true }
  if (s.includes('active')) return { state: 'active', dot: 'ok', running: true }
  // `stopped` only: `up:stopping` is a daemon still running its shutdown, shown with its raw state.
  if (/(^|[^a-z])stopped$/.test(s)) return { state: 'stopped', dot: 'warn', running: false }
  if (/down|fail|offline/.test(s)) return { state: 'other', dot: 'warn', running: false }

  return { state: 'other', dot: 'warn', running: s !== 'unknown' }
}

/**
 * The release of a Ceph version string: 20.2.4 from `20.2.4` or from
 * `ceph version 20.2.4 (abc) tentacle (stable)`, a `-N` build suffix kept. Null when unreadable.
 */
export function normalizeCephVersion(v: string | null | undefined): string | null {
  const m = /\d+\.\d+\.\d+(?:-\d+)?/.exec(v ?? '')

  return m ? m[0] : null
}

export function serviceRows(inv: CephInventory): ServiceRow[] {
  const nodeOf = (host: string) => resolvePveNode(host, inv.pveNodes)
  const rows: ServiceRow[] = []

  for (const m of inv.monitors.list) {
    // PVE keeps a stopped monitor in its list, with state "stopped": it is shown as such, not as a mere gap in the quorum.
    const stopped = typeof m.state === 'string' && m.state.toLowerCase() === 'stopped'

    rows.push({
      kind: 'mon', service: `mon.${m.name}`, host: m.host, node: nodeOf(m.host),
      state: stopped ? 'stopped' : (m.inQuorum ? 'quorum' : 'outOfQuorum'), rawState: null, dot: m.inQuorum && !stopped ? 'ok' : 'warn',
      leader: m.leader, rank: m.rank ?? null, addr: tidyAddr(m.addr), version: normalizeCephVersion(m.version), running: m.inQuorum && !stopped,
    })
  }

  const managers = [...(inv.managers.active ? [{ ...inv.managers.active, active: true }] : []), ...inv.managers.standbys.map(s => ({ ...s, active: false }))]

  for (const g of managers) {
    rows.push({
      kind: 'mgr', service: `mgr.${g.name}`, host: g.host, node: nodeOf(g.host),
      state: g.active ? 'active' : 'standby', rawState: null, dot: g.active ? 'ok' : 'info',
      leader: false, rank: null, addr: tidyAddr(g.addr), version: normalizeCephVersion(g.version), running: true,
    })
  }

  for (const g of inv.managers.stopped ?? []) {
    rows.push({
      kind: 'mgr', service: `mgr.${g.name}`, host: g.host, node: nodeOf(g.host),
      state: 'stopped', rawState: null, dot: 'warn',
      leader: false, rank: null, addr: tidyAddr(g.addr), version: normalizeCephVersion(g.version), running: false,
    })
  }

  for (const d of inv.mds.list) {
    const s = mdsState(d.state)

    rows.push({
      kind: 'mds', service: `mds.${d.name}`, host: d.host, node: nodeOf(d.host),
      state: s.state, rawState: s.state === 'other' ? d.state : null, dot: s.dot,
      leader: false, rank: typeof d.rank === 'number' ? d.rank : null, addr: tidyAddr(d.addr), version: normalizeCephVersion(d.version), running: s.running,
    })
  }

  // PVE lists the daemons in no fixed order: by name, so a row does not jump between two reads.
  const rank = (k: ServiceKind) => SERVICE_KINDS.indexOf(k)

  return rows.sort((a, b) => rank(a.kind) - rank(b.kind) || a.service.localeCompare(b.service, undefined, { numeric: true }))
}

export interface VersionCount {
  version: string
  count: number
}

/**
 * The versions of the daemons in service (mon, mgr, mds and, when the inventory carries it, OSD),
 * most frequent first. A daemon without a reported version is not counted.
 */
export function runningVersions(inv: CephInventory, rows: ServiceRow[]): VersionCount[] {
  const counts = new Map<string, number>()
  const add = (v: string | null | undefined) => {
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
  }

  for (const r of rows) if (r.running) add(r.version)
  for (const o of inv.osds.list) if (o.up) add(normalizeCephVersion(o.version))

  return [...counts.entries()]
    .map(([version, count]) => ({ version, count }))
    .sort((a, b) => b.count - a.count || a.version.localeCompare(b.version, undefined, { numeric: true }))
}

/** The nodes that do not run a daemon of that kind yet: where it can be created. */
export function nodesWithout(kind: 'mon' | 'mgr', inv: CephInventory, rows: ServiceRow[]): string[] {
  const used = new Set(rows.filter(r => r.kind === kind && r.node).map(r => r.node))

  return (inv.pveNodes ?? []).filter(n => !used.has(n))
}
