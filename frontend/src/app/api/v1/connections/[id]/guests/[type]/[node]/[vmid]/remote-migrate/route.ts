import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"
import { getTenantInfrastructureScope, canMigrateConnections } from "@/lib/tenant/infraScope"
import { watchMigrationAndCleanup } from "@/lib/migration/cross-cluster-watcher"
import { failMove, finalizeMove, heartbeatMove } from "@/lib/vdc/move/runner"
import { recordProviderMigrationAsMove } from "@/lib/vdc/move/service"
import { assertVmid, assertNodeName } from "@/lib/ssh/validate"
import { buildRemoteMigrateEndpoint } from "@/lib/migration/remoteMigrateEndpoint"

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
    // migration lands on the user-selected host (issue #282), and pin the
    // node's pveproxy certificate read through the authenticated target API.
    const endpoint = await buildRemoteMigrateEndpoint(targetConn, safeTargetNode)
    if (!endpoint.ok) {
      return NextResponse.json({ error: endpoint.error }, { status: 400 })
    }
    if (!endpoint.apiFingerprint) {
      console.warn(`[remote-migrate] target API exposes no certificate fingerprint for ${safeTargetNode}; trusting the TLS capture from ${endpoint.host}`)
    }
    const targetHost = endpoint.host
    const targetEndpoint = endpoint.endpoint

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
    let vdcLink: { moveId: string; targetVdcName: string } | null = null
    if (typeof result === 'string' && result.startsWith('UPID:')) {
      const resolvedTargetVmid = targetVmid !== undefined && targetVmid !== null && targetVmid !== ''
        ? String(targetVmid)
        : safeVmid
      // #1335: a guest of a vDC joins the tenant's vDC on the target cluster
      // (pool, storage-policy caps, IPAM) instead of landing outside any vDC.
      vdcLink = await recordProviderMigrationAsMove({
        sourceConnectionId: id,
        sourceNode: safeNode,
        vmid: Number(safeVmid),
        targetConnectionId,
        targetNode: safeTargetNode,
        targetVmid: Number(resolvedTargetVmid),
        targetStorage,
        targetBridge,
        online: !!online,
        deleteSource: !!deleteSource,
        upid: result,
      }).catch((err) => {
        console.warn('[remote-migrate] vDC link not recorded:', String(err?.message || err).replace(/[\r\n]/g, ''))
        return null
      })
      const linkedMoveId = vdcLink?.moveId
      let lastBeat = 0

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
        targetVmid: resolvedTargetVmid,
        restore: restore && typeof restore === 'object' ? restore : undefined,
        onPoll: linkedMoveId
          ? async () => {
              if (Date.now() - lastBeat < 30_000) return
              lastBeat = Date.now()
              await heartbeatMove(linkedMoveId)
            }
          : undefined,
      }).then(async (outcome) => {
        if (!linkedMoveId) return
        if (outcome.outcome === 'completed') await finalizeMove(linkedMoveId, !!deleteSource && outcome.sourceLeft)
        else await failMove(linkedMoveId, 'The cross-cluster migration did not complete; the VM stays in its source vDC')
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
        targetVdc: vdcLink ? { moveId: vdcLink.moveId, name: vdcLink.targetVdcName } : null,
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
