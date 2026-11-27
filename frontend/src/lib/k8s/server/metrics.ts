// Step 1: How to call metrics.k8s.io with @kubernetes/client-node@1.x
//
// The library ships a `Metrics` class (dist/metrics.js) that wraps the
// raw aggregated-API endpoint: GET /apis/metrics.k8s.io/v1beta1/nodes.
// It accepts the KubeConfig instance and calls config.applyToFetchOptions()
// internally, which in turn calls this.createAgent() — the very same method
// we monkey-patch in buildKubeClient to inject our guarded SSRF-blocking
// transport. So passing `built.kc` to `new Metrics(built.kc)` is sufficient;
// no separate agent injection is needed.
//
// `Metrics.getNodeMetrics()` returns a NodeMetricsList where each item has:
//   item.metadata.name      — node name
//   item.timestamp          — RFC3339 sample time
//   item.usage.cpu          — CPU usage string (e.g. "250m")
//   item.usage.memory       — memory usage string (e.g. "512Mi")
//
// Quantity parsing: the library does NOT export a quantity parser. We use the
// same logic as the Go side: cpu strings ending in "m" are millicores; bare
// numbers are whole cores (multiply by 1000). Memory strings use SI/IEC
// suffixes (Ki, Mi, Gi, Ti, Pi, Ei, k, M, G, T, P, E).

import { Metrics } from '@kubernetes/client-node'
import { CoreV1Api } from '@kubernetes/client-node'
import type { NodeMetricsResult, NodeUtilization, PodMetricsResult, PodUtilization } from '../types'
import { pct } from '../metrics'
import type { K8sErrorCode } from './errors'
import { buildKubeClient, type BuildKubeClientInput } from './client'
import { classifyK8sError } from './errors'

export type GetNodeMetricsInput = BuildKubeClientInput

// ---------------------------------------------------------------------------
// Quantity parsing
// ---------------------------------------------------------------------------

const SI_SUFFIXES: Record<string, number> = {
  k: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18,
}
const IEC_SUFFIXES: Record<string, number> = {
  Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, Pi: 1024 ** 5, Ei: 1024 ** 6,
}

/** Parse a Kubernetes CPU quantity string to millicores (integer). */
export function parseCpuMillis(raw: string): number {
  if (!raw) return 0
  if (raw.endsWith('m')) return Math.floor(Number(raw.slice(0, -1)))
  // Whole cores (no suffix, or 'n' nanocores)
  if (raw.endsWith('n')) return Math.floor(Number(raw.slice(0, -1)) / 1e6)
  if (raw.endsWith('u')) return Math.floor(Number(raw.slice(0, -1)) / 1e3)
  return Math.floor(Number(raw) * 1000)
}

/** Parse a Kubernetes memory quantity string to bytes (integer). */
export function parseMemBytes(raw: string): number {
  if (!raw) return 0
  // IEC (Ki, Mi, Gi, …) — must check before SI to avoid "M" matching "Mi"
  for (const [suffix, mult] of Object.entries(IEC_SUFFIXES)) {
    if (raw.endsWith(suffix)) return Math.floor(Number(raw.slice(0, -suffix.length)) * mult)
  }
  // SI (k, M, G, …)
  for (const [suffix, mult] of Object.entries(SI_SUFFIXES)) {
    if (raw.endsWith(suffix)) return Math.floor(Number(raw.slice(0, -1)) * mult)
  }
  return Math.floor(Number(raw))
}

// ---------------------------------------------------------------------------
// Error classification (mirrors classifyMetricsError in metrics.go)
//
// The @kubernetes/client-node Metrics class throws ApiException on non-200.
// ApiException carries `.code` (the HTTP status).  A missing metrics-server
// surfaces as 404 (API group not registered) or 503 (aggregated API not
// ready); both map to `metrics_unavailable`.
// ---------------------------------------------------------------------------

export function classifyMetricsError(err: unknown): K8sErrorCode {
  const e = err as { code?: number; statusCode?: number; response?: { statusCode?: number } }
  const status = e?.code ?? e?.statusCode ?? e?.response?.statusCode
  if (status === 404 || status === 503) return 'metrics_unavailable'
  if (status === 401) return 'auth_failed'
  if (status === 403) return 'forbidden'
  return 'unreachable'
}

// ---------------------------------------------------------------------------
// Core join logic (pure, no I/O — easily unit-testable)
// ---------------------------------------------------------------------------

export interface RawNodeMetric {
  name: string
  timestamp?: string   // RFC3339
  cpuRaw: string       // e.g. "250m"
  memRaw: string       // e.g. "512Mi"
}

export interface RawNodeAlloc {
  name: string
  cpuAllocMilli: number
  memAllocBytes: number
}

