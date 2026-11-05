// Moving a GPU VM to another node (#672, lot C): where can it go?
//
// A GPU follows a VM only through a resource mapping: PVE resolves the
// mapping on the target node at the next start and refuses the migration when
// the mapping has no entry there. A raw PCI address names a slot of the
// source host and cannot follow. The VM must be stopped: a passthrough GPU
// cannot live-migrate (live-migration-capable vGPU mappings excepted, not
// handled here). Pure, read on the GPU report the page already holds.
import type { GpuReport } from './report'

export type MoveTarget = { node: string; freeGpus: number; models: string[] }

export type MovePlan =
  | { ok: true; targets: MoveTarget[]; mappings: string[] }
  | { ok: false; reason: 'not_found' | 'vm_running' | 'raw_allocation' | 'no_target'; mappings: string[] }

/** The nodes a stopped VM can move to with its GPUs, the most free GPUs first. */
export function moveTargets(report: GpuReport, connId: string, node: string, vmid: string): MovePlan {
  const own = report.allocations.filter(a => a.connId === connId && a.node === node && a.vmid === vmid && a.kind === 'gpu' && !a.hidden)
  if (!own.length) return { ok: false, reason: 'not_found', mappings: [] }
  if (own.some(a => a.via !== 'mapping' || !a.mapping)) return { ok: false, reason: 'raw_allocation', mappings: [] }
  if (own.some(a => a.vmStatus === 'running')) return { ok: false, reason: 'vm_running', mappings: [] }

  // GPUs the VM needs per mapping (a VM may hold two through the same one).
  const need = new Map<string, number>()
  for (const a of own) need.set(a.mapping as string, (need.get(a.mapping as string) ?? 0) + 1)
  const mappings = [...need.keys()]

  const targets: MoveTarget[] = []
  const nodes = report.nodes.filter(n => n.connId === connId && n.node !== node && n.online && !n.error)
  for (const n of nodes) {
    const free = report.devices.filter(
      d => d.connId === connId && d.node === n.node && d.kind === 'gpu' && d.vms.every(v => v.template),
    )
    const fits = mappings.every(m => free.filter(d => d.mappings.includes(m)).length >= (need.get(m) ?? 0))
    if (!fits) continue
    const usable = free.filter(d => mappings.some(m => d.mappings.includes(m)))
    targets.push({ node: n.node, freeGpus: usable.length, models: [...new Set(usable.map(d => d.deviceName ?? '?'))] })
  }
  targets.sort((a, b) => b.freeGpus - a.freeGpus || a.node.localeCompare(b.node))
  return targets.length ? { ok: true, targets, mappings } : { ok: false, reason: 'no_target', mappings }
}
