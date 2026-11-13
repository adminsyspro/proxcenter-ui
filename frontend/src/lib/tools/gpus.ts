/**
 * get_gpus: the GPUs of the clusters the caller sees (#672), who holds them,
 * how loaded they are and what is free, for the assistant.
 *
 * Reads the GPU report of the page (lib/gpu/visibleReport: the same RBAC and
 * vDC scope as the caller, cached 60 s per connection) and, with the
 * gpu_management licence, the last round of load readings from the
 * orchestrator. Arguments only narrow what that report already shows: no
 * value of the model ever reaches Proxmox.
 */
import { hasServerFeature } from '@/lib/auth/requireEnterprise'
import { modelBreakdown } from '@/lib/gpu/fleet'
import { getGpuMetricsLatest, getGpuMetricsSettings, readingPerDevice, visibleLatest } from '@/lib/gpu/metrics'
import type { VisibleVgpu, VisibleVgpuType } from '@/lib/gpu/metricsShared'
import { memoryPct, pressureOf, type GpuThresholds } from '@/lib/gpu/pressure'
import { isComputeProfile, parseProfile, profileCapacity, profileName } from '@/lib/gpu/vgpu'
import { loadVisibleGpuReport } from '@/lib/gpu/visibleReport'
import { Features } from '@/lib/license/features'

import { argString, type CatalogTool } from './types'

/** Rows handed to the model: enough to answer, small enough for a local model's context. */
export const GPU_TOOL_MAX_ROWS = 40

const round = (n: number) => Math.round(n)

type Report = Awaited<ReturnType<typeof loadVisibleGpuReport>>

type Live = { gpus: ReturnType<typeof visibleLatest>['gpus']; vgpus: VisibleVgpu[]; vgpuTypes: VisibleVgpuType[]; thresholds: GpuThresholds }

async function liveReadings(report: Report): Promise<Live | null> {
  if (!(await hasServerFeature(Features.GPU_MANAGEMENT))) return null
  try {
    const [snap, settings] = await Promise.all([getGpuMetricsLatest(), getGpuMetricsSettings()])
    const latest = visibleLatest(report, snap)
    return { gpus: latest.gpus, vgpus: latest.vgpus, vgpuTypes: latest.vgpuTypes, thresholds: settings.thresholds }
  } catch {
    // The orchestrator does not answer: the inventory still does.
    return null
  }
}

function statusOf(d: Report['devices'][number]): 'free' | 'allocated' | 'in_use' | 'vgpu' {
  if (d.vgpu?.mode === 'sriov') return 'vgpu'
  if (d.vms.some(v => v.vmStatus === 'running')) return 'in_use'
  return d.vms.length ? 'allocated' : 'free'
}

