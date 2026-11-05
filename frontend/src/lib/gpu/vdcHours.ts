// GPU hours of a vDC for one month, as its tenant reads them (#672): per VM and
// per profile, from the hourly usage rows. Hours only, no price, and nothing
// that names a node or a card: the device key is used to find the profile and
// goes no further.
import type { VisibleVgpuType } from './metricsShared'
import { profileName } from './vgpu'

export type HoursRow = {
  vmid: number
  vmName: string
  deviceKey: string
  modelName: string
  mdev: string | null
  runningSeconds: number
  reservedSeconds: number
}

export type MyGpuHours = {
  month: string
  totals: { runningHours: number; reservedHours: number }
  byVm: Array<{ vmid: string; vmName: string; label: string; runningHours: number; reservedHours: number }>
  byProfile: Array<{ label: string; runningHours: number; reservedHours: number }>
}

const round = (seconds: number) => Math.round((seconds / 3600) * 100) / 100

/** The profile name, "vGPU <model>" for a profile the catalog does not know, the model for a whole card. */
function rowLabel(row: HoursRow, catalog: VisibleVgpuType[]): string {
  if (!row.mdev) return row.modelName
  return profileName(row.mdev, row.deviceKey, catalog) ?? `vGPU ${row.modelName}`
}

type Acc = { running: number; reserved: number }

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Rows are expected oldest hour first, so the name kept for a VM is the latest
 * one. One `byVm` line per VM and profile; ties sort by VMID, then label.
 */
export function buildMyGpuHours(month: string, rows: HoursRow[], catalog: VisibleVgpuType[]): MyGpuHours {
  const names = new Map<number, string>()
  const lines = new Map<string, Acc & { vmid: number; label: string }>()
  const profiles = new Map<string, Acc>()
  const totals: Acc = { running: 0, reserved: 0 }

  for (const row of rows) {
    const label = rowLabel(row, catalog)
    names.set(row.vmid, row.vmName)

    const key = `${row.vmid}\u0000${label}`
    const line = lines.get(key) ?? { running: 0, reserved: 0, vmid: row.vmid, label }
    line.running += row.runningSeconds
    line.reserved += row.reservedSeconds
    lines.set(key, line)

    const profile = profiles.get(label) ?? { running: 0, reserved: 0 }
    profile.running += row.runningSeconds
    profile.reserved += row.reservedSeconds
    profiles.set(label, profile)

    totals.running += row.runningSeconds
    totals.reserved += row.reservedSeconds
  }

  return {
    month,
    totals: { runningHours: round(totals.running), reservedHours: round(totals.reserved) },
    byVm: [...lines.values()]
      .sort((a, b) => b.running - a.running || a.vmid - b.vmid || byText(a.label, b.label))
      .map(l => ({ vmid: String(l.vmid), vmName: names.get(l.vmid) ?? '', label: l.label, runningHours: round(l.running), reservedHours: round(l.reserved) })),
    byProfile: [...profiles.entries()]
      .sort((a, b) => b[1].running - a[1].running || byText(a[0], b[0]))
      .map(([label, p]) => ({ label, runningHours: round(p.running), reservedHours: round(p.reserved) })),
  }
}
