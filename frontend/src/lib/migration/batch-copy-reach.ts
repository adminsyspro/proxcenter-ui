/**
 * Copy network of a warm VMware batch, per target node (roadmap#53).
 *
 * The VDDK copy connects from the Proxmox node to a VMkernel adapter of the
 * VM's source host: the one the operator pinned, else the host's default
 * (vSphereBackupNFC tag, else management). A node with no route to it fails
 * the job at planning ("The Proxmox node cannot reach ... on port 902"), which
 * a batch spread on "Auto" hit on nodes outside the copy subnet.
 *
 * Before a batch starts: read each VM's effective adapter in vSphere, probe it
 * once per distinct (node, address) from the node (port 902, plus 443 on a
 * standalone ESXi, plus the vCenter on 443 on a vCenter source, roadmap#175),
 * then place each VM only on nodes that reach it. A node
 * named explicitly that cannot reach a VM's adapter blocks the batch; on
 * "Auto" the VM goes round-robin among the nodes that can, and blocks only
 * when none can. Same probe as the single-VM pre-check (runWarmCopyReachability).
 */
import { decryptSecret } from "@/lib/crypto/secret"
import { getTenantPrisma } from "@/lib/tenant"
import { soapLogin, soapLogout } from "@/lib/vmware/soap"
import { soapGetVmCopyInterfaces } from "@/lib/vmware/vmkernel"
import { runWarmCopyReachability, type NfcReachability, type VcenterReachability } from "@/lib/migration/warm/nfc-reachability"
import { mapBounded } from "@/lib/migration/batch-disk-sizes"
import { isValidSourceVmId } from "@/lib/migration/source-vm-id"

export const COPY_READ_CONCURRENCY = 4
export const COPY_READ_DEADLINE_MS = 20_000
export const COPY_PROBE_CONCURRENCY = 4
export const COPY_PROBE_DEADLINE_MS = 30_000

/** Effective copy adapter of a VM's source host, or why it could not be read. */
export type VmCopyTarget =
  | { ok: true; host: string; device: string; address: string; direct: boolean; vcenterHost?: string }
  | { ok: false; error: string }

export interface CopyCheckVm { sourceVmId: string; name: string }

export type CopyProblem =
  | { kind: "unreachable"; node: string; host: string; device: string; address: string; ports: number[]; vms: string[]; error?: string; vcenter?: VcenterReachability; message: string }
  | { kind: "noNode"; vm: string; host: string; device: string; address: string; vcenter?: VcenterReachability; message: string }

export interface CopyInfo { vm: string; nodes: string[]; excluded: string[] }

export interface CopyPlan {
  /** Node of each VM (by sourceVmId); null when none can reach its copy network. */
  assignment: Record<string, string | null>
  problems: CopyProblem[]
  infos: CopyInfo[]
  /** VMs whose adapter could not be read: placed as asked, the job's own pre-check stays. */
  unchecked: string[]
}

export const pairKey = (node: string, address: string, direct: boolean) => `${node}|${address}|${direct ? "esxi" : "vc"}`

function closedPorts(r: NfcReachability | undefined): number[] {
  if (!r) return []
  return Object.entries(r.ports).filter(([, open]) => !open).map(([p]) => Number(p))
}

export function unreachableMessage(p: { node: string; device: string; address: string; host: string; ports: number[]; error?: string; vcenter?: VcenterReachability }): string {
  if (p.error) return `${p.node} could not probe ${p.device} ${p.address} (host ${p.host}): ${p.error}`
  const parts = [
    ...(p.vcenter && !p.vcenter.resolved ? [`${p.node} cannot resolve the vCenter name ${p.vcenter.host}`] : []),
    ...(p.vcenter && p.vcenter.resolved && !p.vcenter.open ? [`${p.node} cannot reach the vCenter ${p.vcenter.host} on port 443`] : []),
    ...(p.ports.length ? [`${p.node} cannot reach ${p.device} ${p.address} (host ${p.host}) on port ${p.ports.join(" and ")}`] : []),
  ]
  return parts.join("; ")
}

