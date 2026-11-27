import { pveFetch } from '@/lib/proxmox/client'

import { inspectGuestConf, remapGuestConf, type GuestType } from './guestConf'
import { proveSharedStorages, type ProofSide, type PveCall, type StorageProof } from './storageProof'

/**
 * Cross-cluster move without copy (ui#1460): the guest is stopped, its disks
 * sit on a storage both clusters reach, so only its configuration file
 * changes cluster.
 *
 * The order is what keeps the disks safe. Proxmox does not stop two clusters
 * from running the same disk image (two RBD watchers, measured at the lab on
 * 27/11), so the source file is moved out of /etc/pve BEFORE the target file
 * exists: at no moment can both clusters start the guest. Every failure after
 * the detach puts the source back; a rollback that fails itself hands back
 * the commands that finish it by hand.
 *
 * The SSH commands carry no sudo mark: like the migrations they run under the
 * `migrations` profile, which grants the account everything. Writing a guest
 * configuration amounts to root anyway (a hookscript line runs as root).
 */

export type SshRunner = (command: string, opts?: { stdin?: string }) => Promise<{ success: boolean; output?: string; error?: string }>

type Side = ProofSide & { ssh: SshRunner }

export type HandoverInput = {
  type: GuestType
  vmid: string
  /** Every NIC of the guest lands on this bridge. */
  bridge: string
  /** Start the guest on the target once it is there. */
  start: boolean
  source: Side
  target: Side
  pve?: PveCall
  now?: () => Date
  randomId?: () => string
}

export type HandoverErrorCode =
  | 'GUEST_RUNNING'
  | 'HA_MANAGED'
  | 'REPLICATED'
  | 'VMID_TAKEN'
  | 'CONF_UNREADABLE'
  | 'NOT_PORTABLE'
  | 'STORAGE_NOT_SHARED'
  | 'DETACH_FAILED'
  | 'CONF_CHANGED'
  | 'TARGET_WRITE_FAILED'
  | 'TARGET_NOT_VISIBLE'
  | 'ROLLBACK_FAILED'

export type HandoverOutcome =
  | {
      ok: true
      /** Source storage to the target storage the disks are now read through. */
      storages: Record<string, string>
      detachedIsos: string[]
      /** The guest had firewall rules, now on the target. */
      firewall: boolean
      /** The source files, kept on the source node: `<archive>.conf` (and `.fw`). */
      archive: string
      sourcePool?: string
      startUpid: string | null
      startError?: string
    }
  | {
      ok: false
      code: HandoverErrorCode
      message: string
      context?: Record<string, string | number>
      proofs?: StorageProof[]
      /** Commands to run on the source node when the rollback failed. */
      manual?: string[]
    }

export const HANDOVER_ARCHIVE_DIR = '/var/lib/proxcenter/handover'

const FW_PRESENT = 'PXC_FW_PRESENT'
const FW_ABSENT = 'PXC_FW_ABSENT'

function q(arg: string): string {
  return "'" + arg.replaceAll("'", "'\\''") + "'"
}

export function guestConfPath(node: string, type: GuestType, vmid: string): string {
  return `/etc/pve/nodes/${node}/${type === 'qemu' ? 'qemu-server' : 'lxc'}/${vmid}.conf`
}

function firewallPath(vmid: string): string {
  return `/etc/pve/firewall/${vmid}.fw`
}

