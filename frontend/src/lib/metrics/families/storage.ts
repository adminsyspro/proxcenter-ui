// PURE module: fleet view in, families out. No I/O, ever (D12).
import type { PublicFleetView } from "@/lib/api-tokens/publicData"
import type { MetricFamily, Sample } from "@/lib/metrics/prometheus"
import { ratio } from "@/lib/metrics/prometheus"

import { family } from "./registry"

export function buildStorageFamilies(view: PublicFleetView): MetricFamily[] {
  // `?? []` on purpose: a missing collection must yield empty families, never
  // a throw that takes the whole exposition down (#925).
  const storages = view.storages ?? []

  const totalBytesSamples: Sample[] = []
  const usedBytesSamples: Sample[] = []
  const usageRatioSamples: Sample[] = []
  const enabledSamples: Sample[] = []
  const nodeTotalBytesSamples: Sample[] = []
  const nodeUsedBytesSamples: Sample[] = []
  const nodeUsageRatioSamples: Sample[] = []

  for (const s of storages) {
    const labels = { connection: s.connectionName, storage: s.storage, type: s.type, shared: String(s.shared) }

    totalBytesSamples.push({ name: "proxcenter_storage_total_bytes", labels, value: s.total })
    usedBytesSamples.push({ name: "proxcenter_storage_used_bytes", labels, value: s.used })
    usageRatioSamples.push({
      name: "proxcenter_storage_usage_ratio",
      labels,
      value: ratio(s.used, s.total),
    })
    enabledSamples.push({
      name: "proxcenter_storage_enabled",
      labels: { connection: s.connectionName, storage: s.storage },
      value: s.enabled ? 1 : 0,
    })

    // A shared storage (a Ceph RBD pool, an NFS export) has ONE capacity for
    // the whole cluster, not one per node. `aggregateStorage` upstream has
    // already collapsed it to a single entry whose `nodes` holds a
    // representative element; re-expanding it here would let any sum()
    // triple its capacity on a three node cluster (#925).
    if (s.shared) continue

    for (const n of s.nodes) {
      const nodeLabels = { connection: s.connectionName, storage: s.storage, node: n.node }
      nodeTotalBytesSamples.push({ name: "proxcenter_storage_node_total_bytes", labels: nodeLabels, value: n.total })
      nodeUsedBytesSamples.push({ name: "proxcenter_storage_node_used_bytes", labels: nodeLabels, value: n.used })
      nodeUsageRatioSamples.push({
        name: "proxcenter_storage_node_usage_ratio",
        labels: nodeLabels,
        value: ratio(n.used, n.total),
      })
    }
  }

  return [
    family("proxcenter_storage_total_bytes", totalBytesSamples),
    family("proxcenter_storage_used_bytes", usedBytesSamples),
    family("proxcenter_storage_usage_ratio", usageRatioSamples),
    family("proxcenter_storage_enabled", enabledSamples),
    family("proxcenter_storage_node_total_bytes", nodeTotalBytesSamples),
    family("proxcenter_storage_node_used_bytes", nodeUsedBytesSamples),
    family("proxcenter_storage_node_usage_ratio", nodeUsageRatioSamples),
  ]
}
