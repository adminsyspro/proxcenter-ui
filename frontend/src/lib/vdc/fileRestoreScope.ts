// src/lib/vdc/fileRestoreScope.ts
// Read authorization for the file-restore routes
// (/api/v1/connections/{id}/file-restore[/download|/preview]).
//
// Those routes reach Proxmox with the connection service token, so the
// storage, volume and node they forward must stay inside what the caller's
// tenant owns on that connection.

import { NextResponse } from 'next/server'

import { prisma } from '@/lib/db/prisma'
import { getCurrentTenantId } from '@/lib/tenant'
import { getTenantInfrastructureScope } from '@/lib/tenant/infraScope'

/** Neutral refusal: never tells whether the storage, volume or backup exists. */
export const FILE_RESTORE_DENIED_MESSAGE = 'Backup not accessible'

export function fileRestoreDenied(): Response {
  return NextResponse.json({ error: FILE_RESTORE_DENIED_MESSAGE }, { status: 403 })
}

/**
 * A PBS snapshot as PVE names it on a `pbs` storage, without the storage
 * prefix: `backup/<vm|ct>/<guest id>/<RFC 3339 UTC time>`. The namespace is
 * not part of the volume, PVE takes it from the storage configuration.
 */
const PBS_SNAPSHOT_RE = /^backup\/(vm|ct)\/(\d+)\/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

export interface FileRestoreGrant {
  /** Fully qualified volume id (`<storage>:<volume>`) to forward to PVE. */
  volumeId: string
  /** Nodes the request may run on, or null when the caller is not node-restricted. */
  allowedNodes: Set<string> | null
}

/**
 * Split a volume into its storage prefix and the path inside the storage.
 * Only a leading PVE storage id counts as a prefix: a PBS snapshot path
 * carries colons in its timestamp (`backup/vm/101/2026-01-15T10:00:00Z`),
 * so "contains a colon" does not mean "already qualified".
 */
export function splitVolume(volume: string): { prefix: string | null; path: string } {
  const m = /^([A-Za-z][A-Za-z0-9\-_.]*):([\s\S]*)$/.exec(volume)
  return m ? { prefix: m[1], path: m[2] } : { prefix: null, path: volume }
}

/** Unrestricted callers: a bare volume is qualified with the storage, a prefixed one is kept. */
function qualifyVolume(storage: string, volume: string): string {
  return splitVolume(volume).prefix !== null ? volume : `${storage}:${volume}`
}

/**
 * Decide whether the current caller may browse or read files from `volume`
 * on `storage` of PVE connection `connId`.
 *
 * - Provider (default tenant): unrestricted, legacy behaviour.
 * - MSP tenant: unrestricted on a connection it owns, refused elsewhere.
 * - Any other tenant (vDC access to a shared connection), judged on the
 *   UNION of its enabled vDCs:
 *   1. the storage is one of its vDC storages on this connection;
 *   2. the volume carries no storage prefix, or exactly `<storage>:`;
 *   3. the volume is a PBS snapshot (vzdump archives are not exposed to
 *      tenants, same rule as the guest backup listing);
 *   4. the storage is a PVE `pbs` storage bound to one of its vDC PBS
 *      namespaces (vdc_pbs_pve_storages -> vdc_pbs_namespaces -> vdcs). PVE
 *      resolves the snapshot inside the namespace configured on that storage,
 *      and a namespace is bound to a single vDC, so every reachable snapshot,
 *      whatever its guest id, belongs to the tenant;
 *   5. the request runs on one of its vDC nodes when the vDC lists nodes.
 *
 * Must run before any Proxmox request. Returns the grant, or a neutral 403
 * Response to return as is.
 */
export async function authorizeFileRestore(
  connId: string,
  storage: string,
  volume: string,
): Promise<FileRestoreGrant | Response> {
  const tenantId = await getCurrentTenantId()
  // Authorization verdict: the FULL union of the tenant's vDCs, never the
  // vDC view context (a view filter, not a security boundary).
  const infra = await getTenantInfrastructureScope(tenantId, { ignoreVdcContext: true })

  if (infra.kind === 'provider') {
    return { volumeId: qualifyVolume(storage, volume), allowedNodes: null }
  }

  if (infra.kind === 'msp') {
    return infra.connectionIds.has(connId)
      ? { volumeId: qualifyVolume(storage, volume), allowedNodes: null }
      : fileRestoreDenied()
  }

  const scope = infra.vdcScope

  // 1. Storage within the tenant's vDC storages on this connection.
  if (!scope.connectionIds.has(connId)) return fileRestoreDenied()
  if (!scope.storagesByConnection.get(connId)?.has(storage)) return fileRestoreDenied()

  // 2. Volume prefix must name the same storage.
  const { prefix, path: bareVolume } = splitVolume(volume)
  if (prefix !== null && prefix !== storage) return fileRestoreDenied()

  // 3. PBS snapshots only.
  if (!PBS_SNAPSHOT_RE.test(bareVolume)) return fileRestoreDenied()

  // 4. The storage is a PBS storage bound to one of the tenant's enabled vDC
  //    namespaces on this connection.
  const binding = await prisma.vdcPbsPveStorage.findFirst({
    where: {
      pveConnectionId: connId,
      pveStorageName: storage,
      vdcPbsNamespace: { vdc: { tenantId, enabled: true, connectionId: connId } },
    },
    select: { id: true },
  })
  if (!binding) return fileRestoreDenied()

  // 5. Node restriction (an empty node list means the vDC does not restrict
  //    nodes, same reading as the storage content route).
  const nodes = scope.nodesByConnection.get(connId)
  const allowedNodes = nodes && nodes.size > 0 ? new Set(nodes) : null

  return { volumeId: `${storage}:${bareVolume}`, allowedNodes }
}

/**
 * Node to run a file-restore call on, from `/cluster/resources`: an online
 * node that has the storage available, else any node with the storage, else
 * any online node. With `allowedNodes`, only those nodes are candidates;
 * null means none qualifies.
 */
export function pickFileRestoreNode(
  resources: any[],
  storage: string,
  allowedNodes: Set<string> | null,
): string | null {
  const allowed = (n: unknown): n is string =>
    typeof n === 'string' && n !== '' && (!allowedNodes || allowedNodes.has(n))

  const storageNodes = (resources || [])
    .filter((r: any) => r?.type === 'storage' && r.storage === storage && r.status === 'available')
    .map((r: any) => r.node)
    .filter(allowed)

  const onlineNodes = (resources || [])
    .filter((r: any) => r?.type === 'node' && r.status === 'online')
    .map((r: any) => r.node)
    .filter(allowed)

  return storageNodes.find((n: string) => onlineNodes.includes(n))
    || storageNodes[0]
    || onlineNodes[0]
    || null
}