/**
 * Join raw metrics samples with allocatable values.
 *
 * Rules (mirrors nodeMetricsWith in metrics.go):
 * - A node is included only when it has BOTH a metrics sample AND positive
 *   (> 0) allocatable CPU AND allocatable memory.
 * - Metrics items with no matching allocatable entry are silently dropped.
 * - Duplicate metrics entries for the same node are de-duped (first wins).
 * - Result is sorted ascending by node name.
 * - sampleTime is the OLDEST included sample timestamp (RFC3339 UTC).
 * - totalNodes = len(allocs); reportingNodes = len(result nodes).
 */
export function joinMetrics(
  metrics: RawNodeMetric[],
  allocs: RawNodeAlloc[],
): { nodes: NodeUtilization[]; reportingNodes: number; totalNodes: number; sampleTime?: string } {
  const allocMap = new Map<string, RawNodeAlloc>()
  for (const a of allocs) allocMap.set(a.name, a)

  const out: NodeUtilization[] = []
  const seen = new Set<string>()
  let oldest: Date | undefined

  for (const m of metrics) {
    const a = allocMap.get(m.name)
    if (!a || a.cpuAllocMilli <= 0 || a.memAllocBytes <= 0) continue
    if (seen.has(m.name)) continue
    seen.add(m.name)

    out.push({
      name: m.name,
      cpuUsedMilli: parseCpuMillis(m.cpuRaw),
      cpuAllocMilli: a.cpuAllocMilli,
      memUsedBytes: parseMemBytes(m.memRaw),
      memAllocBytes: a.memAllocBytes,
    })

    if (m.timestamp) {
      const t = new Date(m.timestamp)
      if (!isNaN(t.getTime()) && (!oldest || t < oldest)) oldest = t
    }
  }

  out.sort((a, b) => a.name.localeCompare(b.name))

  return {
    nodes: out,
    reportingNodes: out.length,
    totalNodes: allocs.length,
    sampleTime: oldest ? oldest.toISOString().replace(/\.\d{3}Z$/, 'Z') : undefined,
  }
}

// ---------------------------------------------------------------------------
// Pod metrics: per-pod usage as a % of its node's allocatable (pure helpers)
// ---------------------------------------------------------------------------

export interface RawPodUsage { namespace: string; name: string; cpuUsedMilli: number; memUsedBytes: number }
export interface NodeAlloc { cpuAllocMilli: number; memAllocBytes: number }

/** Sum each pod's per-container usage (metrics.k8s.io reports usage per container). */
export function podUsagesFromMetricsList(items: any[]): RawPodUsage[] {
  const out: RawPodUsage[] = []
  for (const it of items ?? []) {
    const namespace = it?.metadata?.namespace ?? ''
    const name = it?.metadata?.name ?? ''
    if (!name) continue
    let cpuUsedMilli = 0
    let memUsedBytes = 0
    for (const c of (it?.containers ?? [])) {
      cpuUsedMilli += parseCpuMillis(c?.usage?.cpu ?? '')
      memUsedBytes += parseMemBytes(c?.usage?.memory ?? '')
    }
    out.push({ namespace, name, cpuUsedMilli, memUsedBytes })
  }
  return out
}

/**
 * Join pod usage with the allocatable of the node each pod runs on → percentage
 * utilisation. Pods whose node is unknown, or whose node has no positive
 * allocatable, are dropped (their columns stay blank) so the % is always
 * relative to a real node capacity. Result sorted by namespace then name.
 */
export function joinPodMetrics(
  usages: RawPodUsage[],
  podNode: Map<string, string>,       // `${namespace}/${name}` → nodeName
  nodeAlloc: Map<string, NodeAlloc>,  // nodeName → allocatable
): PodUtilization[] {
  const out: PodUtilization[] = []
  for (const u of usages) {
    const node = podNode.get(`${u.namespace}/${u.name}`)
    if (!node) continue
    const alloc = nodeAlloc.get(node)
    if (!alloc || alloc.cpuAllocMilli <= 0 || alloc.memAllocBytes <= 0) continue
    out.push({
      namespace: u.namespace,
      name: u.name,
      cpuPct: pct(u.cpuUsedMilli, alloc.cpuAllocMilli),
      memPct: pct(u.memUsedBytes, alloc.memAllocBytes),
    })
  }
  out.sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name))
  return out
}

// ---------------------------------------------------------------------------
// Public function
// ---------------------------------------------------------------------------

