// Types and constants of the GPU load routes (#672) that client components
// may import: nothing here reaches the server (orchestrator client, headers).
// The server side lives in ./metrics.

export type GpuMetricsSettings = {
  enabled: boolean
  interval_seconds: number
  retention_days: number
  guest_vms: Array<{ connection_id: string; vmid: number }>
  host_nodes: Array<{ connection_id: string; node: string }>
  thresholds: { util_pct: number; memory_pct: number; temp_c: number }
  /** GPU alerts: saturated, memory full, hot, thermal slowdown, reserved idle. */
  alerts: boolean
  /** Days a stopped VM may keep a GPU before an alert; 0 off. */
  idle_days: number
}

export type OrchestratorGpu = {
  connection_id: string
  target: string
  source: 'guest' | 'host'
  node: string
  vmid?: number
  index: number
  uuid: string
  name: string
  bus_id: string
  at: string
  util: number
  mem_util: number
  mem_used: number
  mem_total: number
  temp: number
  power: number
  power_limit: number
  thermal_slow: boolean
  power_slow: boolean
}

export type OrchestratorProbe = {
  connection_id: string
  kind: 'guest' | 'host'
  vmid?: number
  node?: string
  status: string
  detail?: string
  at: string
  gpus: number
}

/** One running vGPU as the host driver reports it (`nvidia-smi vgpu -q`). */
export type OrchestratorVgpu = {
  connection_id: string
  node: string
  /** The physical card, 0000:03:00. */
  bus_id: string
  id: string
  /** SMBIOS UUID of the VM (smbios1 of its config). */
  vm_uuid: string
  vm_name: string
  /** PVE mdev type nvidia-<type_id>. */
  type_id: number
  /** RTXA5000-12Q */
  type_name: string
  fb_total: number
  fb_used: number
  util: number
  mem_util: number
  licensed: boolean
  license: string
  guest_driver: string
  at: string
}

/** One vGPU profile of a card (`nvidia-smi vgpu -s -v`). */
export type OrchestratorVgpuType = {
  connection_id: string
  node: string
  bus_id: string
  type_id: number
  name: string
  class: string
  fb_memory: number
  max_instances: number
}

export type OrchestratorSnapshot = {
  at: string
  gpus: OrchestratorGpu[]
  probes: OrchestratorProbe[]
  vgpus?: OrchestratorVgpu[]
  vgpu_types?: OrchestratorVgpuType[]
}

/** A profile of a card the caller may see: what `nvidia-<typeId>` stands for. */
export type VisibleVgpuType = { deviceKey: string; typeId: number; name: string; fbMemory: number; maxInstances: number }

/** A running vGPU tied to its card and its VM, for a caller who may see that VM. */
export type VisibleVgpu = {
  deviceKey: string
  connectionId: string
  node: string
  vmid: string
  vmName: string | null
  profile: string
  typeId: number
  fbTotal: number
  fbUsed: number
  util: number
  memUtil: number
  licensed: boolean
  guestDriver: string
  at: string
}

/**
 * One reading per card: a card shared out as vGPUs is read by its host (the
 * physical card) and by each of its VMs (their own slice), so the host
 * reading stands for the card and the guest ones belong to the vGPU view.
 */
export function readingPerDevice<T extends { deviceKey: string | null; source: string }>(readings: T[]): Map<string, T> {
  const out = new Map<string, T>()
  for (const r of readings) {
    if (!r.deviceKey) continue
    const held = out.get(r.deviceKey)
    if (!held || (held.source !== 'host' && r.source === 'host')) out.set(r.deviceKey, r)
  }
  return out
}

export type OrchestratorSeriesPoint = {
  connection_id: string
  target: string
  time: number
  util: number
  util_max: number
  mem_util: number
  mem_used: number
  mem_used_max: number
  mem_total: number
  temp_max: number
  power: number
  power_max: number
  power_limit: number
  thermal_slow: number
  power_slow: number
}

/** Where a reading belongs in the inventory, and how to name it. */
export type GpuTargetInfo = {
  deviceKey: string | null
  connectionName: string
  node: string
  vmid: string | null
  vmName: string | null
  deviceName: string | null
}

export const GPU_RANGES = {
  '1h': { seconds: 3600, step: 300 },
  '6h': { seconds: 6 * 3600, step: 300 },
  '24h': { seconds: 24 * 3600, step: 900 },
  '7d': { seconds: 7 * 86400, step: 3600 },
  '30d': { seconds: 30 * 86400, step: 6 * 3600 },
} as const

export type GpuRange = keyof typeof GPU_RANGES

export const isGpuRange = (v: unknown): v is GpuRange => typeof v === 'string' && v in GPU_RANGES

export type VisibleGpuReading = Omit<OrchestratorGpu, 'vmid'> & GpuTargetInfo

export type VisibleSeries = GpuTargetInfo & {
  connectionId: string
  target: string
  points: Array<Omit<OrchestratorSeriesPoint, 'connection_id' | 'target'>>
}