export function noNodeMessage(p: { vm: string; device: string; address: string; host: string; vcenter?: VcenterReachability }): string {
  if (p.vcenter) return `No target node can ${p.vcenter.resolved ? `reach the vCenter ${p.vcenter.host} on port 443` : `resolve the vCenter name ${p.vcenter.host}`}, needed to copy ${p.vm}`
  return `No target node can reach the copy network of ${p.vm}: ${p.device} ${p.address} (host ${p.host})`
}

/**
 * Place the VMs. `auto`: each VM on the reachable node holding the fewest VMs
 * so far (in candidate order on a tie, which is plain round-robin when every
 * node reaches every adapter). Not `auto`: each VM on `requested[vmId]` (or
 * the single candidate), a problem when that node cannot reach it.
 */
export function planCopyNodes(a: {
  vms: CopyCheckVm[]
  candidates: string[]
  auto: boolean
  requested?: Record<string, string>
  targets: Map<string, VmCopyTarget>
  reach: Map<string, NfcReachability>
}): CopyPlan {
  const plan: CopyPlan = { assignment: {}, problems: [], infos: [], unchecked: [] }
  const load = new Map(a.candidates.map(n => [n, 0]))
  const unreachable = new Map<string, Extract<CopyProblem, { kind: "unreachable" }>>()
  for (const vm of a.vms) {
    const target = a.targets.get(vm.sourceVmId)
    const fixed = !a.auto ? (a.requested?.[vm.sourceVmId] ?? a.candidates[0] ?? null) : null
    if (!target || !target.ok) {
      plan.unchecked.push(vm.sourceVmId)
      const node = fixed ?? [...load.entries()].sort((x, y) => x[1] - y[1])[0]?.[0] ?? null
      if (node) load.set(node, (load.get(node) ?? 0) + 1)
      plan.assignment[vm.sourceVmId] = node
      continue
    }
    const reaches = (node: string) => a.reach.get(pairKey(node, target.address, target.direct))?.ok === true
    if (fixed) {
      plan.assignment[vm.sourceVmId] = fixed
      if (!reaches(fixed)) {
        const key = pairKey(fixed, target.address, target.direct)
        const r = a.reach.get(key)
        const p = unreachable.get(key) ?? { kind: "unreachable" as const, node: fixed, host: target.host, device: target.device, address: target.address, ports: closedPorts(r), vms: [], ...(r?.error && { error: r.error }), ...(r?.vcenter && !r.vcenter.open && { vcenter: r.vcenter }), message: "" }
        p.vms.push(vm.name)
        p.message = unreachableMessage({ ...p, error: r?.error })
        unreachable.set(key, p)
      }
      continue
    }
    const ok = a.candidates.filter(reaches)
    if (ok.length === 0) {
      plan.assignment[vm.sourceVmId] = null
      // Every node failing on the vCenter is a vCenter problem, not a copy-network one.
      const vcenterDown = a.candidates.map(n => a.reach.get(pairKey(n, target.address, target.direct))?.vcenter).filter(v => v && !v.open)
      const vcenter = a.candidates.length > 0 && vcenterDown.length === a.candidates.length ? vcenterDown[0] : undefined
      plan.problems.push({ kind: "noNode", vm: vm.name, host: target.host, device: target.device, address: target.address, ...(vcenter && { vcenter }), message: noNodeMessage({ vm: vm.name, ...target, vcenter }) })
      continue
    }
    const node = ok.reduce((best, n) => ((load.get(n) ?? 0) < (load.get(best) ?? 0) ? n : best), ok[0])
    load.set(node, (load.get(node) ?? 0) + 1)
    plan.assignment[vm.sourceVmId] = node
    const excluded = a.candidates.filter(n => !ok.includes(n))
    if (excluded.length) plan.infos.push({ vm: vm.name, nodes: ok, excluded })
  }
  plan.problems.unshift(...unreachable.values())
  return plan
}

