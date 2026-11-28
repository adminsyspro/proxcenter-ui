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

  const range = await sourceNextIdRange(sourceConn)
  const id = Number(vmid)
  if (range && id >= range.lower && id < range.upper) {
    issues.push({
      type: 'warning',
      code: 'VMID_REUSABLE_ON_SOURCE',
      message: `VMID ${vmid} becomes free on the source cluster, which can give it to a new guest`,
      details: `The source cluster hands out new IDs from ${range.lower} to ${range.upper - 1} (Datacenter options, next free VMID range). A guest created there with this VMID finds the moved disks on the shared storage under its own name: give clusters that share a storage separate ranges.`,
      context: { vmid, lower: range.lower, last: range.upper - 1 },
    })
  }

  return issues
}

/** Proxmox defaults of `next-id`: lower inclusive, upper exclusive. */
const NEXT_ID_DEFAULT = { lower: 100, upper: 1000000 }

/**
 * The range `/cluster/nextid` of the source cluster draws from, or null when
 * its options cannot be read. GET returns `next-id` as an object; a property
 * string is read too.
 */
async function sourceNextIdRange(conn: PveConn): Promise<{ lower: number; upper: number } | null> {
  const options = await pveFetch<Record<string, unknown>>(conn, '/cluster/options').catch(() => null)
  if (!options || typeof options !== 'object') return null
  const fields = nextIdFields(options['next-id'])
  const lower = Number.parseInt(fields.lower ?? '', 10)
  const upper = Number.parseInt(fields.upper ?? '', 10)
  return {
    lower: Number.isFinite(lower) ? lower : NEXT_ID_DEFAULT.lower,
    upper: Number.isFinite(upper) ? upper : NEXT_ID_DEFAULT.upper,
  }
}

/** The `lower`/`upper` fields of `next-id`, from its object or property-string form. */
function nextIdFields(raw: unknown): Record<string, string> {
  const fields: Record<string, string> = {}
  if (typeof raw === 'string') {
    for (const part of raw.split(',')) {
      const [k, v] = part.split('=')
      if (k && v !== undefined) fields[k.trim()] = v.trim()
    }
    return fields
  }
  if (!raw || typeof raw !== 'object') return fields
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string' || typeof v === 'number') fields[k] = String(v)
  }
  return fields
}
