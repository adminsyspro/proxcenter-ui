export type { CephLive } from './live'

export interface CephHealthIssue {
  name: string
  severity: 'HEALTH_ERR' | 'HEALTH_WARN' | string
  summary: string
  detail: { message: string }[]
}

export type CockpitTab = 'overview' | 'osd' | 'pools' | 'crush' | 'services' | 'perf'

export type CockpitItem =
  | { kind: 'osd'; id: number }
  | { kind: 'pool'; name: string }
  | { kind: 'service'; name: string }

export type OsdFilter = 'all' | 'problem' | 'down' | 'out'

export type CephRange = 'live' | '1h' | '24h' | '7d' | '30d'

export interface CephCrushNode {
  id: number
  name: string
  type: string
  type_id?: number
  status?: string
  children?: CephCrushNode[]
}

export interface CephCrushRuleStep {
  op: string
  type: string
  num: number
  item: number
  item_name: string
}

export interface CephCrushRule {
  id: number
  name: string
  steps: CephCrushRuleStep[]
}

/**
 * Objet `cephData` rendu par GET /api/v1/connections/[id]/ceph (champ `data`).
 * Reflet de la construction dans la route : si la route change, ce type suit.
 */
export interface CephInventory {
  hasCeph: true
  nodeName: string
  /** The PVE nodes of the connection, as /nodes lists them: where an OSD's CRUSH host is resolved to a node. */
  pveNodes?: string[]
  /** PVE status of each node of `pveNodes` (online, offline, unknown, maintenance...): the dot of the node glyph. */
  pveNodeStatus?: Record<string, string>
  health: {
    status: string
    checks: CephHealthIssue[]
    numChecks: number
  }
  capacity: {
    totalBytes: number
    usedBytes: number
    availBytes: number
    usedPct: number
    totalFormatted: string
    usedFormatted: string
    availFormatted: string
    rawTotalBytes: number
    rawUsedBytes: number
    rawTotalFormatted: string
    rawUsedFormatted: string
  }
  performance: {
    readBytesSec: number
    writeBytesSec: number
    readOpsSec: number
    writeOpsSec: number
    readFormatted: string
    writeFormatted: string
    totalIops: number
  }
  pgs: {
    total: number
    states: { state_name: string; count: number }[]
  }
  osds: {
    total: number
    up: number
    in: number
    down: number
    out: number
    list: {
      id: number
      name: string
      host: string
      status: string
      up: boolean
      in: boolean
      deviceClass: string
      totalBytes: number
      usedBytes: number
      availBytes: number
      usedPct: number
      commitLatencyMs: number
      applyLatencyMs: number
      reweight?: number
      pgs?: number
      version: string | null
      /** bluestore, from PVE's osdtype. */
      osdType?: string | null
      /** Block device of the data, of the DB and of the WAL (null: none, or not reported). */
      dataDevice?: string | null
      dbDevice?: string | null
      walDevice?: string | null
    }[]
  }
  monitors: {
    total: number
    inQuorum: number
    quorumNames: string[]
    list: {
      name: string
      host: string
      addr: string
      rank?: number
      inQuorum: boolean
      leader: boolean
      /** ceph_version_short of PVE's monitor list; null when not reported. */
      version?: string | null
      /** The service state PVE reports ("running", "stopped"); absent on older servers. */
      state?: string | null
      storeStats: unknown
    }[]
  }
  /**
   * Free space of the filesystem of each monitor's node (rootfs of /nodes/{n}/status, the base Ceph itself uses for MON_DISK_*).
   * A node that could not be read has no entry. Absent on older servers.
   */
  monDisk?: { mon: string; node: string; availBytes: number; totalBytes: number; availPct: number }[]
  pools: {
    total: number
    list: {
      id: number
      name: string
      size: number
      minSize: number
      pgNum: number
      /** PG count the cluster is moving to (autoscale_status.pg_num_target); equals pgNum when nothing is under way. */
      pgNumTarget: number
      /** What the autoscaler would pick (pg_num_ideal) and what it will settle on (pg_num_final): recommendations, null when not reported. */
      pgNumIdeal?: number | null
      pgNumFinal?: number | null
      type: string
      application: 'cephfs' | 'rbd'
      crushRule: number
      crushRuleName: string | null
      crushRootId: number | null
      pgAutoscaleMode: string
      bytesUsed: number
      maxAvail: number
      objects: number
      bytesUsedFormatted: string
      maxAvailFormatted: string
      percentUsed: number
      /** Quotas of the pool, when the route reports them (0 or absent: none). PVE's pool list does not carry them today. */
      quotaBytes?: number
      quotaObjects?: number
    }[]
  }
  mds: {
    total: number
    list: {
      name: string
      host: string
      addr: string
      state: string
      rank?: number
      version?: string | null
    }[]
  }
  crushTree: CephCrushNode[]
  crushRules: CephCrushRule[]
  managers: {
    active: { name: string; host: string; version?: string | null; addr?: string | null } | null
    standbys: { name: string; host: string; version?: string | null; addr?: string | null }[]
    /** Managers PVE lists that the mgrmap does not carry (stopped daemons): listed so that they can be started again. Absent on older servers. */
    stopped?: { name: string; host: string; version?: string | null; addr?: string | null }[]
  }
}

/** Element OSD de l'inventaire (`osds.list`). */
export type CephOsd = CephInventory['osds']['list'][number]
