import type { PveConn } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'

import { inspectGuestConf, type GuestType } from './guestConf'
import { configToText, sshReady } from './server'

/** Same shape as the rows of remote-migrate/check. */
export type HandoverIssue = {
  type: 'error' | 'warning'
  code: string
  message: string
  details?: string
  context?: Record<string, string | number>
  remediation?: { kind: 'shutdown'; reversible: true }
}

/**
 * The rows the move without copy adds to the cross-cluster preflight
 * (ui#1460). The storage proof is not one of them: it allocates a probe
 * volume, so it runs once per target from remote-migrate/shared-storage and
 * again inside the move, never on every preflight refresh.
 */
export async function handoverPreflightIssues(input: {
  sourceConn: PveConn
  sourceConnectionId: string
  targetConnectionId: string
  node: string
  type: GuestType
  vmid: string
  config: Record<string, unknown>
}): Promise<HandoverIssue[]> {
  const { sourceConn, node, type, vmid } = input
  const issues: HandoverIssue[] = []

  const status = await pveFetch<{ status?: string }>(sourceConn, `/nodes/${encodeURIComponent(node)}/${type}/${vmid}/status/current`).catch(() => null)
  if (status?.status !== 'stopped') {
    const current = String(status?.status || 'unknown')
    issues.push({
      type: 'error',
      code: 'GUEST_RUNNING',
      message: 'The guest must be stopped before it moves without copy',
      details: 'Only its configuration changes cluster: a running guest would keep writing to disks the target is about to own.',
      context: { status: current },
      remediation: { kind: 'shutdown', reversible: true },
    })
  }

  const [sourceSsh, targetSsh] = await Promise.all([sshReady(input.sourceConnectionId), sshReady(input.targetConnectionId)])
  for (const [side, ready] of [['source', sourceSsh], ['target', targetSsh]] as const) {
    if (ready) continue
    issues.push({
      type: 'error',
      code: 'SSH_REQUIRED',
      message: `SSH must be enabled on the ${side} connection`,
      details: 'The move without copy reads and writes the guest configuration file over SSH.',
      context: { side },
    })
  }

  const inspected = inspectGuestConf(configToText(input.config), type)
  if (inspected.blockers.length > 0) {
    const keys = inspected.blockers.map(b => b.key).join(', ')
    issues.push({
      type: 'error',
      code: 'NOT_PORTABLE',
      message: `The guest is bound to its node or locked (${keys})`,
      details: 'Host devices, host disks and bind mounts do not exist on another cluster, and a lock means a task still holds the guest.',
      context: { keys },
    })
  }
  if (inspected.isos.length > 0) {
    const isos = inspected.isos.map(i => i.volid).join(', ')
    issues.push({
      type: 'warning',
      code: 'ISO_DETACHED',
      message: `The CD-ROM image will be ejected (${isos})`,
      details: 'An image on a storage the target does not share cannot follow the guest.',
      context: { isos },
    })
  }

  const resources = await pveFetch<{ vmid?: number | string; pool?: string }[]>(sourceConn, '/cluster/resources?type=vm').catch(() => [])
  const pool = (Array.isArray(resources) ? resources : []).find(r => String(r?.vmid) === vmid)?.pool
  if (pool) {
    issues.push({
      type: 'warning',
      code: 'POOL_NOT_CARRIED',
      message: `The guest leaves pool "${pool}" and joins no pool on the target`,
      context: { pool },
    })
  }

  return issues
}
