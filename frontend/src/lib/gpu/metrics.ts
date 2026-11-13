// GPU load and pressure (#672): calls of the orchestrator's /gpu/metrics/*
// and the join of its readings with the GPU report the caller may see.
//
// Readings are keyed by the orchestrator as "vm:<vmid>:<uuid>" (read inside a
// guest: a passthrough card is invisible to its host) or
// "node:<node>:<bus id>" (read from the host driver). The join attaches each
// one to a device of the inventory and drops whatever the report does not
// show the caller, so a reading never reveals a VM or a node out of scope.
import { NextResponse } from 'next/server'

import { Features } from '@/lib/license/features'
import { safeLog } from '@/lib/log/sanitize'
import { orchestratorFetch, parseOrchestratorError } from '@/lib/orchestrator/client'
import { ORCHESTRATOR_UNAVAILABLE } from '@/lib/orchestrator/replicationError'

import type { GpuReport } from './report'

export * from './metricsShared'
import type { GpuTargetInfo, OrchestratorGpu, OrchestratorSeriesPoint, OrchestratorSnapshot, GpuMetricsSettings, OrchestratorVgpu, VisibleGpuReading, VisibleSeries, VisibleVgpu, VisibleVgpuType } from './metricsShared'

// ---- orchestrator calls ------------------------------------------------------

export const getGpuMetricsSettings = () => orchestratorFetch<GpuMetricsSettings>('/gpu/metrics/settings')

export const putGpuMetricsSettings = (body: GpuMetricsSettings) =>
  orchestratorFetch<GpuMetricsSettings>('/gpu/metrics/settings', { method: 'PUT', body })

export const getGpuMetricsLatest = () => orchestratorFetch<OrchestratorSnapshot>('/gpu/metrics/latest')

export const getGpuMetricsSeries = (body: { from: string; to: string; step_seconds: number; connection_ids: string[] }) =>
  orchestratorFetch<{ step_seconds: number; points: OrchestratorSeriesPoint[] }>('/gpu/metrics/series', { method: 'POST', body })

export const probeGpuMetrics = (body: { connection_id: string; vmid?: number; node?: string }) =>
  orchestratorFetch<OrchestratorSnapshot>('/gpu/metrics/probe', { method: 'POST', body, timeout: 45000 })

// ---- errors -----------------------------------------------------------------

const SHORT_CODE = /^[a-z][a-z_]{0,63}$/

export const gpuCode = (error: string, status: number) => NextResponse.json({ error }, { status })

export const gpuFeatureRequired = () =>
  NextResponse.json({ error: 'feature_required', feature: Features.GPU_MANAGEMENT }, { status: 403 })

/** A short code for a failed orchestrator call, never the upstream text. */
export function gpuMetricsErrorResponse(error: unknown, context: string): NextResponse {
  const upstream = parseOrchestratorError(error)
  if (upstream) {
    if (upstream.status === 403 && upstream.details?.code === 'FEATURE_REQUIRED') return gpuFeatureRequired()
    if (upstream.status === 400) return gpuCode(SHORT_CODE.test(upstream.message) ? upstream.message : 'invalid_request', 400)
    console.error(`[gpu-metrics] ${context}: orchestrator ${upstream.status}`, safeLog(upstream.message))
    return gpuCode('orchestrator_unavailable', 503)
  }
  const code = (error as { code?: string } | null)?.code
  const message = error instanceof Error ? error.message : String(error)
  if (code === ORCHESTRATOR_UNAVAILABLE || message === 'Orchestrator request timeout') return gpuCode('orchestrator_unavailable', 503)
  console.error(`[gpu-metrics] ${context}:`, safeLog(message))
  return gpuCode('internal_error', 500)
}

// ---- join with the visible report ---------------------------------------------

const vmKey = (connId: string, vmid: string | number) => `${connId}|${vmid}`

/**
 * Resolves a reading target to a device of the report, or null when the
 * caller may not see it. A guest reading belongs to the VM's GPUs: the n-th
 * GPU the guest reports is the n-th GPU allocation of the VM in PCI order (a
 * guest renumbers the cards, the order is what survives). A host reading
 * belongs to the device at that bus address.
 */
