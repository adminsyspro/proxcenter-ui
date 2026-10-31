/**
 * Preflight of an action card (roadmap#188): would it run, and what should
 * the user know before clicking. Computed when the card is proposed, shown on
 * it, and replayed by the execute route right before dispatch, so a `block`
 * found at either moment stops the action.
 *
 * No side effect, and no dependency on the assistant context (`ctx.actions`):
 * the execute route calls it with a plain tool context. It never throws; a
 * failed check is a `block`, since an action we could not check is not run.
 *
 * Proxmox load: only `migrate` reads Proxmox here, exactly one protected GET
 * (the precondition), plus for a container two non-protected reads (its
 * config and the cluster storage config, cached a minute), one after the
 * other; nothing with `inPlan`.
 * Everything else reads the snapshot, the minute-cached backup jobs or the
 * orchestrator.
 *
 * Every Proxmox read goes through `serialPveRead`, one at a time per
 * question: the tool loop runs up to four calls at once, and three
 * `propose_action migrate` of one round would otherwise take the three
 * pvedaemon workers of the same node together.
 */

import { planAddGuestToJob, type AddGuestRefusal } from '@/lib/backups/coverage'
import { getConnectionById } from '@/lib/connections/getConnection'
import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { pveFetch } from '@/lib/proxmox/client'
import { isSharedStorage } from '@/lib/proxmox/storage'
import { PERMISSIONS } from '@/lib/rbac'
import { drsMoveVisible } from '@/lib/tools/automation'
import { loadBackupJobs } from '@/lib/tools/backups'
import { evaluateHostFit } from '@/lib/tools/forecast'
import { hasNodePermission } from '@/lib/tools/guards'
import type { SnapshotGuest } from '@/lib/tools/snapshot'
import type { ToolContext } from '@/lib/tools/types'
import { getAllowedJobPools } from '@/lib/vdc/backupJobs'

import { findTargetGuest, findTargetNode } from './target'
import type { ActionCard, ActionKind } from './types'

export const SNAPSHOT_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{1,39}$/

/** DRS statuses still waiting to be carried out; rejected, executed and stale are final. */
export const DRS_AWAITING = ['pending', 'approved']

type Check = ActionCard['preflight']['checks'][number]

export type PreflightInput = { kind: ActionKind; target: ActionCard['target']; params: ActionCard['params'] }

export type PreflightOptions = {
  /**
   * The card is a step of a remediation plan: no Proxmox precondition read
   * (a plan costs no protected call, execute replays it), and a step that
   * depends on an earlier one (maintenance exit after enter) is not blocked
   * by today's state.
   */
  inPlan?: boolean
}

/**
 * Runs a Proxmox read of a preflight after every earlier one of the same
 * question (`ctx.usage.pveChain`) has settled, so at most one is in flight per
 * question. A failed read does not hold the next one: the chain keeps only
 * the settling, the caller gets the outcome.
 */
export function serialPveRead<T>(ctx: ToolContext, read: () => Promise<T>): Promise<T> {
  const usage = (ctx.usage ??= { historyLookups: 0 })
  const run = (usage.pveChain ?? Promise.resolve()).then(read)

  usage.pveChain = run.then(
    () => undefined,
    () => undefined
  )

  return run
}

const ok = (text: string): Check => ({ level: 'ok', text })
const warn = (text: string): Check => ({ level: 'warn', text })
const block = (text: string): Check => ({ level: 'block', text })

const blocked = (checks: Check[]) => checks.some(c => c.level === 'block')

const label = (t: ActionCard['target']) => (t.vmid === undefined ? t.name : `${t.name} (${t.vmid})`)

/** The visible, non-template guest the card targets, or a block. */
function liveGuest(input: PreflightInput, ctx: ToolContext, checks: Check[]): SnapshotGuest | null {
  const guest = findTargetGuest(ctx, input.target)

  if (!guest) {
    checks.push(block(`${label(input.target)} is not visible to you anymore.`))

    return null
  }

  if (guest.template) {
    checks.push(block(`${guest.name} is a template.`))

    return null
  }

  return guest
}