export async function getNodeMetrics(
  input: GetNodeMetricsInput,
): Promise<{ ok: boolean; errorCode?: K8sErrorCode; value?: NodeMetricsResult }> {
  const built = buildKubeClient(input)
  if (!built.ok || !built.makeApiClient || !built.kc) {
    return { ok: false, errorCode: 'config' as K8sErrorCode, value: { nodes: [], totalNodes: 0, reportingNodes: 0, errorCode: 'config', errorMessage: built.error ?? 'client init failed' } }
  }

  // 1. Fetch canonical node list (allocatable CPU + memory).
  const coreApi = built.makeApiClient(CoreV1Api)
  let nodeList: Awaited<ReturnType<typeof coreApi.listNode>>
  try {
    nodeList = await coreApi.listNode()
  } catch (err) {
    const errorCode = classifyK8sError(err)
    return { ok: false, errorCode, value: { nodes: [], totalNodes: 0, reportingNodes: 0, errorCode, errorMessage: 'node list failed' } }
  }

  const allocs: RawNodeAlloc[] = (nodeList?.items ?? []).map((n: any) => ({
    name: n.metadata?.name ?? '',
    cpuAllocMilli: parseCpuMillis(n.status?.allocatable?.cpu ?? ''),
    memAllocBytes: parseMemBytes(n.status?.allocatable?.memory ?? ''),
  })).filter((a: RawNodeAlloc) => a.name !== '')

  // 2. Fetch metrics samples via the Metrics class (uses guarded KubeConfig).
  const metricsClient = new Metrics(built.kc)
  let metricsList: Awaited<ReturnType<typeof metricsClient.getNodeMetrics>>
  try {
    metricsList = await metricsClient.getNodeMetrics()
  } catch (err) {
    const errorCode = classifyMetricsError(err)
    // Still return totalNodes so the UI can show "0 / N reporting"
    return {
      ok: false,
      errorCode,
      value: {
        nodes: [],
        totalNodes: allocs.length,
        reportingNodes: 0,
        errorCode,
        errorMessage: 'metrics list failed',
      },
    }
  }

  // 3. Join metrics samples with allocatable values.
  const rawMetrics: RawNodeMetric[] = (metricsList?.items ?? []).map((m: any) => ({
    name: m.metadata?.name ?? '',
    timestamp: m.timestamp ?? undefined,
    cpuRaw: m.usage?.cpu ?? '',
    memRaw: m.usage?.memory ?? '',
  })).filter((m: RawNodeMetric) => m.name !== '')

  const joined = joinMetrics(rawMetrics, allocs)

  return {
    ok: true,
    value: {
      nodes: joined.nodes,
      totalNodes: joined.totalNodes,
      reportingNodes: joined.reportingNodes,
      sampleTime: joined.sampleTime,
    },
  }
}

export async function getPodMetrics(
  input: GetNodeMetricsInput,
): Promise<{ ok: boolean; errorCode?: K8sErrorCode; value?: PodMetricsResult }> {
  const built = buildKubeClient(input)
  if (!built.ok || !built.makeApiClient || !built.kc) {
    return { ok: false, errorCode: 'config' as K8sErrorCode, value: { pods: [], errorCode: 'config', errorMessage: built.error ?? 'client init failed' } }
  }

  const coreApi = built.makeApiClient(CoreV1Api)

  // 1. Node allocatable (the denominator for each pod's %).
  let nodeList: Awaited<ReturnType<typeof coreApi.listNode>>
  try {
    nodeList = await coreApi.listNode()
  } catch (err) {
    const errorCode = classifyK8sError(err)
    return { ok: false, errorCode, value: { pods: [], errorCode, errorMessage: 'node list failed' } }
  }
  const nodeAlloc = new Map<string, NodeAlloc>()
  for (const n of (nodeList?.items ?? [])) {
    const name = n.metadata?.name
    if (name) {
      nodeAlloc.set(name, {
        cpuAllocMilli: parseCpuMillis(n.status?.allocatable?.cpu ?? ''),
        memAllocBytes: parseMemBytes(n.status?.allocatable?.memory ?? ''),
      })
    }
  }

  // 2. Pod → scheduling node (pod metrics samples don't carry the node name).
  let podList: Awaited<ReturnType<typeof coreApi.listPodForAllNamespaces>>
  try {
    podList = await coreApi.listPodForAllNamespaces()
  } catch (err) {
    const errorCode = classifyK8sError(err)
    return { ok: false, errorCode, value: { pods: [], errorCode, errorMessage: 'pod list failed' } }
  }
  const podNode = new Map<string, string>()
  for (const p of (podList?.items ?? [])) {
    const ns = p.metadata?.namespace ?? ''
    const name = p.metadata?.name ?? ''
    const node = p.spec?.nodeName
    if (name && node) podNode.set(`${ns}/${name}`, node)
  }

  // 3. Live pod usage samples via metrics.k8s.io (guarded KubeConfig).
  const metricsClient = new Metrics(built.kc)
  let podMetricsList: Awaited<ReturnType<typeof metricsClient.getPodMetrics>>
  try {
    podMetricsList = await metricsClient.getPodMetrics()
  } catch (err) {
    const errorCode = classifyMetricsError(err)
    return { ok: false, errorCode, value: { pods: [], errorCode, errorMessage: 'pod metrics failed' } }
  }

  const usages = podUsagesFromMetricsList(podMetricsList?.items ?? [])
  return { ok: true, value: { pods: joinPodMetrics(usages, podNode, nodeAlloc) } }
}