export const getGpusTool: CatalogTool = {
  name: 'get_gpus',
  readOnly: true,
  description:
    'GPUs of the clusters: model, cluster and node, free or held by which VM, and when measured their live load, GPU memory, temperature and pressure (saturated, memory full, hot, slowed down). Also the free GPUs per model. A card in vGPU mode (status vgpu) is shared between VMs: it lists its vGPUs (VM, profile such as 12Q = 12 GiB of GPU memory, memory used, share of the card, license) and how many more of each compute profile it can still take. Answers "how many GPUs are free?", "which VM uses the A5000?", "which GPUs are saturated?", "where can I place a VM that needs a GPU, or a vGPU 8Q?". Example: free_only=true',
  parameters: {
    type: 'object',
    properties: {
      cluster: { type: 'string', description: 'Cluster name, only when the user names one.' },
      model: { type: 'string', description: 'Part of a GPU model name (e.g. "A5000", "L40S"), only when the user names one.' },
      free_only: { type: 'boolean', description: 'Only the GPUs no VM holds.' },
      pressure_only: { type: 'boolean', description: 'Only the GPUs under pressure right now.' },
    },
  },
  execute: async (args, _ctx) => {
    const cluster = argString(args, 'cluster')?.toLowerCase() ?? null
    const model = argString(args, 'model')?.toLowerCase() ?? null
    const freeOnly = args.free_only === true
    const pressureOnly = args.pressure_only === true

    const report = await loadVisibleGpuReport()
    if (report.scope === 'tenant') {
      // A vDC tenant has no GPU page, and the assistant tells it nothing more.
      return { unavailable: 'GPU information is not available to a vDC tenant.' }
    }

    const live = await liveReadings(report)
    const byDevice = readingPerDevice(live?.gpus ?? [])
    const catalog = live?.vgpuTypes ?? []
    // What each card in vGPU mode can still take, per compute profile.
    const capacity = new Map<string, Array<{ profile: string; memoryGiB: number; stillPossible: number }>>()
    const vgpuMemory = new Map<string, { totalGiB: number; promisedGiB: number; freeGiB: number }>()
    for (const model of profileCapacity(report.devices.filter(d => d.kind === 'gpu' && d.vgpu?.mode === 'sriov'), report.allocations, catalog)) {
      for (const c of model.cards) {
        const total = Math.round(c.fbTotal / 1024)
        const promised = Math.round(c.fbPromised / 1024)
        vgpuMemory.set(c.deviceKey, { totalGiB: total, promisedGiB: promised, freeGiB: Math.max(0, total - promised) })
      }
      for (const row of model.rows.filter(r => isComputeProfile(r.name))) {
        for (const pc of row.perCard) {
          const list = capacity.get(pc.deviceKey) ?? []
          const parsed = parseProfile(row.name)
          list.push({ profile: parsed ? `${parsed.gib}${parsed.series}` : row.name, memoryGiB: Math.round(row.fbMemory / 1024), stillPossible: pc.free })
          capacity.set(pc.deviceKey, list)
        }
      }
    }
    const vgpusOf = (d: Report['devices'][number]) =>
      report.allocations
        .filter(a => a.deviceKey === d.key && a.mdev && !a.hidden && a.vmid)
        .map(a => {
          const v = live?.vgpus.find(x => x.vmid === a.vmid && x.deviceKey === d.key)
          const name = v?.profile ?? profileName(a.mdev, d.key, catalog)
          const parsed = name ? parseProfile(name) : null
          return {
            vm: a.vmName,
            vmid: a.vmid,
            status: a.vmStatus,
            profile: parsed ? `${parsed.gib}${parsed.series}` : (name ?? a.mdev),
            ...(v
              ? {
                  memoryGiB: Math.round(v.fbTotal / 1024),
                  memoryUsedGiB: Math.round((v.fbUsed / 1024) * 10) / 10,
                  shareOfCardPct: Math.round(v.util),
                  licensed: v.licensed,
                }
              : {}),
          }
        })

    const rows = report.devices
      .filter(d => d.kind === 'gpu')
      .filter(d => !cluster || d.connectionName.toLowerCase() === cluster)
      .filter(d => !model || `${d.vendorName ?? ''} ${d.deviceName ?? ''}`.toLowerCase().includes(model))
      .map(d => {
        const r = byDevice.get(d.key)
        const p = r && live ? pressureOf(r, live.thresholds) : null
        const holders = d.vms.filter(v => !v.hidden)
        return {
          cluster: d.connectionName,
          node: d.node,
          model: d.deviceName ?? d.vendorName ?? '?',
          pci: d.id,
          status: statusOf(d),
          vms: holders.map(v => ({ name: v.vmName, vmid: v.vmid, status: v.vmStatus, template: v.template || undefined, vgpuProfile: v.mdev ?? undefined })),
          ...(holders.length < d.vms.length ? { hiddenVms: d.vms.length - holders.length } : {}),
          passthroughReady: d.iommuIsolated,
          ...(d.vgpu?.mode === 'sriov'
            ? {
                vgpus: vgpusOf(d),
                // The GPU memory the profiles of its VMs promise (stopped VMs included): what decides whether a profile still fits.
                vgpuMemory: vgpuMemory.get(d.key) ?? null,
                profilesStillPossible: capacity.get(d.key) ?? 'host not read: add the node to the GPU load settings',
              }
            : {}),
          ...(r
            ? {
                loadPct: round(r.util),
                memoryUsedPct: round(memoryPct(r.mem_used, r.mem_total)),
                memoryTotalGiB: Math.round(r.mem_total / 1024),
                temperatureC: round(r.temp),
                powerW: round(r.power),
                pressure: Object.entries(p ?? {}).filter(([, v]) => v).map(([k]) => k),
              }
            : { measured: false }),
        }
      })
      .filter(r => !freeOnly || r.status === 'free')
      .filter(r => !pressureOnly || ('pressure' in r && r.pressure.length > 0))

    const models = modelBreakdown(report).map(m => ({ model: m.deviceName ?? '?', total: m.total, free: m.free, inUse: m.inUse, clusters: m.clusters }))
    return {
      totals: report.capacity,
      byModel: models,
      gpus: rows.slice(0, GPU_TOOL_MAX_ROWS),
      ...(rows.length > GPU_TOOL_MAX_ROWS ? { truncated: rows.length - GPU_TOOL_MAX_ROWS } : {}),
      loadMeasured: !!live,
      ...(report.connections.some(c => c.error) ? { unreadableClusters: report.connections.filter(c => c.error).map(c => c.name) } : {}),
    }
  },
}
