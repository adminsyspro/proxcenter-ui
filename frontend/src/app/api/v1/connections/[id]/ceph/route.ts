import { NextResponse } from "next/server"

import { flattenOsdTree, osdUpIn } from "@/lib/ceph/osdList"
import { resolvePveNode } from "@/lib/ceph/osdTable"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { formatBytes } from "@/utils/format"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { denyIaasTenantCeph } from "@/lib/ceph/tenantGuard"

export const runtime = "nodejs"

function formatBytesPerSec(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B/s'
  const k = 1024
  const sizes = ['B/s', 'KiB/s', 'MiB/s', 'GiB/s', 'TiB/s']
  const i = Math.floor(Math.log(bytes) / Math.log(k))


return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

/** A byte count from PVE: a finite number >= 0, else 0. */
const bytesOf = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", id)
    if (denied) return denied
    // Ceph is a whole-cluster object: an IaaS tenant gets 404, before any PVE call.
    const cephDenied = await denyIaasTenantCeph()
    if (cephDenied) return cephDenied

    const conn = await getConnectionById(id)

    // Récupérer la liste des nodes pour trouver un node avec Ceph
    const nodes = await pveFetch<any[]>(conn, "/nodes")

    if (!nodes || nodes.length === 0) {
      return NextResponse.json({ error: "No nodes found" }, { status: 404 })
    }

    // Trouver un node online pour interroger Ceph
    const onlineNode = nodes.find(n => n.status === 'online') || nodes[0]
    const nodeName = onlineNode.node

    // Récupérer les données Ceph en parallèle
    // The nodes that carry a monitor are only known once the monitor list is read: their /status follows it inside the same settled batch.
    const monWithDisk = pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(nodeName)}/ceph/mon`).then(async list => {
      const mons = (Array.isArray(list) ? list : []).filter((m: any) => typeof m?.name === 'string')
      const pveNodes = nodes.map((n: any) => n?.node).filter((n: unknown): n is string => typeof n === 'string')
      const online = new Set(nodes.filter((n: any) => n?.status === 'online').map((n: any) => n.node))
      // The PVE node of a monitor: its host, else its name, matched tolerantly (short name against FQDN) like the OSD hosts.
      const monNode = (m: any): string | null => (typeof m.host === 'string' ? resolvePveNode(m.host, pveNodes) : null) ?? resolvePveNode(m.name, pveNodes)
      const statuses = await Promise.allSettled(
        mons.map(async m => {
          const node = monNode(m)

          if (!node || !online.has(node)) throw new Error('node not readable')

          return pveFetch<any>(conn, `/nodes/${encodeURIComponent(node)}/status`)
        }),
      )

      return { list, statuses, mons, monNode }
    })

    const [statusResult, osdResult, monResult, poolsResult, mdsResult, rulesResult, fsResult, mgrResult] = await Promise.allSettled([
      pveFetch<any>(conn, `/nodes/${encodeURIComponent(nodeName)}/ceph/status`),
      pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(nodeName)}/ceph/osd`),
      monWithDisk,
      pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(nodeName)}/ceph/pool`),
      pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(nodeName)}/ceph/mds`),
      pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(nodeName)}/ceph/rules`),
      pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(nodeName)}/ceph/fs`),
      pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(nodeName)}/ceph/mgr`),
    ])

    const status = statusResult.status === 'fulfilled' ? statusResult.value : null
    const osdList = osdResult.status === 'fulfilled' ? osdResult.value : []
    const monList = monResult.status === 'fulfilled' ? monResult.value.list : []
    const poolList = poolsResult.status === 'fulfilled' ? poolsResult.value : []
    const mdsList = mdsResult.status === 'fulfilled' ? mdsResult.value : []
    const rulesList = rulesResult.status === 'fulfilled' ? rulesResult.value : []
    const fsList = fsResult.status === 'fulfilled' ? fsResult.value : []
    // Version and address of the managers by daemon name; the list is only read for that, so a failure leaves them null.
    const mgrInfo = new Map<string, { version: string | null; addr: string | null }>()
    // Exact name first, else the one daemon whose name matches by first label (short name against FQDN).
    const mgrOf = (name: string) => {
      const exact = mgrInfo.get(name)
      if (exact) return exact
      const label = (n: string) => n.split('.')[0].toLowerCase()
      const hits = [...mgrInfo.entries()].filter(([k]) => label(k) === label(name))

      return hits.length === 1 ? hits[0][1] : undefined
    }
    for (const m of (mgrResult.status === 'fulfilled' && Array.isArray(mgrResult.value) ? mgrResult.value : [])) {
      if (m?.name) mgrInfo.set(String(m.name), { version: m.ceph_version_short || m.version || null, addr: m.addr || null })
    }

    // Build set of CephFS pool names (data + metadata pools) to distinguish from RBD pools
    const cephFSPoolNames = new Set<string>()
    for (const fs of (fsList || [])) {
      if (fs.data_pool) cephFSPoolNames.add(fs.data_pool)
      if (fs.metadata_pool) cephFSPoolNames.add(fs.metadata_pool)
    }

    // Si pas de status Ceph, le cluster n'a probablement pas Ceph
    if (!status) {
      return NextResponse.json({ 
        error: "Ceph not available on this cluster",
        hasCeph: false 
      }, { status: 404 })
    }

    // Parser le statut de santé
    const health = status.health?.status || 'UNKNOWN'
    const healthChecks = status.health?.checks || {}
    
    // Parser les checks de santé en liste
    const healthIssues: any[] = []

    for (const [checkName, checkData] of Object.entries(healthChecks)) {
      const data = checkData as any

      // A muted check is already left out of the state of Ceph.
      if (data?.muted === true) continue

      healthIssues.push({
        name: checkName,
        severity: data.severity || 'UNKNOWN',
        summary: data.summary?.message || checkName,
        detail: data.detail || []
      })
    }

    // Statistiques du cluster
    const pgmap = status.pgmap || {}
    // RAW capacity from pgmap (total physical disk space, before replication)
    const rawTotalBytes = pgmap.bytes_total || 0
    const rawUsedBytes = pgmap.bytes_used || 0
    const rawAvailBytes = pgmap.bytes_avail || 0

    // Effective capacity (accounting for replication factor) from pool stats
    // bytes_used per pool is RAW (includes replicas), divide by pool size for logical
    // max_avail already accounts for the replication overhead
    // Effective capacity using data_bytes (logical data, no replication overhead)
    // and bytes_avail / avg replication factor for available space
    const poolsArr = Array.isArray(poolList) ? poolList : []
    const avgReplication = poolsArr.length > 0
      ? poolsArr.reduce((sum: number, p: any) => sum + (p.size || 3), 0) / poolsArr.length
      : 3
    const dataBytes = pgmap.data_bytes || 0
    const effectiveAvailBytes = rawAvailBytes > 0 ? rawAvailBytes / avgReplication : 0
    const effectiveTotalBytes = dataBytes + effectiveAvailBytes

    const totalBytes = effectiveTotalBytes > 0 ? effectiveTotalBytes : rawTotalBytes
    const usedBytes = effectiveTotalBytes > 0 ? dataBytes : rawUsedBytes
    const availBytes = effectiveTotalBytes > 0 ? effectiveAvailBytes : rawAvailBytes
    const usedPct = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100 * 10) / 10 : 0

    // Performance
    const readBytesSec = pgmap.read_bytes_sec || 0
    const writeBytesSec = pgmap.write_bytes_sec || 0
    const readOpsSec = pgmap.read_op_per_sec || 0
    const writeOpsSec = pgmap.write_op_per_sec || 0

    // PGs
    const numPgs = pgmap.num_pgs || 0
    const pgStates = pgmap.pgs_by_state || []

    // OSD stats
    const osdmap = status.osdmap?.osdmap || status.osdmap || {}
    const numOsds = osdmap.num_osds || 0
    const numUpOsds = osdmap.num_up_osds || 0
    const numInOsds = osdmap.num_in_osds || 0

    // Monmap
    const monmap = status.monmap || {}
    const numMons = monmap.num_mons || (monList?.length || 0)
    const quorum = status.quorum_names || []

    // Managers (mgr) placement, derived from the mgrmap. mgr daemon names are
    // the hostname (possibly FQDN), so host = name before the first dot.
    const mgrmap = status.mgrmap || {}
    const mgrHost = (n: any) => String(n || "").split(".")[0]
    const mgrLabel = (n: string) => n.split('.')[0].toLowerCase()
    const mgrmapNames = [
      ...(mgrmap.active_name ? [String(mgrmap.active_name)] : []),
      ...(Array.isArray(mgrmap.standbys) ? mgrmap.standbys : []).map((s: any) => String(s?.name ?? s)),
    ]
    const mgrmapLabels = new Set(mgrmapNames.map(mgrLabel))
    // A manager that is stopped is not in the mgrmap (the cluster forgets it after a few seconds) but PVE still lists it, with state "stopped":
    // it is kept so that it can be started again from the cockpit. With no mgrmap to compare to, only the state that PVE reports counts.
    const pveMgrs: any[] = mgrResult.status === 'fulfilled' && Array.isArray(mgrResult.value) ? mgrResult.value : []
    const stoppedMgrs = pveMgrs
      .filter(m => typeof m?.name === 'string' && m.name !== '')
      .filter(m => String(m.state).toLowerCase() === 'stopped' || (mgrmapLabels.size > 0 && !mgrmapLabels.has(mgrLabel(m.name))))
    const stoppedLabels = new Set(stoppedMgrs.map(m => mgrLabel(m.name)))
    const mgrEntry = (name: string) => ({ name, host: mgrHost(name), version: mgrOf(name)?.version ?? null, addr: mgrOf(name)?.addr ?? null })
    const managers = {
      active: mgrmap.active_name && !stoppedLabels.has(mgrLabel(String(mgrmap.active_name))) ? mgrEntry(mgrmap.active_name) : null,
      standbys: (Array.isArray(mgrmap.standbys) ? mgrmap.standbys : [])
        .map((s: any) => s?.name ?? String(s))
        .filter((name: string) => !stoppedLabels.has(mgrLabel(name)))
        .map(mgrEntry),
      stopped: stoppedMgrs
        .map(m => ({ name: String(m.name), host: strOrNull(m.host) ?? mgrHost(m.name), version: m.ceph_version_short || m.version || null, addr: m.addr || null }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    }

    // Mapper les OSDs avec plus de détails
    // Les OSDs peuvent être dans un format arborescent dans Proxmox
    // Extract CRUSH tree hierarchy preserving root → datacenter → host → osd nesting
    const extractCrushTree = (items: any[]): any[] => {
      return items.map(item => {
        const node: any = {
          id: item.id,
          name: item.name,
          type: item.type || (typeof item.id === 'number' && item.id >= 0 ? 'osd' : 'unknown'),
        }
        if (item.type_id !== undefined) node.type_id = item.type_id
        if (item.status) node.status = item.status
        if (item.children && Array.isArray(item.children)) {
          node.children = extractCrushTree(item.children)
        }
        return node
      })
    }

    const flatOsdList = flattenOsdTree(osdList)

    // Extract full CRUSH tree hierarchy
    let crushTree: any[] = []
    if (Array.isArray(osdList)) {
      if (osdList.length > 0 && osdList[0]?.children) {
        crushTree = extractCrushTree(osdList)
      } else if (osdList.length > 0 && osdList[0]?.root?.children) {
        crushTree = extractCrushTree(osdList[0].root.children)
      }
    } else if (osdList && typeof osdList === 'object') {
      if ((osdList as any).root?.children) {
        crushTree = extractCrushTree((osdList as any).root.children)
      }
    }

    // Parse CRUSH rules
    const crushRules = (Array.isArray(rulesList) ? rulesList : []).map((rule: any) => ({
      id: rule.rule_id ?? rule.ruleset ?? rule.id ?? 0,
      name: rule.rule_name ?? rule.name ?? '',
      steps: (rule.steps || []).map((step: any) => ({
        op: step.op || '',
        type: step.type || '',
        num: step.num ?? 0,
        item: step.item ?? -1,
        item_name: step.item_name || '',
      })),
    }))

    const osds = flatOsdList
      .filter((osd: any) => osd.id !== undefined)
      .map((osd: any) => {
        // Proxmox retourne up et in de différentes manières selon le format
        // Dans l'arbre CRUSH: status peut être "up" directement
        // Dans la liste plate: up=1/0
        // Parfois c'est une string "up" ou "down"
        const { up: isUp, in: isIn } = osdUpIn(osd)
        
        return {
          id: osd.id,
          name: osd.name || `osd.${osd.id}`,
          host: osd.host || osd.crush_location?.host || 'unknown',
          status: osd.status || (isUp ? 'up' : 'down'),
          up: isUp,
          in: isIn,
          deviceClass: osd.device_class || osd.class || 'unknown',

          // Taille
          totalBytes: osd.crush_weight ? osd.crush_weight * 1024 * 1024 * 1024 * 1024 : 0,
          // kb_* first; PVE 9 (Ceph 20) reports bytes_used and total_space instead
          usedBytes: osd.kb_used ? osd.kb_used * 1024 : bytesOf(osd.bytes_used),
          availBytes: osd.kb_avail
            ? osd.kb_avail * 1024
            : Math.max(0, bytesOf(osd.total_space) - bytesOf(osd.bytes_used)),
          usedPct: osd.percent_used || 0,

          // Stats
          commitLatencyMs: osd.commit_latency_ms || 0,
          applyLatencyMs: osd.apply_latency_ms || 0,
          reweight: osd.reweight,
          pgs: osd.pgs ?? osd.num_pgs,
          version: osd.ceph_version_short || osd.version || null,
          osdType: strOrNull(osd.osdtype),
          dataDevice: strOrNull(osd.blfsdev),
          dbDevice: strOrNull(osd.dbdev),
          walDevice: strOrNull(osd.waldev),
        }
      })
      .sort((a: any, b: any) => a.id - b.id)

    // Mapper les Monitors
    const monitors = (Array.isArray(monList) ? monList : []).map((mon: any) => {
      const isInQuorum = quorum.includes(mon.name)

      
return {
        name: mon.name,
        host: mon.host || mon.addr?.split(':')[0] || 'unknown',
        addr: mon.addr || '',
        rank: mon.rank,
        inQuorum: isInQuorum,
        leader: quorum[0] === mon.name,
        version: mon.ceph_version_short || null,
        // "running" or "stopped" as PVE reports the service: a stopped monitor stays listed so that it can be started again.
        state: strOrNull(mon.state),

        // Stats si disponibles
        storeStats: mon.store_stats || null,
      }
    })

    // Free space of each monitor's node: rootfs.avail / rootfs.total is the base Ceph uses (/nodes disk and maxdisk differ by the reserved blocks).
    const monDisk: { mon: string; node: string; availBytes: number; totalBytes: number; availPct: number }[] = []

    if (monResult.status === 'fulfilled') {
      const { mons, statuses, monNode } = monResult.value

      mons.forEach((m: any, i: number) => {
        const st = statuses[i]

        if (st.status !== 'fulfilled') return
        const total = bytesOf(st.value?.rootfs?.total)
        const avail = bytesOf(st.value?.rootfs?.avail)

        if (total === 0) return
        monDisk.push({ mon: String(m.name), node: monNode(m) as string, availBytes: avail, totalBytes: total, availPct: Math.round((avail / total) * 1000) / 10 })
      })
    }

    // Mapper les pools
    const pools = (Array.isArray(poolList) ? poolList : []).map((pool: any) => {
      const stats = pool.statistics || pool.stats || {}
      const poolName = pool.pool_name || pool.name || `pool-${pool.pool}`


return {
        id: pool.pool,
        name: poolName,
        size: pool.size || 3,
        minSize: pool.min_size || 2,
        pgNum: pool.pg_num || 0,
        // pg_num_target is the PG count the cluster is moving to (it differs from pg_num while a
        // split or merge is under way). PVE puts it in autoscale_status. pg_num_ideal is what the
        // autoscaler would pick and pg_num_final is what it will settle on: recommendations, not targets.
        pgNumTarget: pool.autoscale_status?.pg_num_target || pool.pg_num_target || pool.pg_num || 0,
        pgNumIdeal: pool.autoscale_status?.pg_num_ideal ?? null,
        pgNumFinal: pool.autoscale_status?.pg_num_final ?? pool.pg_num_final ?? null,

        // Type
        type: pool.type || 'replicated',

        // Application (rbd vs cephfs)
        application: cephFSPoolNames.has(poolName) ? 'cephfs' : 'rbd',

        // Crush rule (name comes straight from the pool; the /ceph/rules
        // endpoint is often bare). crushRootId resolves to a target bucket.
        crushRule: pool.crush_rule || 0,
        crushRuleName: pool.crush_rule_name || null,
        crushRootId: pool.autoscale_status?.crush_root_id ?? null,

        // Autoscale
        pgAutoscaleMode: pool.pg_autoscale_mode || 'unknown',

        // Stats
        bytesUsed: stats.bytes_used || pool.bytes_used || 0,
        maxAvail: stats.max_avail || pool.max_avail || 0,
        objects: stats.objects || pool.objects || 0,

        // Formaté
        bytesUsedFormatted: formatBytes(stats.bytes_used || pool.bytes_used || 0),
        maxAvailFormatted: formatBytes(stats.max_avail || pool.max_avail || 0),
        percentUsed: pool.percent_used || 0,
      }
    })

    // Mapper les MDS (Metadata Servers pour CephFS)
    const mdsServers = (Array.isArray(mdsList) ? mdsList : []).map((mds: any) => {
      return {
        name: mds.name,
        host: mds.host || mds.addr?.split(':')[0] || 'unknown',
        addr: mds.addr || '',
        state: mds.state || 'unknown',
        rank: mds.rank,
        version: mds.ceph_version_short || null,
      }
    })

    // Construire la réponse
    const cephData = {
      hasCeph: true,
      nodeName,
      pveNodes: nodes.map((n: any) => n?.node).filter((n: unknown): n is string => typeof n === 'string'),
      // Status PVE de chaque noeud (online, offline, unknown...), lu dans le meme /nodes : pastille des glyphes du cockpit.
      pveNodeStatus: Object.fromEntries(
        nodes.filter((n: any) => typeof n?.node === 'string').map((n: any) => [n.node, typeof n.status === 'string' ? n.status : 'unknown']),
      ) as Record<string, string>,
      
      // Santé
      health: {
        status: health,
        checks: healthIssues,
        numChecks: healthIssues.length,
      },

      // Capacité (effective, accounting for replication)
      capacity: {
        totalBytes,
        usedBytes,
        availBytes,
        usedPct,
        totalFormatted: formatBytes(totalBytes),
        usedFormatted: formatBytes(usedBytes),
        availFormatted: formatBytes(availBytes),
        // RAW (physical disk totals, before replication)
        rawTotalBytes,
        rawUsedBytes,
        rawTotalFormatted: formatBytes(rawTotalBytes),
        rawUsedFormatted: formatBytes(rawUsedBytes),
      },

      // Performance
      performance: {
        readBytesSec,
        writeBytesSec,
        readOpsSec,
        writeOpsSec,
        readFormatted: formatBytesPerSec(readBytesSec),
        writeFormatted: formatBytesPerSec(writeBytesSec),
        totalIops: readOpsSec + writeOpsSec,
      },

      // PGs
      pgs: {
        total: numPgs,
        states: pgStates,
      },

      // OSDs
      osds: {
        total: numOsds,
        up: numUpOsds,
        in: numInOsds,
        down: numOsds - numUpOsds,
        out: numOsds - numInOsds,
        list: osds,
      },

      // Monitors
      monitors: {
        total: numMons,
        inQuorum: quorum.length,
        quorumNames: quorum,
        list: monitors,
      },

      monDisk,

      // Pools
      pools: {
        total: pools.length,
        list: pools,
      },

      // MDS (CephFS)
      mds: {
        total: mdsServers.length,
        list: mdsServers,
      },

      // CRUSH topology
      crushTree,
      crushRules,
      managers,
    }

    return NextResponse.json({ data: cephData })
  } catch (e: any) {
    // Si erreur 501 ou 500, Ceph n'est probablement pas installé
    if (e?.message?.includes('501') || e?.message?.includes('not installed')) {
      return NextResponse.json({ 
        error: "Ceph not installed on this cluster",
        hasCeph: false 
      }, { status: 404 })
    }

    console.error("[ceph] GET Error:", String(e?.message).replace(/[\r\n]/g, ""))
    return NextResponse.json({ error: "Failed to read the Ceph data" }, { status: 500 })
  }
}
