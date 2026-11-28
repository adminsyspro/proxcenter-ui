import { NextResponse } from 'next/server'

import { licenseExcludedResponse } from '@/lib/api/response'
import { pickOnlineNode } from '@/lib/ceph/nodeNoout'
import { getConnectionById, isConnectionNotFoundError } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import type { SshTarget } from '@/lib/ssh/node-endpoint-core'
import { resolveNodeSshEndpoint } from '@/lib/ssh/node-endpoint'
import { sshTargetError, verifyNodeTarget } from '@/lib/ssh/verify-node-target'
import { existingTaskUpids, followDetachedTask, runDetached, sudoAllows, type FollowOptions } from './detachedPveceph'

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

// ---- pveceph over SSH (OSD creation and destruction, package install) ----

export type CephSsh = { ok: true; endpoint: SshTarget } | { ok: false; response: Response }

/**
 * The SSH endpoint of the node, checked to be that node, and the SSH account
 * allowed to run `argv` as root (root, or the ceph-provisioning sudo profile).
 * Asks without running anything; a refusal says what to fix.
 */
export async function prepareCephSsh(connectionId: string, conn: any, node: string, argv: string[]): Promise<CephSsh> {
  const endpoint = await resolveNodeSshEndpoint(conn, node)
  const check = await verifyNodeTarget(connectionId, conn, node, endpoint)
  if (!check.ok) return { ok: false, response: NextResponse.json({ error: check.error, code: 'SSH_UNREACHABLE' }, { status: check.status ?? 502 }) }

  const verdict = await sudoAllows(connectionId, endpoint, argv)
  if (verdict === 'ok') return { ok: true, endpoint }
  if (verdict === 'ssh-disabled') {
    return { ok: false, response: NextResponse.json({ error: 'SSH is not enabled for this connection', code: 'SSH_DISABLED' }, { status: 412 }) }
  }
  if (verdict === 'missing-rule') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'The SSH account may not run this pveceph command: grant it the ceph-provisioning sudo profile (Settings > SSH commands)', code: 'SUDO_RULE_MISSING' },
        { status: 412 },
      ),
    }
  }
  return { ok: false, response: NextResponse.json({ error: sshTargetError(node, endpoint), code: 'SSH_UNREACHABLE' }, { status: 502 }) }
}

/** The log tag of a detached pveceph: lower-case letters, digits and dashes only. */
export function pvecephTag(prefix: string, subject: string): string {
  return `${prefix}-${subject.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`.slice(0, 64)
}

/**
 * Start `argv` detached on the node and answer like the other Ceph writes:
 * 200 with the UPID of the PVE task it started, 422 with what pveceph printed
 * when it failed before any task, 202 when no task showed up in time.
 */
export async function runPvecephTask(connectionId: string, conn: any, node: string, endpoint: SshTarget, argv: string[], follow: Pick<FollowOptions, 'tag' | 'taskType' | 'taskId'>): Promise<Response> {
  // A few seconds of margin for a node clock behind ProxCenter's; the task id tells the tasks apart.
  const since = Math.floor(Date.now() / 1000) - 30
  // An earlier try on the same disk or OSD inside that margin is never this run's task.
  const exclude = await existingTaskUpids(conn, node, follow.taskType, follow.taskId, since)
  const started = await runDetached(connectionId, endpoint, argv, follow.tag)
  if ('error' in started) return NextResponse.json({ error: started.error, code: 'SSH_FAILED' }, { status: 502 })

  const outcome = await followDetachedTask(conn, connectionId, endpoint, node, { ...follow, since, exclude })
  if ('upid' in outcome) return NextResponse.json({ data: { upid: outcome.upid, node } })
  if ('failed' in outcome) return NextResponse.json({ error: 'pveceph failed', code: 'PVECEPH_FAILED', output: outcome.failed }, { status: 422 })
  return NextResponse.json({ data: { pending: true, node } }, { status: 202 })
}

/** The node is one of the connection's (PVE /nodes). */
export async function isClusterNode(conn: any, node: string): Promise<boolean> {
  const nodes = await pveFetch<any[]>(conn, '/nodes')
  return Array.isArray(nodes) && nodes.some(n => n?.node === node)
}