/** Effective copy adapter of each VM (pinned `device`, else its host's default). Never throws. */
export async function readBatchCopyTargets(tenantId: string, sourceConnectionId: string, vmIds: string[], pinnedDevice?: string): Promise<Map<string, VmCopyTarget>> {
  const failed = (error: string) => new Map<string, VmCopyTarget>(vmIds.map(id => [id, { ok: false, error }]))
  try {
    const conn = await getTenantPrisma(tenantId).connection.findUnique({
      where: { id: sourceConnectionId },
      select: { baseUrl: true, apiTokenEnc: true, insecureTLS: true, type: true },
    })
    if (!conn || conn.type !== "vmware" || !conn.apiTokenEnc) return failed("not a VMware source")
    const creds = decryptSecret(conn.apiTokenEnc)
    const i = creds.indexOf(":")
    const session = await soapLogin(conn.baseUrl.replace(/\/$/, ""), i > 0 ? creds.slice(0, i) : "root", i > 0 ? creds.slice(i + 1) : creds, conn.insecureTLS)
    try {
      const fallbackHost = new URL(conn.baseUrl).hostname
      const read = await mapBounded(vmIds, COPY_READ_CONCURRENCY, Date.now() + COPY_READ_DEADLINE_MS, async (id): Promise<VmCopyTarget> => {
        if (!isValidSourceVmId(id)) return { ok: false, error: "invalid VM id" }
        const ifaces = await soapGetVmCopyInterfaces(session, id, fallbackHost)
        const device = pinnedDevice || ifaces.defaultDevice
        const vnic = ifaces.vnics.find(v => v.device === device)
        if (!device || !vnic?.address) return { ok: false, error: `no addressed VMkernel adapter ${device ?? ""} on ${ifaces.hostName}`.replace("  ", " ") }
        return { ok: true, host: ifaces.hostName, device, address: vnic.address, direct: !session.isVcenter, ...(session.isVcenter && { vcenterHost: fallbackHost }) }
      })
      return new Map(vmIds.map((id, k) => [id, read[k] ?? { ok: false, error: "the source did not answer in time" }]))
    } finally {
      await soapLogout(session).catch(() => {})
    }
  } catch (e: any) {
    return failed(String(e?.message || e))
  }
}

/** One probe per distinct (node, address), from the node, a few at a time. */
export async function probeCopyPairs(targetConnectionId: string, pairs: Array<{ node: string; address: string; direct: boolean; vcenterHost?: string }>): Promise<Map<string, NfcReachability>> {
  const unique = [...new Map(pairs.map(p => [pairKey(p.node, p.address, p.direct), p])).values()]
  const results = await mapBounded(unique, COPY_PROBE_CONCURRENCY, Date.now() + COPY_PROBE_DEADLINE_MS,
    p => runWarmCopyReachability(targetConnectionId, p.node, p.address, p.direct, p.vcenterHost))
  return new Map(unique.map((p, k) => [pairKey(p.node, p.address, p.direct), results[k] ?? { address: p.address, ports: {}, ok: false, error: "probe timed out" }]))
}

/** Read, probe and place: the whole check for a batch. */
export async function checkBatchCopyNetwork(a: {
  tenantId: string; sourceConnectionId: string; targetConnectionId: string; pinnedDevice?: string
  vms: CopyCheckVm[]; candidates: string[]; auto: boolean; requested?: Record<string, string>
}): Promise<CopyPlan> {
  const targets = await readBatchCopyTargets(a.tenantId, a.sourceConnectionId, a.vms.map(v => v.sourceVmId), a.pinnedDevice)
  const nodesOf = (id: string) => (a.auto ? a.candidates : [a.requested?.[id] ?? a.candidates[0]].filter(Boolean) as string[])
  const pairs: Array<{ node: string; address: string; direct: boolean; vcenterHost?: string }> = []
  for (const vm of a.vms) {
    const t = targets.get(vm.sourceVmId)
    if (t?.ok) for (const node of nodesOf(vm.sourceVmId)) pairs.push({ node, address: t.address, direct: t.direct, vcenterHost: t.vcenterHost })
  }
  const reach = await probeCopyPairs(a.targetConnectionId, pairs)
  return planCopyNodes({ vms: a.vms, candidates: a.candidates, auto: a.auto, requested: a.requested, targets, reach })
}