function checkPower(input: PreflightInput, ctx: ToolContext, checks: Check[]) {
  const guest = liveGuest(input, ctx, checks)

  if (!guest) return

  const name = label(input.target)
  const needs = input.kind === 'start' ? 'stopped' : 'running'

  if (guest.status !== needs) {
    const verb = { start: 'started', shutdown: 'shut down', reboot: 'rebooted' }[input.kind as 'start' | 'shutdown' | 'reboot']

    checks.push(block(`${name} is ${guest.status}: only a ${needs} guest can be ${verb}.`))

    return
  }

  const host = findTargetNode(ctx, guest.connId, guest.node)

  if (host && host.status !== 'online') {
    checks.push(block(`Host ${host.name} is ${host.status}.`))

    return
  }

  checks.push(ok(`${name} is ${guest.status} on ${guest.node}.`))

  if (input.kind === 'shutdown' && guest.haState) {
    checks.push(warn(`HA manages ${guest.name}: Proxmox hands the shutdown to HA, which then keeps it stopped.`))
  }
}

function checkSnapshot(input: PreflightInput, ctx: ToolContext, checks: Check[]) {
  const guest = liveGuest(input, ctx, checks)
  const name = String(input.params.name ?? '')

  if (!guest) return

  if (!SNAPSHOT_NAME_RE.test(name)) {
    checks.push(block(`"${name}" is not a valid snapshot name: a letter, then 1 to 39 letters, digits, - or _.`))

    return
  }

  checks.push(ok(`Snapshot "${name}" of ${label(input.target)}, on ${guest.node}.`))
}

/** Why Proxmox refuses a target host, from `not_allowed_nodes` (qemu) or `not-allowed-nodes` (lxc). */
function refusalReason(entry: unknown): string {
  if (!entry || typeof entry !== 'object') return 'no reason given'

  const storages = (entry as Record<string, unknown>).unavailable_storages

  if (Array.isArray(storages) && storages.length) return `storage ${storages.join(', ')} is not available there`

  const keys = Object.keys(entry as object)

  return keys.length ? keys.join(', ') : 'no reason given'
}

async function checkPrecondition(guest: SnapshotGuest, dest: string, ctx: ToolContext, checks: Check[]) {
  let pre: Record<string, any>
  let conn: Awaited<ReturnType<typeof getConnectionById>>

  try {
    conn = await getConnectionById(guest.connId, ctx.tenantId)
    const path = `/nodes/${encodeURIComponent(guest.node)}/${guest.kind}/${encodeURIComponent(guest.vmid)}/migrate`

    pre = (await serialPveRead(ctx, () => pveFetch<Record<string, any>>(conn, path))) ?? {}
  } catch (e: any) {
    checks.push(block(`Proxmox could not confirm the move is possible: ${String(e?.message || e).slice(0, 160)}`))

    return
  }

  // The evacuation rule: a guest on local storage is never moved by the assistant.
  const localDisks = Array.isArray(pre.local_disks) ? pre.local_disks : []

  if (localDisks.length) {
    const volids = localDisks.map((d: any) => String(d?.volid ?? d?.drivename ?? '?')).slice(0, 4).join(', ')

    checks.push(block(`${guest.name} has disks on local storage (${volids}): the assistant only moves guests on shared storage.`))
  }

  const local = [...(Array.isArray(pre.local_resources) ? pre.local_resources : []), ...(Array.isArray(pre['mapped-resources']) ? pre['mapped-resources'] : [])]

  if (local.length) checks.push(block(`${guest.name} uses resources tied to its host (${local.slice(0, 4).join(', ')}).`))

  const allowed = pre.allowed_nodes ?? pre['allowed-nodes']
  const refused = pre.not_allowed_nodes ?? pre['not-allowed-nodes'] ?? {}

  if (!Array.isArray(allowed) || !allowed.includes(dest)) {
    checks.push(block(`Proxmox does not allow ${dest} as a target: ${refusalReason(refused?.[dest])}.`))
  }

  // The container precondition says nothing of local volumes: PVE builds its
  // allowed list from storage NAMES, so a rootfs on an LVM defined on every
  // node but not shared passes it (lab, CT 7001 on LVM-Thick).
  if (guest.kind === 'lxc' && !blocked(checks)) await checkContainerVolumes(guest, ctx, conn, checks)

  if (!blocked(checks)) checks.push(ok('Proxmox allows the move: no local disk, no host-bound resource.'))
}

