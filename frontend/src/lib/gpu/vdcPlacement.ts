// Which card serves a vDC contingent line (#672): the cards of the entry's
// model on the VM's node, best first. Pure and client-safe.
import type { VisibleVgpuType } from './metricsShared'
import type { GpuReport, GpuReportDevice } from './report'
import { modelKeyOf, type VdcGpuEntry } from './vdcQuota'
import { mdevTypeId, profileCapacity } from './vgpu'

export type Placement = { device: GpuReportDevice; profile: string | null }

/**
 * The cards that can take one more unit of the entry on this node. Whole
 * cards: not shared out as vGPU and without any allocation (templates and
 * hidden VMs included). vGPU: a card with room for the profile, the ones
 * already carrying it first, then the most free frame buffer; ties by key.
 */
export function rankPlacements(report: GpuReport, catalog: VisibleVgpuType[], entry: VdcGpuEntry, node: string): Placement[] {
  const cards = report.devices.filter((d) => d.node === node && d.kind === 'gpu' && modelKeyOf(d) === entry.modelKey)
  const byKey = (a: Placement, b: Placement) => a.device.key.localeCompare(b.device.key)

  if (entry.kind === 'whole') {
    const taken = new Set(report.allocations.map((a) => a.deviceKey))
    return cards
      .filter((d) => d.vgpu?.mode !== 'sriov' && !taken.has(d.key))
      .map((device) => ({ device, profile: null }))
      .sort(byKey)
  }

  const sriov = cards.filter((d) => d.vgpu?.mode === 'sriov')
  if (!sriov.length || !catalog.length) return []
  const model = profileCapacity(sriov, report.allocations, catalog).find((m) => m.key === entry.modelKey)
  if (!model) return []

  const scored: Array<Placement & { carrying: boolean; freeFb: number }> = []
  for (const device of sriov) {
    const type = catalog.find((t) => t.deviceKey === device.key && t.name === entry.profileName)
    const card = model.cards.find((c) => c.deviceKey === device.key)
    const free = model.rows.find((r) => r.typeId === type?.typeId)?.perCard.find((p) => p.deviceKey === device.key)?.free ?? 0
    if (!type || !card || free <= 0) continue
    const carrying = report.allocations.some((a) => a.deviceKey === device.key && !a.template && mdevTypeId(a.mdev) === type.typeId)
    scored.push({ device, profile: `nvidia-${type.typeId}`, carrying, freeFb: card.fbTotal - card.fbPromised })
  }
  return scored
    .sort((a, b) => Number(b.carrying) - Number(a.carrying) || b.freeFb - a.freeFb || byKey(a, b))
    .map(({ device, profile }) => ({ device, profile }))
}
