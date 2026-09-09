import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { isSharedStorage, vmDiskFormats } from "@/lib/proxmox/storage"
import { formatBytes } from "@/utils/format"
import { checkPermission, getRequestGuestScopePerimeter, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId, getSessionPrisma } from "@/lib/tenant"
import { getTenantInfrastructureScope, maskingScope } from "@/lib/tenant/infraScope"
import { attachPbsStorage, PbsAttachError } from "@/lib/storage/attachPbsStorage"
import { audit } from "@/lib/audit"

export const runtime = "nodejs"

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    // connection.view (not storage.view) so tenant admins can see the list.
    // The endpoint already filters results by vDC scope below, so a tenant
    // only sees the storages actually assigned to their vDC.
    //
    // Flat-scoped callers (vm/tag/pool) never match a connection-scoped check,
    // so they used to 403 here and the Create VM wizard showed an empty
    // Storage dropdown (issue #262). They come in through the guest-derived
    // perimeter instead, and the payload is narrowed to it further down.
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", id)
    const perimeter = denied ? await getRequestGuestScopePerimeter(id) : null

    if (denied && !(perimeter?.holdsPermission && perimeter.hasVisibleGuests)) return denied

    const conn = await getConnectionById(id)

    // Récupérer les ressources de type storage via /cluster/resources
    const resources = await pveFetch<any[]>(conn, "/cluster/resources")
    
    const storageResources = resources.filter((r) => r?.type === "storage")

    // Récupérer aussi la config des storages pour avoir plus d'infos
    // On va récupérer la liste des storages configurés
    let storageConfigs: any[] = []

    try {
      storageConfigs = await pveFetch<any[]>(conn, "/storage")
    } catch {
      // Pas grave si on n'a pas accès
    }

    // Créer un map des configs par storage name
    const configMap = new Map<string, any>()

    for (const cfg of storageConfigs) {
      if (cfg?.storage) {
        configMap.set(cfg.storage, cfg)
      }
    }

    // Mapper les storages
    const storages = storageResources.map((r) => {
      const config = configMap.get(r.storage) || {}
      const used = Number(r.disk || 0)
      const total = Number(r.maxdisk || 0)
      const usedPct = total > 0 ? Math.round((used / total) * 100 * 10) / 10 : 0

      // Déterminer le type de storage
      let storageType = config.type || 'unknown'
      
      // Déterminer si c'est un stockage partagé ou local
      const isShared = isSharedStorage({ shared: config.shared, type: storageType })

      // Déterminer les contenus supportés
      const content = config.content ? String(config.content).split(',') : []

      return {
        id: `${r.storage}-${r.node}`,
        storage: r.storage,
        node: r.node,
        type: storageType,
        status: r.status || (r.disk !== undefined ? 'available' : 'unknown'),
        enabled: config.disable !== 1,
        shared: isShared,
        content: content,
        
        // Capacité
        used: used,
        total: total,
        usedFormatted: formatBytes(used),
        totalFormatted: formatBytes(total),
        usedPct: usedPct,
        free: total - used,
        freeFormatted: formatBytes(total - used),

        // Config additionnelle
        path: config.path || null,
        server: config.server || null,
        export: config.export || null,
        pool: config.pool || null,
        monhost: config.monhost || null,
        
        // Pour Ceph
        fsName: config['fs-name'] || null,
        
        // Pour PBS
        datastore: config.datastore || null,
        fingerprint: config.fingerprint || null,

        // Formats acceptés pour un disque de VM (issue #735) : dépend de la
        // config du stockage, pas seulement de son type depuis PVE 9.
        ...vmDiskFormats({ ...config, type: storageType }),
      }
    })

    // Agréger les storages partagés (même nom sur plusieurs nodes)
    const aggregatedMap = new Map<string, any>()
    
    for (const s of storages) {
      if (s.shared) {
        // Pour les stockages partagés, on prend une seule entrée par nom de storage
        const key = `${id}:${s.storage}` // Unique par connexion + storage name

        if (!aggregatedMap.has(key)) {
          aggregatedMap.set(key, {
            ...s,
            id: key,
            nodes: [s.node],
          })
        } else {
          // Ajouter le node à la liste et mettre à jour les stats si plus récentes
          const existing = aggregatedMap.get(key)

          if (!existing.nodes.includes(s.node)) {
            existing.nodes.push(s.node)
          }


          // Garder les valeurs les plus à jour (non nulles)
          if (s.used > 0 && existing.used === 0) {
            existing.used = s.used
            existing.usedFormatted = s.usedFormatted
          }

          if (s.total > 0 && existing.total === 0) {
            existing.total = s.total
            existing.totalFormatted = s.totalFormatted
          }

          if (s.usedPct > 0 && existing.usedPct === 0) {
            existing.usedPct = s.usedPct
          }
        }
      } else {
        // Pour les stockages locaux, une entrée par node
        const key = `${id}:${s.storage}:${s.node}`

        aggregatedMap.set(key, {
          ...s,
          id: key,
          nodes: [s.node],
        })
      }
    }

    let result = Array.from(aggregatedMap.values())

    // vDC filtering: restrict to storages assigned to the tenant's vDC.
    // Drop SHARED storages (ceph, nfs, cifs, …) from tenant views — on a
    // shared pool, browsing content would leak filenames from every other
    // tenant sitting on the same backend. Super admin (scope=null) keeps
    // the full list, since they need to see shared storages to manage them.
    //
    // Exception: PVE-PBS storages (type === 'pbs'). They are technically
    // "shared" (network mount) but isolation between tenants happens at
    // the namespace level (vdc_pbs_namespaces binding), enforced on the
    // backup snapshot/file routes. Hiding PBS storages here breaks the VM
    // backup tab — `loadPveStorages` couldn't find any PVE-PBS bridge to
    // run the file-restore against.
    const tenantId = await getCurrentTenantId()
    // iaas (vDC) tenants are masked to their slice; provider + msp see the full
    // cluster (maskingScope is null for both → no filtering below).
    const vdcScope = maskingScope(await getTenantInfrastructureScope(tenantId))
    if (vdcScope) {
      const allowedStorages = vdcScope.storagesByConnection.get(id)
      const allowedNodes = vdcScope.nodesByConnection.get(id)
      if (allowedStorages && allowedNodes) {
        result = result.filter((s: any) => {
          if (!allowedStorages.has(s.storage)) return false
          if (s.shared && s.type !== 'pbs') return false
          // PBS rows are aggregated cross-node — their `node` field is
          // arbitrary (first one seen). Match against the full nodes list
          // and require at least one to be in the tenant's vDC, so a PBS
          // mounted on any reachable node passes through.
          if (s.type === 'pbs') {
            const nodes: string[] = Array.isArray(s.nodes) ? s.nodes : (s.node ? [s.node] : [])
            return nodes.some(n => allowedNodes.has(n))
          }
          // Non-shared storages are per-node — only return rows whose node
          // is actually authorised in the tenant's vDC. Avoids surfacing
          // `local` from sibling nodes the tenant can't reach anyway.
          return s.node && allowedNodes.has(s.node)
        })
      } else {
        result = []
      }
    }

    // RBAC narrowing for flat-scoped callers (vm/tag/pool). A PVE storage
    // belongs to no pool, so filtering by pool membership would return an
    // empty list and leave the Create VM wizard with nothing to pick
    // (issue #262). Return the shared storages, usable from anywhere on the
    // cluster, plus the local ones sitting on a node that already hosts one of
    // their guests. Everything else stays hidden.
    if (perimeter?.restricted) {
      result = result.filter((s: any) => {
        if (s.shared) return true
        const nodes: string[] = Array.isArray(s.nodes) ? s.nodes : s.node ? [s.node] : []
        return nodes.some(n => perimeter.nodes.has(n))
      })
    }

    // Trier: partagés d'abord, puis par utilisation décroissante
    result.sort((a, b) => {
      if (a.shared !== b.shared) return a.shared ? -1 : 1
      
return b.usedPct - a.usedPct
    })

    return NextResponse.json({ data: result })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * POST /api/v1/connections/[id]/storage
 *
 * Attaches a Proxmox Backup Server datastore to the cluster as a `pbs:`
 * storage, so adding a backup target no longer means leaving ProxCenter for
 * the Proxmox web UI (issue #890).
 *
 * Body: { type: "pbs", storage, datastore, namespace?, nodes?, pbsConnectionId }
 *
 * Only a PBS already declared as a ProxCenter connection can be attached, and
 * the credential the cluster receives is a sub-token scoped to that datastore,
 * minted here. Hand-typed server + credentials are deliberately not accepted:
 * ProxCenter must be able to revoke what it handed out.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const params = await Promise.resolve(ctx.params)
  const id = (params as any)?.id

  if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

  // Writing storage.cfg is a datacentre-level change, so it takes the same
  // grant as managing the connection itself — not storage.admin, which the
  // VM Admin role holds only to reach the storage pages.
  const denied = await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", id)

  if (denied) return denied

  // A vDC tenant reaches its provider's connection through its vDC
  // assignment, and sees a masked slice of it. Attaching a storage is a
  // cluster-wide change, so it stays with whoever owns the cluster.
  const tenantId = await getCurrentTenantId()

  if (maskingScope(await getTenantInfrastructureScope(tenantId))) {
    return NextResponse.json(
      { error: "Attaching a storage is reserved to the owner of the cluster" },
      { status: 403 },
    )
  }

  let body: any = null

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const type = String(body?.type ?? "pbs")

  if (type !== "pbs") {
    return NextResponse.json(
      { error: `Unsupported storage type "${type}": only pbs can be attached from here` },
      { status: 400 },
    )
  }

  const storage = String(body?.storage ?? "").trim()
  const pbsConnectionId = body?.pbsConnectionId ? String(body.pbsConnectionId) : null

  if (!pbsConnectionId) {
    return NextResponse.json(
      {
        error: "pbsConnectionId is required: only a backup server declared in the connections can be attached",
        code: "pbs_connection_required",
      },
      { status: 400 },
    )
  }

  try {
    const conn = await getConnectionById(id)

    // The PBS is only usable by a caller allowed to see it, or the route would
    // turn a backup.view denial into a mounted datastore.
    const pbsDenied = await checkPermission(PERMISSIONS.BACKUP_VIEW, "pbs", pbsConnectionId)

    if (pbsDenied) return pbsDenied

    const prisma = await getSessionPrisma()
    const pbsRow = await prisma.connection.findFirst({
      where: { id: pbsConnectionId, type: "pbs" },
      select: { id: true },
    })

    if (!pbsRow) return NextResponse.json({ error: "PBS connection not found" }, { status: 404 })

    const nodes: string[] = Array.isArray(body?.nodes) ? body.nodes.map((n: any) => String(n)) : []

    // An unknown node name yields a storage PVE accepts and no node can use,
    // which reads as a broken attach rather than as a typo.
    if (nodes.length) {
      const clusterNodes = await pveFetch<any[]>(conn, "/nodes")
      const known = new Set((clusterNodes || []).map((n: any) => String(n?.node)))
      const unknown = nodes.filter(n => !known.has(n))

      if (unknown.length) {
        return NextResponse.json(
          { error: `Unknown node(s) on this cluster: ${unknown.join(", ")}` },
          { status: 400 },
        )
      }
    }

    const result = await attachPbsStorage({
      pveConn: conn,
      storage,
      datastore: String(body?.datastore ?? ""),
      namespace: body?.namespace ?? "",
      nodes,
      pbsConnectionId,
    })

    await audit({
      action: "create",
      category: "storage",
      resourceType: "storage",
      resourceId: result.storage,
      resourceName: result.storage,
      status: "success",
      details: {
        connectionId: id,
        connectionName: conn.name,
        type: "pbs",
        server: result.server,
        datastore: result.datastore,
        namespace: result.namespace || null,
        nodes: result.nodes,
        credentials: result.credentials,
        pbsConnectionId,
      },
    })

    return NextResponse.json({ data: result }, { status: 201 })
  } catch (e: any) {
    const status = e instanceof PbsAttachError ? e.status : 500
    const message = e?.message || String(e)

    await audit({
      action: "create",
      category: "storage",
      resourceType: "storage",
      resourceId: storage || "(unnamed)",
      resourceName: storage || "(unnamed)",
      status: "failure",
      errorMessage: message,
      details: { connectionId: id, type: "pbs", pbsConnectionId },
    })

    return NextResponse.json(
      { error: message, ...(e instanceof PbsAttachError ? { code: e.code } : {}) },
      { status },
    )
  }
}