/** Volume keys of a container config: the root disk, mount points and detached volumes. */
const LXC_VOLUME_KEY = /^(rootfs|mp\d+|unused\d+)$/

export const STORAGE_CONFIG_TTL_MS = 60_000

type StorageConfig = { storage?: string; type?: string; shared?: number | boolean; nodes?: string }

const storageConfigs = new Map<string, { at: number; rows: Promise<StorageConfig[]> }>()

/** Test hook: the cache is module state. */
export function clearStorageConfigCache() {
  storageConfigs.clear()
}

/**
 * The cluster's storage definitions, `GET /storage`: a read of storage.cfg,
 * not a protected call and no storage activated. `/nodes/{node}/storage` is
 * avoided on purpose: it is protected (one of the node's 3 pvedaemon workers)
 * and queries every storage, so a dead NFS mount would stall it. Cached a
 * minute per tenant and connection, like the backup jobs, an in-flight read
 * shared.
 */
function loadStorageConfig(ctx: ToolContext, connId: string, conn: Awaited<ReturnType<typeof getConnectionById>>): Promise<StorageConfig[]> {
  const key = `${ctx.tenantId}|${connId}`
  const hit = storageConfigs.get(key)

  if (hit && Date.now() - hit.at < STORAGE_CONFIG_TTL_MS) return hit.rows

  const rows = serialPveRead(ctx, () => pveFetch<StorageConfig[]>(conn, '/storage')).then(list => (Array.isArray(list) ? list : []))

  storageConfigs.set(key, { at: Date.now(), rows })
  rows.catch(() => {
    if (storageConfigs.get(key)?.rows === rows) storageConfigs.delete(key)
  })

  return rows
}

/** Whether a storage definition applies to that host: `nodes` absent means every node. */
function definedOn(def: StorageConfig, node: string): boolean {
  if (!def.nodes) return true

  return def.nodes.split(',').map(n => n.trim()).includes(node)
}

/**
 * Blocks a container with a volume on a storage that is not shared, on a
 * storage not defined for its host, or with a bind mount (a host path, no
 * `storage:` prefix). Two reads, one after the other, neither protected: the
 * container config and the cluster storage config (minute cache), judged with
 * `isSharedStorage` like the local-vms route.
 */
async function checkContainerVolumes(guest: SnapshotGuest, ctx: ToolContext, conn: Awaited<ReturnType<typeof getConnectionById>>, checks: Check[]) {
  let config: Record<string, unknown>
  let storages: StorageConfig[]

  try {
    const path = `/nodes/${encodeURIComponent(guest.node)}/lxc/${encodeURIComponent(guest.vmid)}/config`

    config = (await serialPveRead(ctx, () => pveFetch<Record<string, unknown>>(conn, path))) ?? {}
    storages = await loadStorageConfig(ctx, guest.connId, conn)
  } catch (e: any) {
    checks.push(block(`Could not read the volumes of ${guest.name}: ${String(e?.message || e).slice(0, 160)}`))

    return
  }

  const byName = new Map(storages.map(s => [String(s?.storage), s]))
  const local: string[] = []

  for (const [key, value] of Object.entries(config)) {
    if (!LXC_VOLUME_KEY.test(key) || typeof value !== 'string') continue

    const volume = value.split(',')[0].trim().replace(/^volume=/, '')

    if (volume.startsWith('/')) {
      local.push(`${key} bind mount ${volume}`)
      continue
    }

    const storage = volume.split(':')[0]
    const def = byName.get(storage)

    // A storage unknown to the cluster, or not defined for this host, is not
    // known to be shared: fail closed.
    if (!def || !definedOn(def, guest.node) || !isSharedStorage(def)) local.push(`${key} on ${storage}`)
  }

  if (local.length) {
    checks.push(block(`${guest.name} has volumes on local storage (${local.slice(0, 4).join(', ')}): the assistant only moves guests on shared storage.`))
  }
}