/** SSH answers trimmed: a file always goes back with its final newline. */
function asFile(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`
}

function stamp(date: Date): string {
  return date.toISOString().replace(/\.\d+Z$/, 'Z').replace(/[-:]/g, '')
}

function fail(code: HandoverErrorCode, message: string, extra: Partial<Extract<HandoverOutcome, { ok: false }>> = {}): HandoverOutcome {
  return { ok: false, code, message, ...extra }
}

type Plan = {
  conf: string
  firewall: string | null
  storages: Record<string, string>
  detachedIsos: string[]
  sourcePool?: string
}

/** Every check that needs no write: a refusal here leaves both clusters untouched. */
async function preflight(input: HandoverInput, pve: PveCall): Promise<{ plan: Plan; original: string } | HandoverOutcome> {
  const { type, vmid, source, target } = input
  const guestPath = `/nodes/${encodeURIComponent(source.node)}/${type}/${vmid}`

  const status = await pve<{ status?: string }>(source.conn, `${guestPath}/status/current`)
  if (status?.status !== 'stopped') {
    return fail('GUEST_RUNNING', `The guest must be stopped first (status: ${status?.status || 'unknown'})`, { context: { status: String(status?.status || 'unknown') } })
  }

  const sid = `${type === 'qemu' ? 'vm' : 'ct'}:${vmid}`
  const ha = await pve<{ sid?: string }[]>(source.conn, '/cluster/ha/resources')
  if ((Array.isArray(ha) ? ha : []).some(r => r?.sid === sid)) {
    return fail('HA_MANAGED', 'The guest is managed by High Availability on the source cluster: remove it from HA first')
  }

  const replication = await pve<{ id?: string; guest?: number | string }[]>(source.conn, '/cluster/replication')
  const jobs = (Array.isArray(replication) ? replication : []).filter(j => String(j?.guest) === vmid)
  if (jobs.length > 0) {
    return fail('REPLICATED', `The guest has replication job(s) ${jobs.map(j => j.id).join(', ')}: remove them first`)
  }

  const targetGuests = await pve<{ vmid?: number | string; node?: string; name?: string }[]>(input.target.conn, '/cluster/resources?type=vm')
  const taken = (Array.isArray(targetGuests) ? targetGuests : []).find(g => String(g?.vmid) === vmid)
  if (taken) {
    return fail('VMID_TAKEN', `VMID ${vmid} already exists on the target cluster (${taken.name || 'unnamed'} on ${taken.node || '?'})`, {
      context: { vmid, node: String(taken.node || '') },
    })
  }

  const read = await source.ssh(`cat ${q(guestConfPath(source.node, type, vmid))}`)
  if (!read.success || !read.output) {
    return fail('CONF_UNREADABLE', `Could not read the guest configuration over SSH: ${read.error || 'empty file'}`)
  }
  const original = asFile(read.output)

  const inspected = inspectGuestConf(original, type)
  if (inspected.blockers.length > 0) {
    const keys = inspected.blockers.map(b => b.key).join(', ')

    return fail('NOT_PORTABLE', `The guest is bound to its node or locked (${keys})`, { context: { keys } })
  }

  const proofs = await proveSharedStorages({ source, target, vmid, type, volumes: inspected.volumes, pve, randomId: input.randomId })
  const unproven = proofs.filter(p => !p.ok)
  if (unproven.length > 0) {
    return fail('STORAGE_NOT_SHARED', `No storage of the target cluster is proven to hold the disks on ${unproven.map(p => p.storage).join(', ')}`, {
      proofs,
      context: { storages: unproven.map(p => p.storage).join(', ') },
    })
  }
  const storages = Object.fromEntries(proofs.flatMap(p => (p.ok ? [[p.storage, p.target]] : [])))

  let remapped: { conf: string; detachedIsos: string[] }
  try {
    remapped = remapGuestConf(original, type, { storages, bridge: input.bridge })
  } catch (e: any) {
    return fail('STORAGE_NOT_SHARED', String(e?.message || e), { proofs })
  }

  const fw = await source.ssh(`if [ -e ${q(firewallPath(vmid))} ]; then echo ${FW_PRESENT}; cat ${q(firewallPath(vmid))}; else echo ${FW_ABSENT}; fi`)
  if (!fw.success) return fail('CONF_UNREADABLE', `Could not read the guest firewall rules over SSH: ${fw.error || 'unknown error'}`)
  const fwOutput = fw.output || ''
  const firewall = fwOutput.startsWith(FW_PRESENT) ? asFile(fwOutput.slice(FW_PRESENT.length).replace(/^\n/, '')) : null

  const resources = await pve<{ vmid?: number | string; pool?: string }[]>(source.conn, '/cluster/resources?type=vm').catch(() => [])
  const sourcePool = (Array.isArray(resources) ? resources : []).find(r => String(r?.vmid) === vmid)?.pool

  return { original, plan: { conf: remapped.conf, firewall, storages, detachedIsos: remapped.detachedIsos, sourcePool: sourcePool || undefined } }
}

export async function executeHandover(input: HandoverInput): Promise<HandoverOutcome> {
  const pve: PveCall = input.pve ?? (pveFetch as PveCall)
  const { type, vmid, source, target } = input

  const checked = await preflight(input, pve)
  if ('ok' in checked) return checked
  const { plan, original } = checked

  const sourceConf = guestConfPath(source.node, type, vmid)
  const sourceFw = firewallPath(vmid)
  const archive = `${HANDOVER_ARCHIVE_DIR}/${vmid}-${stamp((input.now ?? (() => new Date()))())}`
  const targetConf = guestConfPath(target.node, type, vmid)
  const targetFw = firewallPath(vmid)

  const restoreSource = `mv ${q(`${archive}.conf`)} ${q(sourceConf)}${plan.firewall ? ` && mv ${q(`${archive}.fw`)} ${q(sourceFw)}` : ''}`
  const rollback = async (code: HandoverErrorCode, message: string, targetWritten: string[]): Promise<HandoverOutcome> => {
    const manual: string[] = []
    if (targetWritten.length > 0) {
      const removeTarget = `rm -f ${targetWritten.map(q).join(' ')}`
      const removed = await target.ssh(removeTarget)
      if (!removed.success) manual.push(`on ${target.node}: ${removeTarget}`)
    }
    const restored = await source.ssh(restoreSource)
    if (!restored.success) manual.unshift(restoreSource)
    if (manual.length > 0) {
      return fail('ROLLBACK_FAILED', `${message}. The rollback did not complete: finish it by hand on ${source.node}`, { manual })
    }

    return fail(code, message)
  }

  // 1. Detach: the source cluster stops knowing the guest.
  const moveFw = plan.firewall ? ` && { mv ${q(sourceFw)} ${q(`${archive}.fw`)} || { mv ${q(`${archive}.conf`)} ${q(sourceConf)}; exit 1; }; }` : ''
  const detached = await source.ssh(`mkdir -p ${q(HANDOVER_ARCHIVE_DIR)} && chmod 700 ${q(HANDOVER_ARCHIVE_DIR)} && mv ${q(sourceConf)} ${q(`${archive}.conf`)}${moveFw}`)
  if (!detached.success) return fail('DETACH_FAILED', `Could not detach the guest from the source cluster: ${detached.error || 'unknown error'}`)

  // 2. The file moved is the file proven: a change in between restarts the move.
  const reread = await source.ssh(`cat ${q(`${archive}.conf`)}`)
  if (!reread.success || asFile(reread.output || '') !== original) {
    return rollback('CONF_CHANGED', 'The guest configuration changed during the move', [])
  }

  // 3. Attach: the target cluster learns the guest. pmxcfs refuses a VMID
  // known on another node; the test refuses one on this node.
  const written = await target.ssh(`[ ! -e ${q(targetConf)} ] && tee ${q(targetConf)} > /dev/null`, { stdin: asFile(plan.conf) })
  if (!written.success) {
    return rollback('TARGET_WRITE_FAILED', `The target cluster refused the guest configuration: ${written.error || 'the file already exists'}`, [])
  }
  if (plan.firewall) {
    const fwWritten = await target.ssh(`tee ${q(targetFw)} > /dev/null`, { stdin: plan.firewall })
    if (!fwWritten.success) {
      return rollback('TARGET_WRITE_FAILED', `The target cluster refused the guest firewall rules: ${fwWritten.error || 'unknown error'}`, [targetConf])
    }
  }

  const written2 = plan.firewall ? [targetConf, targetFw] : [targetConf]
  try {
    await pve(target.conn, `/nodes/${encodeURIComponent(target.node)}/${type}/${vmid}/config`)
  } catch (e: any) {
    return rollback('TARGET_NOT_VISIBLE', `The target cluster does not show the guest: ${String(e?.message || e)}`, written2)
  }

  // 4. The source pool would keep a ghost entry that a new guest of this VMID inherits.
  if (plan.sourcePool) {
    await pve(source.conn, `/pools/${encodeURIComponent(plan.sourcePool)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ vms: vmid, delete: '1' }).toString(),
    }).catch((e: any) => {
      console.warn(`[shared-handover] guest ${vmid} left in source pool ${plan.sourcePool}:`, String(e?.message || e).replace(/[\r\n]/g, ' '))
    })
  }

  let startUpid: string | null = null
  let startError: string | undefined
  if (input.start) {
    try {
      const upid = await pve<string>(target.conn, `/nodes/${encodeURIComponent(target.node)}/${type}/${vmid}/status/start`, { method: 'POST' })
      startUpid = typeof upid === 'string' ? upid : null
    } catch (e: any) {
      startError = String(e?.message || e)
    }
  }

  return {
    ok: true,
    storages: plan.storages,
    detachedIsos: plan.detachedIsos,
    firewall: !!plan.firewall,
    archive,
    sourcePool: plan.sourcePool,
    startUpid,
    ...(startError ? { startError } : {}),
  }
}
