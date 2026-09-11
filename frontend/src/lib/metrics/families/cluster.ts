// PURE module: fleet view in, families out. No I/O, ever (D12).
import type { PublicFleetView } from "@/lib/api-tokens/publicData"
import type { MetricFamily, Sample } from "@/lib/metrics/prometheus"

import { family } from "./registry"

const CEPH_STATES = ["ok", "warn", "err", "unknown"] as const

/**
 * Maps Proxmox's Ceph health string to a bounded state set. An unrecognised
 * value becomes `unknown` rather than a new label value: label values come
 * from the cluster and an unbounded set would blow up cardinality.
 */
function cephState(health: string): (typeof CEPH_STATES)[number] {
  const upper = health.toUpperCase()
  if (upper.includes("HEALTH_OK")) return "ok"
  if (upper.includes("HEALTH_WARN")) return "warn"
  if (upper.includes("HEALTH_ERR")) return "err"
  return "unknown"
}

export function buildClusterFamilies(view: PublicFleetView): MetricFamily[] {
  const upSamples: Sample[] = view.clusters.map(cluster => ({
    name: "proxcenter_cluster_up",
    labels: { connection: cluster.name, type: cluster.type },
    value: cluster.status === "online" ? 1 : 0,
  }))

  const degradedSamples: Sample[] = view.clusters.map(cluster => ({
    name: "proxcenter_cluster_degraded",
    labels: { connection: cluster.name },
    value: cluster.status === "degraded" ? 1 : 0,
  }))

  const cephSamples: Sample[] = []
  for (const cluster of view.clusters) {
    const health = (cluster as { cephHealth?: string }).cephHealth
    if (typeof health !== "string" || health === "") continue
    const active = cephState(health)
    for (const state of CEPH_STATES) {
      cephSamples.push({
        name: "proxcenter_cluster_ceph_health",
        labels: { connection: cluster.name, health: state },
        value: state === active ? 1 : 0,
      })
    }
  }

  return [
    family("proxcenter_cluster_up", upSamples),
    family("proxcenter_cluster_degraded", degradedSamples),
    family("proxcenter_cluster_ceph_health", cephSamples),
  ]
}