async function checkMigrate(input: PreflightInput, ctx: ToolContext, checks: Check[], opts: PreflightOptions) {
  const guest = liveGuest(input, ctx, checks)

  if (!guest) return

  const name = label(input.target)
  const destName = String(input.params.target ?? '')
  const dest = findTargetNode(ctx, guest.connId, destName)

  if (guest.status !== 'running') {
    checks.push(block(`${name} is ${guest.status}: the assistant only proposes the live move of a running guest.`))
  }

  if (!dest) {
    checks.push(block(`Host ${destName || '(none)'} is not a visible host of ${guest.cluster}.`))
  } else if (dest.name === guest.node) {
    checks.push(block(`${guest.name} already runs on ${dest.name}.`))
  } else if (dest.status !== 'online') {
    checks.push(block(`Host ${dest.name} is ${dest.status}.`))
  } else if (dest.maintenance) {
    checks.push(block(`Host ${dest.name} is in maintenance.`))
  } else {
    const fit = evaluateHostFit(ctx.snapshot, guest, dest)
    const text = `${dest.name} has ${fit.ramFreeAfterReserveGb} GB free after its reserve, ${name} needs ${fit.ramNeededGb} GB.`

    checks.push(fit.fits ? ok(text) : block(text))
  }

  if (guest.kind === 'lxc') checks.push(warn('The container restarts on the target host.'))

  if (blocked(checks) || !dest) return

  if (opts.inPlan) {
    checks.push(warn('Storage is checked with Proxmox when this step runs.'))

    return
  }

  await checkPrecondition(guest, dest.name, ctx, checks)
}

async function checkDrs(input: PreflightInput, ctx: ToolContext, checks: Check[]) {
  const guest = liveGuest(input, ctx, checks)

  if (!guest) return

  const id = String(input.params.recommendationId ?? '')
  const res = await getOrchestratorClient().getRecommendations(false).catch(() => null)

  if (!res) {
    checks.push(block('The DRS service is not reachable right now.'))

    return
  }

  const rec: any = (Array.isArray(res.data) ? res.data : []).find((r: any) => String(r?.id) === id)

  if (!rec) checks.push(block('This DRS recommendation no longer exists.'))
  else if (!DRS_AWAITING.includes(rec.status)) checks.push(block(`This DRS recommendation is ${rec.status}.`))
  else if (!drsMoveVisible(ctx.snapshot, rec)) checks.push(block('This DRS recommendation names a guest or a host outside your view.'))
  else if (rec.connection_id !== guest.connId || String(rec.vmid) !== guest.vmid) checks.push(block('This DRS recommendation is about another guest.'))
  else if (rec.source_node !== guest.node) checks.push(block(`${guest.name} is no longer on ${rec.source_node}.`))
  else checks.push(ok(`DRS moves ${label(input.target)} from ${rec.source_node} to ${rec.target_node} (priority ${rec.priority ?? 'unknown'}).`))
}

const JOB_REFUSALS: Record<AddGuestRefusal, string> = {
  pool: 'it selects a pool, a guest joins it through the pool',
  other_node: 'it is pinned to another host',
  already: 'it already backs this guest up',
  no_selection: 'it selects no guest',
}

