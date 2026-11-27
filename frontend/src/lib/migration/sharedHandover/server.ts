import { NextResponse } from 'next/server'

import { getConnectionById, type PveConn } from '@/lib/connections/getConnection'
import { prisma } from '@/lib/db/prisma'
import { pveFetch } from '@/lib/proxmox/client'
import { buildVmResourceId, checkPermission, PERMISSIONS } from '@/lib/rbac'
import { executeSSH } from '@/lib/ssh/exec'
import { resolveNodeSshEndpoint } from '@/lib/ssh/node-endpoint'
import { assertNodeName, assertVmid } from '@/lib/ssh/validate'
import { getCurrentTenantId } from '@/lib/tenant'
import { canMigrateConnections, getTenantInfrastructureScope } from '@/lib/tenant/infraScope'
import { guardSessionGuest } from '@/lib/vdc/guestGuard'

import type { GuestType } from './guestConf'
import { guestConfPath, type SshRunner } from './handover'

/** SSH is on for the connection and holds a credential. */
export async function sshReady(connectionId: string): Promise<boolean> {
  const row = await prisma.connection.findUnique({
    where: { id: connectionId },
    select: { sshEnabled: true, sshKeyEnc: true, sshPassEnc: true },
  })

  return !!row?.sshEnabled && !!(row.sshKeyEnc || row.sshPassEnc)
}

export async function nodeSsh(conn: PveConn, node: string): Promise<SshRunner> {
  const endpoint = await resolveNodeSshEndpoint(conn, node)

  return (command, opts) => executeSSH(conn.id, endpoint, command, 30_000, opts?.stdin === undefined ? {} : { stdin: opts.stdin })
}

/** The API view of a configuration written as lines: its main section only. */
export function configToText(config: Record<string, unknown> | null | undefined): string {
  return Object.entries(config || {})
    .filter(([key]) => key !== 'digest')
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join('\n') + '\n'
}

/**
 * The guest configuration as text: the file itself over SSH, or the API view
 * when SSH is off (enough to tell whether the move without copy is worth
 * offering; the move itself reads the file).
 */
export async function readGuestConfText(conn: PveConn, node: string, type: GuestType, vmid: string, ssh: boolean): Promise<string> {
  if (ssh) {
    const run = await nodeSsh(conn, node)
    const read = await run(`cat '${guestConfPath(node, type, vmid)}'`)
    if (read.success && read.output) return `${read.output}\n`
  }

  return configToText(await pveFetch<Record<string, unknown>>(conn, `/nodes/${encodeURIComponent(node)}/${type}/${vmid}/config`))
}

export type HandoverRequest = {
  id: string
  type: GuestType
  node: string
  vmid: string
  targetConnectionId: string
  targetNode: string
  sourceConn: PveConn
  targetConn: PveConn
  body: Record<string, unknown>
}

type Params = { id: string; type: string; node: string; vmid: string }

const deny = (error: string, status: number) => ({ ok: false as const, response: NextResponse.json({ error }, { status }) })

/**
 * The guards of the cross-cluster routes, once, over the JSON body the route
 * parsed: identifiers constrained
 * before they reach a Proxmox path or a shell, vm.migrate on the guest AND on
 * the target cluster, a tenant allowed to migrate both connections, a vDC
 * session kept to its pools, and a target node that belongs to the target
 * cluster.
 */
export async function guardHandoverRequest(
  body: unknown,
  ctx: { params: Promise<Params> },
): Promise<{ ok: true; request: HandoverRequest } | { ok: false; response: NextResponse }> {
  const { id, type, node, vmid } = await ctx.params
  if (type !== 'qemu' && type !== 'lxc') return deny('Unknown guest type', 400)

  let safeVmid: string
  let safeNode: string
  try {
    safeVmid = assertVmid(vmid)
    safeNode = assertNodeName(node)
  } catch {
    return deny('Invalid node name or vmid', 400)
  }

  const denied = await checkPermission(PERMISSIONS.VM_MIGRATE, 'vm', buildVmResourceId(id, safeNode, type, safeVmid))
  if (denied) return { ok: false, response: denied }

  if (!body || typeof body !== 'object' || Array.isArray(body)) return deny('Invalid JSON body', 400)
  const { targetConnectionId } = body as Record<string, unknown>
  if (typeof targetConnectionId !== 'string' || !targetConnectionId) return deny('targetConnectionId is required', 400)
  let safeTargetNode: string
  try {
    safeTargetNode = assertNodeName((body as Record<string, unknown>).targetNode)
  } catch {
    return deny('Invalid targetNode', 400)
  }

  const targetDenied = await checkPermission(PERMISSIONS.VM_MIGRATE, 'connection', targetConnectionId)
  if (targetDenied) return { ok: false, response: targetDenied }

  const infra = await getTenantInfrastructureScope(await getCurrentTenantId())
  if (!canMigrateConnections(infra, id, targetConnectionId)) {
    return deny('Migration is restricted to the provider or the MSP tenant that owns both connections', 403)
  }

  const sourceConn = await getConnectionById(id)
  const targetConn = await getConnectionById(targetConnectionId)
  const scopeDenied = await guardSessionGuest({ connectionId: id, conn: sourceConn, type, node: safeNode, vmid: safeVmid })
  if (scopeDenied) return { ok: false, response: scopeDenied }

  const nodes = await pveFetch<{ node?: string }[]>(targetConn, '/nodes').catch(() => null)
  if (!Array.isArray(nodes) || !nodes.some(n => n?.node === safeTargetNode)) {
    return deny(`targetNode "${safeTargetNode}" is not a node of the target cluster`, 400)
  }

  return {
    ok: true,
    request: {
      id, type, node: safeNode, vmid: safeVmid,
      targetConnectionId, targetNode: safeTargetNode,
      sourceConn, targetConn, body: body as Record<string, unknown>,
    },
  }
}
