import { NextResponse } from 'next/server'

import { licenseExcludedResponse } from '@/lib/api/response'
import { pickOnlineNode } from '@/lib/ceph/nodeNoout'
import { getConnectionById, isConnectionNotFoundError } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

/*
   Shared steps of the Ceph provisioning routes (ui#1450). Each route checks
   storage.admin on the connection, then calls the IaaS tenant gate itself
   (`await denyIaasTenantCeph()` in its own source: tenantGuard.routes.test
   reads it there), then loads the connection with cephConnection. And the
   online node a cluster-wide write goes through.
*/

export type CephConnection = { ok: true; conn: any } | { ok: false; response: Response }

/** storage.admin on the connection: the first check of every provisioning route. */
export function checkCephWrite(connectionId: string) {
  return checkPermission(PERMISSIONS.STORAGE_ADMIN, 'connection', connectionId)
}

export async function cephConnection(connectionId: string): Promise<CephConnection> {
  const conn = await getConnectionById(connectionId)
  if (!conn) return { ok: false, response: NextResponse.json({ error: 'Connection not found' }, { status: 404 }) }
  return { ok: true, conn }
}

/** An online node of the cluster, `preferred` when it is online; null when none is. */
export async function onlineCephNode(conn: any, preferred = ''): Promise<string | null> {
  const status = await pveFetch<any[]>(conn, '/cluster/status').catch(() => null)
  return pickOnlineNode(status, preferred)
}

export const NO_ONLINE_NODE = () => NextResponse.json({ error: 'No node of the cluster is online' }, { status: 503 })

/** A license refusal keeps its code, a missing connection is a 404, anything else a 500 with PVE's message. */
export function provisionError(label: string, e: any, fallback: string): NextResponse {
  const excluded = licenseExcludedResponse(e)
  if (excluded) return excluded
  console.error(`[ceph/${label}] Error:`, String(e?.message).replace(/[\r\n]/g, ''))
  if (isConnectionNotFoundError(e)) return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
  return NextResponse.json({ error: e?.message || fallback }, { status: 500 })
}