async function checkBackupAdd(input: PreflightInput, ctx: ToolContext, checks: Check[]) {
  const guest = liveGuest(input, ctx, checks)

  if (!guest) return

  // The route refuses a vDC tenant too: their jobs follow their pools.
  if ((await getAllowedJobPools(ctx.tenantId, guest.connId)) !== null) {
    checks.push(block('Not available to a vDC tenant: your backup jobs follow your pools.'))

    return
  }

  const jobId = String(input.params.jobId ?? '')
  // Minute-cached, but a cold cache reads /cluster/backup: in the chain too.
  const job = (await serialPveRead(ctx, () => loadBackupJobs(ctx, guest.connId))).find(j => j.id === jobId)

  if (!job) {
    checks.push(block(`Backup job ${jobId || '(none)'} does not exist on ${guest.cluster}.`))

    return
  }

  const plan = planAddGuestToJob(job, { vmid: guest.vmid, node: guest.node })

  if (plan.ok === false) {
    checks.push(block(`Job ${jobId} cannot take ${guest.name}: ${JOB_REFUSALS[plan.reason]}.`))

    return
  }

  checks.push(ok(`Adds ${label(input.target)} to backup job ${jobId}; its schedule and retention stay as they are.`))

  if (plan.disabled) checks.push(warn(`Job ${jobId} is disabled: ${guest.name} stays unprotected until it is enabled.`))
}

async function checkMaintenance(input: PreflightInput, ctx: ToolContext, checks: Check[], opts: PreflightOptions) {
  const host = findTargetNode(ctx, input.target.connId, input.target.node)
  const mode = input.params.mode

  if (!host) {
    checks.push(block(`Host ${input.target.node} is not visible to you anymore.`))

    return
  }

  if (!(await hasNodePermission(PERMISSIONS.NODE_MANAGE, host.connId, host.name))) {
    checks.push(block(`You do not have the permission to manage host ${host.name}.`))

    return
  }

  if (mode === 'enter') {
    if (host.maintenance) checks.push(block(`${host.name} is already in maintenance.`))
    else if (host.status !== 'online') checks.push(block(`Host ${host.name} is ${host.status}.`))
    else {
      checks.push(ok(`HA moves the guests it manages off ${host.name} and keeps it empty until maintenance ends.`))

      const unmanaged = ctx.snapshot.guests.filter(g => g.connId === host.connId && g.node === host.name && g.status === 'running' && !g.haState)

      if (unmanaged.length) {
        checks.push(warn(`${unmanaged.length} running guest(s) on ${host.name} are not managed by HA and stay where they are.`))
      }
    }

    return
  }

  if (mode === 'exit') {
    if (!host.maintenance && !opts.inPlan) checks.push(block(`${host.name} is not in maintenance.`))
    else checks.push(ok(`${host.name} takes guests again once maintenance ends.`))

    return
  }

  checks.push(block(`Unknown maintenance mode "${String(mode)}".`))
}

export async function preflightAction(
  input: PreflightInput,
  ctx: ToolContext,
  opts: PreflightOptions = {}
): Promise<ActionCard['preflight']> {
  const checks: Check[] = []

  try {
    switch (input.kind) {
      case 'start':
      case 'shutdown':
      case 'reboot':
        checkPower(input, ctx, checks)
        break
      case 'snapshot':
        checkSnapshot(input, ctx, checks)
        break
      case 'migrate':
        await checkMigrate(input, ctx, checks, opts)
        break
      case 'drs_apply':
        await checkDrs(input, ctx, checks)
        break
      case 'backup_add':
        await checkBackupAdd(input, ctx, checks)
        break
      case 'maintenance':
        await checkMaintenance(input, ctx, checks, opts)
        break
      default:
        checks.push(block(`Unknown action "${String(input.kind)}".`))
    }
  } catch (e: any) {
    checks.push(block(`The action could not be checked: ${String(e?.message || e).slice(0, 160)}`))
  }

  return { ok: !blocked(checks), checks }
}