export function targetResolver(report: GpuReport) {
  const vmGpus = new Map<string, Array<{ deviceKey: string | null; pciId: string | null; node: string; vmName: string | null; connectionName: string; deviceName: string | null }>>()
  for (const a of report.allocations) {
    if (a.hidden || !a.vmid || a.kind !== 'gpu') continue
    const key = vmKey(a.connId, a.vmid)
    const list = vmGpus.get(key) ?? []
    list.push({ deviceKey: a.deviceKey, pciId: a.pciId, node: a.node, vmName: a.vmName, connectionName: a.connectionName, deviceName: a.deviceName })
    vmGpus.set(key, list)
  }
  for (const list of vmGpus.values()) list.sort((x, y) => (x.pciId ?? '').localeCompare(y.pciId ?? ''))

  const devices = new Map(report.devices.map(d => [`${d.connId}|${d.node}|${d.slot}`, d]))
  const visibleNodes = new Set(report.nodes.map(n => `${n.connId}|${n.node}`))

  return (connId: string, target: string, guestIndex: number): GpuTargetInfo | null => {
    const vm = /^vm:(\d+):/.exec(target)
    if (vm) {
      const list = vmGpus.get(vmKey(connId, vm[1]))
      if (!list?.length) return null
      const own = list[Math.min(guestIndex, list.length - 1)]
      return { deviceKey: own.deviceKey, connectionName: own.connectionName, node: own.node, vmid: vm[1], vmName: own.vmName, deviceName: own.deviceName }
    }
    const host = /^node:(.+):([0-9a-f]{4}:[0-9a-f]{2}:[0-9a-f]{2})$/.exec(target)
    if (host) {
      const [, node, slot] = host
      if (!visibleNodes.has(`${connId}|${node}`)) return null
      const d = devices.get(`${connId}|${node}|${slot}`)
      // A card shared out as vGPUs is nobody's: its host reading is the card's.
      const holder = d?.vgpu ? undefined : d?.vms.find(v => !v.hidden)
      return {
        deviceKey: d?.key ?? null,
        connectionName: d?.connectionName ?? report.nodes.find(n => n.connId === connId)?.connectionName ?? '',
        node,
        vmid: holder?.vmid ?? null,
        vmName: holder?.vmName ?? null,
        deviceName: d?.deviceName ?? null,
      }
    }
    return null
  }
}


/** The latest readings and probe outcomes the caller may see. */
export function visibleLatest(report: GpuReport, snap: OrchestratorSnapshot) {
  const resolve = targetResolver(report)
  const gpus: VisibleGpuReading[] = []
  for (const g of snap.gpus) {
    const info = resolve(g.connection_id, g.target, g.index)
    if (info) {
      const { vmid: _vmid, ...reading } = g
      gpus.push({ ...reading, ...info })
    }
  }
  const visibleVm = new Set(report.allocations.filter(a => !a.hidden && a.vmid).map(a => vmKey(a.connId, a.vmid as string)))
  const visibleNode = new Set(report.nodes.map(n => `${n.connId}|${n.node}`))
  const probes = snap.probes.filter(p =>
    p.kind === 'guest' ? visibleVm.has(vmKey(p.connection_id, p.vmid ?? '')) : visibleNode.has(`${p.connection_id}|${p.node ?? ''}`),
  )
  const deviceKeys = new Set(report.devices.map(d => d.key))
  const vgpuTypes: VisibleVgpuType[] = (snap.vgpu_types ?? [])
    .map(t => ({ deviceKey: `${t.connection_id}:${t.node}:${t.bus_id}`, typeId: t.type_id, name: t.name, fbMemory: t.fb_memory, maxInstances: t.max_instances }))
    .filter(t => deviceKeys.has(t.deviceKey))
  return { at: snap.at, gpus, probes, vgpus: visibleVgpus(report, snap.vgpus ?? []), vgpuTypes }
}

/**
 * The running vGPUs whose VM the caller may see, tied to their card and VMID
 * through the SMBIOS UUID the host driver reports. A vGPU of a VM the caller
 * may not see is left out, whoever holds the card.
 */
export function visibleVgpus(report: GpuReport, vgpus: OrchestratorVgpu[]): VisibleVgpu[] {
  const byUuid = new Map<string, GpuReport['allocations'][number]>()
  for (const a of report.allocations) {
    if (!a.hidden && a.vmid && a.smbiosUuid && a.mdev) byUuid.set(`${a.connId}|${a.node}|${a.smbiosUuid}`, a)
  }
  const out: VisibleVgpu[] = []
  for (const v of vgpus) {
    const a = byUuid.get(`${v.connection_id}|${v.node}|${v.vm_uuid.toLowerCase()}`)
    if (!a?.deviceKey || !a.vmid) continue
    out.push({
      deviceKey: a.deviceKey,
      connectionId: v.connection_id,
      node: v.node,
      vmid: a.vmid,
      vmName: a.vmName,
      profile: v.type_name,
      typeId: v.type_id,
      fbTotal: v.fb_total,
      fbUsed: v.fb_used,
      util: v.util,
      memUtil: v.mem_util,
      licensed: v.licensed,
      guestDriver: v.guest_driver,
      at: v.at,
    })
  }
  return out
}


/**
 * Groups the bucketed points per GPU the caller may see. The guest index of a
 * series is read from its latest reading (same target), 0 when the GPU is no
 * longer read.
 */
export function visibleSeries(report: GpuReport, points: OrchestratorSeriesPoint[], latest: OrchestratorGpu[]): VisibleSeries[] {
  const resolve = targetResolver(report)
  const indexOf = new Map(latest.map(g => [`${g.connection_id}|${g.target}`, g.index]))
  // null marks a target the caller may not see, resolved once.
  const out = new Map<string, VisibleSeries | null>()
  for (const p of points) {
    const key = `${p.connection_id}|${p.target}`
    let series = out.get(key)
    if (series === undefined) {
      const info = resolve(p.connection_id, p.target, indexOf.get(key) ?? 0)
      series = info ? { ...info, connectionId: p.connection_id, target: p.target, points: [] } : null
      out.set(key, series)
    }
    if (!series) continue
    const { connection_id: _c, target: _t, ...rest } = p
    series.points.push(rest)
  }
  return [...out.values()].filter((v): v is VisibleSeries => v !== null).sort((a, b) => a.connectionName.localeCompare(b.connectionName) || a.target.localeCompare(b.target))
}
