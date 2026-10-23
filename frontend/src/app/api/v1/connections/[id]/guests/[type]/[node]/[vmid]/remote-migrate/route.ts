import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"
import { getTenantInfrastructureScope, canMigrateConnections } from "@/lib/tenant/infraScope"
import { watchMigrationAndCleanup } from "@/lib/migration/cross-cluster-watcher"
import { assertVmid, assertNodeName } from "@/lib/ssh/validate"
import { getNodeIp } from "@/lib/ssh/node-ip"

import { captureReplicationJobs, type CcmRestorePlan } from '@/lib/migration/ccm-prereqs'
import { withPublicApiGuard } from '@/lib/api-tokens/routeGuard'
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

type RestoreRequest = CcmRestorePlan & {
  /** Put the captured config back on the SOURCE if the migration fails. */
  rollbackOnFailure?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Ignore malformed captures before they reach the detached watcher. */
function parseRestoreRequest(value: unknown): RestoreRequest | undefined {
  if (!isRecord(value) || !isRecord(value.capture)) return undefined
  const capture = value.capture
  const optionalStrings = (record: Record<string, unknown>, keys: string[]) =>
    keys.every(key => record[key] === undefined || typeof record[key] === 'string')
  const optionalNumbers = (record: Record<string, unknown>, keys: string[]) =>
    keys.every(key => record[key] === undefined || (typeof record[key] === 'number' && Number.isFinite(record[key])))

  // Loose comparison on purpose: an absent `ha` key is as valid as an explicit
  // null, and rejecting it would silently drop the whole plan, rollback included.
  if (capture.ha != null && (
    !isRecord(capture.ha) || typeof capture.ha.sid !== 'string' || !capture.ha.sid ||
    !optionalStrings(capture.ha, ['state', 'group', 'comment']) ||
    !optionalNumbers(capture.ha, ['maxRestart', 'maxRelocate', 'failback', 'autoRebalance'])
  )) return undefined
  if (!Array.isArray(capture.replication) || !capture.replication.every(job =>
    isRecord(job) && typeof job.id === 'string' && job.id.length > 0 &&
    typeof job.guest === 'number' && Number.isSafeInteger(job.guest) && job.guest > 0 &&
    typeof job.target === 'string' &&
    optionalStrings(job, ['schedule', 'comment']) && optionalNumbers(job, ['rate', 'disable'])
  )) return undefined
  if (!Array.isArray(capture.snapshotsDeleted) || !capture.snapshotsDeleted.every(name => typeof name === 'string')) return undefined
  if (!['restoreHa', 'restoreReplication', 'rollbackOnFailure'].every(key =>
    value[key] === undefined || typeof value[key] === 'boolean'
  )) return undefined
  if (!optionalStrings(value, ['haState', 'replicationTarget', 'replicationSchedule']) ||
    !optionalNumbers(value, ['replicationRate'])) return undefined

  return { ...value, restoreHa: value.restoreHa === true, restoreReplication: value.restoreReplication === true } as RestoreRequest
}

/** `XX:XX:...` SHA-256 fingerprint, the only form that may enter the target-endpoint spec. */
const FINGERPRINT_RE = /^[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){31}$/

/**
 * SHA-256 fingerprint of the certificate pveproxy serves on `node`, read through
 * the authenticated target API: the node's own certificate list first (pveproxy
 * serves pveproxy-ssl.pem when it exists, pve-ssl.pem otherwise), then the
 * cluster node list's pve_fp. Empty when the token can read neither.
 */
async function fetchTargetNodeFingerprint(targetConn: any, node: string): Promise<string> {
  try {
    const certs = await pveFetch<any[]>(targetConn, `/nodes/${encodeURIComponent(node)}/certificates/info`)
    if (Array.isArray(certs)) {
      const served = certs.find((c: any) => c?.filename === 'pveproxy-ssl.pem') ?? certs.find((c: any) => c?.filename === 'pve-ssl.pem')
      if (typeof served?.fingerprint === 'string' && FINGERPRINT_RE.test(served.fingerprint)) return served.fingerprint
    }
  } catch {
    // The token may lack Sys.Audit on the node; the cluster list below needs less.
  }
  try {
    const nodes = await pveFetch<any[]>(targetConn, '/cluster/config/nodes')
    const entry = Array.isArray(nodes) ? nodes.find((n: any) => n?.name === node) : undefined
    if (typeof entry?.pve_fp === 'string' && FINGERPRINT_RE.test(entry.pve_fp)) return entry.pve_fp
  } catch {
    // Standalone node or no access: the caller falls back to the TLS capture.
  }
  return ''
}

/**
 * SHA-256 fingerprint of whatever certificate `host` presents on `port`, or ''
 * when it cannot be read. Nothing is verified here on purpose: the value is
 * cross-checked against (or, failing that, stands in for) the API's answer.
 */
async function captureTlsFingerprint(host: string, port: number): Promise<string> {
  try {
    const tls = await import('tls')
    const captured = await new Promise<string>((resolve, reject) => {
      const socket = tls.connect({ host, port, rejectUnauthorized: false, timeout: 10000 }, () => {
        const cert = socket.getPeerCertificate()
        socket.end()
        if (cert?.fingerprint256) resolve(cert.fingerprint256)
        else reject(new Error('No certificate fingerprint available'))
      })
      socket.on('error', reject)
      socket.on('timeout', () => {
        socket.destroy()
        reject(new Error('Connection timeout'))
      })
    })
    return FINGERPRINT_RE.test(captured) ? captured : ''
  } catch (e: any) {
    console.warn('[remote-migrate] TLS fingerprint capture failed:', String(e?.message || e).replace(/[\r\n]/g, ''))
    return ''
  }
}

/**
 * POST /api/v1/connections/{id}/guests/{type}/{node}/{vmid}/remote-migrate
 *
 * Lance une migration cross-cluster (remote_migrate) d'une VM vers un autre cluster Proxmox.
 * Utilise l'API Proxmox: POST /nodes/{node}/qemu/{vmid}/remote_migrate
 * 
 * Body params:
 * - targetConnectionId: string - ID de la connexion cible dans ProxCenter
 * - targetNode: string - Nom du nœud cible sur le cluster distant
 * - targetVmid?: number - VMID sur le cluster cible (optionnel, garde le même par défaut)
 * - targetStorage: string - Stockage cible sur le cluster distant
 * - targetBridge: string - Bridge réseau cible sur le cluster distant
 * - online?: boolean - Migration live si true (défaut: true si VM running)
 * - delete?: boolean - Supprimer la VM source après migration réussie (défaut: false)
 * - bwlimit?: number - Limite de bande passante en KiB/s (optionnel)
 */
async function handler(
  req: Request,
  ctx: { params: Promise<{ id: string; type: string; node: string; vmid: string }> }
) {
  try {
    const { id, type, node, vmid } = await ctx.params

    // Vérifier que c'est bien une VM QEMU (remote_migrate n'est pas supporté pour LXC actuellement)
    if (type !== 'qemu') {
      return NextResponse.json(
        { error: "Cross-cluster migration is currently only supported for QEMU VMs, not LXC containers" },
        { status: 400 }
      )
    }

    // Constrain the node name and VMID before either can reach a shell command
    // on the node: the fire-and-forget cleanup watcher runs `qm unlock ${vmid}`
    // over SSH, and getNodeIp() may fall back to the raw node name as the SSH
    // host. Both are re-derived here so no attacker-controlled characters flow
    // through (command injection / log injection in the SSH layer).
    let safeVmid: string
    let safeNode: string
    try {
      safeVmid = assertVmid(vmid)
      safeNode = assertNodeName(node)
    } catch {
      return NextResponse.json({ error: "Invalid node name or vmid" }, { status: 400 })
    }

    // RBAC: Check vm.migrate permission
    const resourceId = buildVmResourceId(id, safeNode, type, safeVmid)
    const denied = await checkPermission(PERMISSIONS.VM_MIGRATE, "vm", resourceId)
    if (denied) return denied

    // VM placement is a whole-cluster operation: the provider may migrate any
    // cluster it manages; an MSP tenant may migrate within clusters it OWNS;
    // vDC/iaas tenants get an abstracted slice and cannot migrate.
    const tenantId = await getCurrentTenantId()
    const infra = await getTenantInfrastructureScope(tenantId)
    if (!canMigrateConnections(infra, id)) {
      return NextResponse.json(
        { error: 'Migration is restricted to the provider or the MSP tenant that owns this connection' },
        { status: 403 },
      )
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }
    if (!body.targetConnectionId) {
      return NextResponse.json({ error: "targetConnectionId is required" }, { status: 400 })
    }
    if (typeof body.targetConnectionId !== 'string') {
      return NextResponse.json({ error: "targetConnectionId must be a string" }, { status: 400 })
    }

    // The guest lands on the TARGET cluster: vm.migrate is checked there too.
    const targetDenied = await checkPermission(PERMISSIONS.VM_MIGRATE, "connection", body.targetConnectionId)
    if (targetDenied) return targetDenied

    body.restore = parseRestoreRequest(body.restore)
    const {
      targetConnectionId,
      targetNode,
      targetVmid,
      targetStorage,
      targetBridge,
      online = true,
      delete: deleteSource = false,
      bwlimit,
      restore,
    } = body

    // MSP tenants must also own the target connection
    if (infra.kind === 'msp' && !infra.connectionIds.has(targetConnectionId)) {
      return NextResponse.json(
        { error: 'Cross-cluster migration target must be a connection owned by your tenant' },
        { status: 403 },
      )
    }
    if (!targetNode) {
      return NextResponse.json({ error: "targetNode is required" }, { status: 400 })
    }
    // The target node name is resolved to an address (DNS as a last resort) and
    // the target cluster's API token is then sent to that address: only a PVE
    // node name passes here, and below it must also be a node of that cluster.
    let safeTargetNode: string
    try {
      safeTargetNode = assertNodeName(targetNode)
    } catch {
      return NextResponse.json({ error: "Invalid targetNode" }, { status: 400 })
    }
    if (!targetStorage) {
      return NextResponse.json({ error: "targetStorage is required" }, { status: 400 })
    }
    if (!targetBridge) {
      return NextResponse.json({ error: "targetBridge is required" }, { status: 400 })
    }

    // Récupérer les informations de connexion source et cible
    const sourceConn = await getConnectionById(id)
    const targetConn = await getConnectionById(targetConnectionId)

    if (restore && typeof restore === 'object') {
      const stillReplicated = await captureReplicationJobs(sourceConn, vmid).catch(() => [])
      if (stillReplicated.length > 0) {
        return NextResponse.json(
          {
            error: `Proxmox is still removing replication job(s) ${stillReplicated.map(j => j.id).join(', ')} for this VM. Cross-cluster migration stays blocked until that finishes, usually about a minute.`,
          },
          { status: 409 },
        )
      }
    }

    // The node must belong to the target cluster. The list comes through the
    // authenticated target API, so a name that is not in it never becomes a
    // resolution target or the receiver of the cluster's API token.
    let targetNodes: unknown
    try {
      targetNodes = await pveFetch<any[]>(targetConn, "/nodes")
    } catch (e: any) {
      return NextResponse.json(
        { error: `Could not list the nodes of the target cluster: ${String(e?.message || e)}` },
        { status: 400 },
      )
    }
    if (!Array.isArray(targetNodes) || !targetNodes.some((n: any) => n?.node === safeTargetNode)) {
      return NextResponse.json(
        { error: `targetNode "${safeTargetNode}" is not a node of the target cluster` },
        { status: 400 },
      )
    }

    // Resolve the target NODE's address, not the cluster baseUrl, so the
    // migration lands on the user-selected host. PVE's remote_migrate uses the
    // host:port in the target-endpoint to reach the cluster API; talking to a
    // specific node's pveproxy makes that node the receiver. Falling back to
    // the cluster baseUrl made every cross-cluster migration land on whichever
    // node baseUrl happens to point at, ignoring the user's choice (issue #282).
    const targetUrl = new URL(targetConn.baseUrl)
    const targetPort = targetUrl.port || '8006'
    const targetHost = await getNodeIp(targetConn, safeTargetNode)

    // The SHA-256 fingerprint remote_migrate pins the target to. It comes from
    // the authenticated target API first (the certificate pveproxy serves on
    // that node, then the cluster's pve_fp), so a hijacked resolution of
    // targetHost cannot hand us its own certificate. A capture from the TLS
    // handshake with targetHost is trusted on its own only when the API exposes
    // nothing; when both exist they must agree.
    const apiFingerprint = await fetchTargetNodeFingerprint(targetConn, safeTargetNode)
    const capturedFingerprint = await captureTlsFingerprint(targetHost, Number.parseInt(targetPort, 10))
    if (apiFingerprint && capturedFingerprint && apiFingerprint.toUpperCase() !== capturedFingerprint.toUpperCase()) {
      return NextResponse.json(
        {
          error: `The host resolved for node "${safeTargetNode}" (${targetHost}) does not present the certificate the target cluster reports for that node. Check the node's address (managed host / SSH address) and its pveproxy certificate before migrating.`,
        },
        { status: 400 },
      )
    }
    const targetFingerprint = apiFingerprint || capturedFingerprint
    if (!targetFingerprint) {
      return NextResponse.json(
        { error: "Could not retrieve TLS fingerprint from target cluster. Please ensure the target is reachable." },
        { status: 400 }
      )
    }
    if (!apiFingerprint) {
      console.warn(`[remote-migrate] target API exposes no certificate fingerprint for ${safeTargetNode}; trusting the TLS capture from ${targetHost}`)
    }

    // Construire le target-endpoint au format attendu par Proxmox
    // Format: apitoken=PVEAPIToken=<user>@<realm>!<token>=<secret>,host=<address>,fingerprint=<fp>[,port=<port>]
    const targetEndpointParts = [
      `apitoken=PVEAPIToken=${targetConn.apiToken}`,
      `host=${targetHost}`,
      `port=${targetPort}`,
      `fingerprint=${targetFingerprint}`,
    ]
    
    const targetEndpoint = targetEndpointParts.join(',')

    // Construire les paramètres de migration
    const migrateParams: Record<string, string> = {
      'target-endpoint': targetEndpoint,
      'target-storage': targetStorage,
      'target-bridge': targetBridge,
    }
    
    // VMID cible (optionnel)
    if (targetVmid !== undefined && targetVmid !== null && targetVmid !== '') {
      migrateParams['target-vmid'] = String(targetVmid)
    }
    
    // Migration online/offline
    if (online) {
      migrateParams['online'] = '1'
    }
    
    // Note: Proxmox remote_migrate does NOT support the 'delete' parameter.
    // Source VM deletion is handled by our task completion handler instead
    // (see /api/v1/tasks/[connectionId]/[node]/[upid]/route.ts).
    
    // Limite de bande passante
    if (bwlimit !== undefined && bwlimit !== null && bwlimit !== '') {
      migrateParams['bwlimit'] = String(bwlimit)
    }

    // Appeler l'API Proxmox pour la migration cross-cluster
    const result = await pveFetch<string>(
      sourceConn,
      `/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(vmid)}/remote_migrate`,
      {
        method: 'POST',
        body: new URLSearchParams(
          Object.entries(migrateParams).map(([k, v]) => [k, v])
        ).toString(),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    )

    // Audit
    const { audit } = await import("@/lib/audit")

    await audit({
      action: "migrate",
      category: 'vms',
      resourceType: type,
      resourceId: vmid,
      details: { sourceNode: node, targetNode: safeTargetNode, targetCluster: targetConn.name, connectionId: id, online, restore: !!restore },
    })

    // Fire-and-forget server-side watcher. Guarantees post-migration cleanup
    // (SSH unlock + optional source VM delete) even if the user closes the
    // browser tab, navigates away, or the tab is throttled in the background.
    // tenantId must be captured here while the request session is alive.
    if (typeof result === 'string' && result.startsWith('UPID:')) {
      void watchMigrationAndCleanup({
        connectionId: id,
        tenantId,
        sourceConn,
        sourceNode: safeNode,
        vmid: safeVmid,
        upid: result,
        deleteSource,
        guestType: type,
        targetConn,
        targetNode: safeTargetNode,
        targetVmid: targetVmid !== undefined && targetVmid !== null && targetVmid !== ''
          ? String(targetVmid)
          : safeVmid,
        restore: restore && typeof restore === 'object' ? restore : undefined,
      }).catch(err => {
        console.warn('[remote-migrate] background watcher failed:', String(err?.message || err).replace(/[\r\n]/g, ''))
      })
    }

    return NextResponse.json({
      success: true,
      data: result, // UPID de la tâche
      message: `Cross-cluster migration of VM ${vmid} to ${safeTargetNode}@${targetHost} started`,
      details: {
        sourceCluster: sourceConn.name,
        targetCluster: targetConn.name,
        targetNode: safeTargetNode,
        targetStorage,
        targetBridge,
        online,
        deleteSource,
      }
    })

  } catch (e: any) {
    console.error('[remote-migrate] Error:', String(e?.message || e).replace(/[\r\n]/g, ''))
    
    // Parser le message d'erreur Proxmox pour le rendre plus lisible
    let errorMessage = e?.message || String(e)
    
    // Erreurs communes
    if (errorMessage.includes('no export formats')) {
      errorMessage = 'Cloud-init drives cannot be migrated. Please remove or reconfigure the cloud-init drive before migration.'
    } else if (errorMessage.includes('permission denied') || errorMessage.includes('401')) {
      errorMessage = 'Permission denied on target cluster. Please verify the API token has sufficient permissions (VM.Migrate, Datastore.AllocateSpace, etc.)'
    } else if (errorMessage.includes('storage') && errorMessage.includes('not found')) {
      errorMessage = `Target storage not found or not accessible. Verify the storage "${errorMessage}" exists and the API token has access.`
    }
    
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}

export const POST = withAudit({ category: "vms", resourceType: "guest", resourceTypeParam: "type", resourceParam: "vmid", action: "migrate" }, withPublicApiGuard("vm-remote-migrate", handler))
