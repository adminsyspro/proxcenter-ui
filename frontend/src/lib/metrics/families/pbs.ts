// PURE module: fleet view in, families out. No I/O, ever (D12).
import type { PublicFleetView } from "@/lib/api-tokens/publicData"
import type { MetricFamily, Sample } from "@/lib/metrics/prometheus"

import { family } from "./registry"

const GUEST_KINDS = ["vm", "ct", "host"] as const

export function buildPbsFamilies(view: PublicFleetView): MetricFamily[] {
  // `?? []` on purpose: a missing collection must yield empty families, never
  // a throw that takes the whole exposition down (#925).
  const servers = view.pbsServers ?? []

  const upSamples: Sample[] = servers.map(server => ({
    name: "proxcenter_pbs_up",
    labels: { connection: server.connectionName },
    value: server.status === "online" ? 1 : 0,
  }))

  const infoSamples: Sample[] = []
  for (const server of servers) {
    // typeof, not `=== null`: an absent key is `undefined`, and renderLabels
    // drops empty label values, so a version-less server would otherwise
    // collapse onto one unlabelled series shared with every other.
    if (typeof server.version !== "string" || server.version === "") continue
    infoSamples.push({
      name: "proxcenter_pbs_info",
      labels: { connection: server.connectionName, version: server.version },
      value: 1,
    })
  }

  const totalBytesSamples: Sample[] = []
  const usedBytesSamples: Sample[] = []
  const availableBytesSamples: Sample[] = []
  const usageRatioSamples: Sample[] = []
  const snapshotsSamples: Sample[] = []
  const guestsSamples: Sample[] = []

  for (const server of servers) {
    for (const datastore of server.datastores) {
      const labels = { connection: server.connectionName, datastore: datastore.name }

      totalBytesSamples.push({
        name: "proxcenter_pbs_datastore_total_bytes",
        labels,
        value: datastore.total,
      })
      usedBytesSamples.push({
        name: "proxcenter_pbs_datastore_used_bytes",
        labels,
        value: datastore.used,
      })
      availableBytesSamples.push({
        name: "proxcenter_pbs_datastore_available_bytes",
        labels,
        value: datastore.available,
      })
      usageRatioSamples.push({
        name: "proxcenter_pbs_datastore_usage_ratio",
        labels,
        value: Math.round((datastore.usagePercent / 100) * 10_000) / 10_000,
      })
      snapshotsSamples.push({
        name: "proxcenter_pbs_datastore_snapshots",
        labels,
        value: datastore.backupCount,
      })

      const guestCountByKind: Record<(typeof GUEST_KINDS)[number], number> = {
        vm: datastore.vmCount,
        ct: datastore.ctCount,
        host: datastore.hostCount,
      }
      for (const kind of GUEST_KINDS) {
        guestsSamples.push({
          name: "proxcenter_pbs_datastore_guests",
          labels: { ...labels, kind },
          value: guestCountByKind[kind],
        })
      }
    }
  }

  return [
    family("proxcenter_pbs_up", upSamples),
    family("proxcenter_pbs_info", infoSamples),
    family("proxcenter_pbs_datastore_total_bytes", totalBytesSamples),
    family("proxcenter_pbs_datastore_used_bytes", usedBytesSamples),
    family("proxcenter_pbs_datastore_available_bytes", availableBytesSamples),
    family("proxcenter_pbs_datastore_usage_ratio", usageRatioSamples),
    family("proxcenter_pbs_datastore_snapshots", snapshotsSamples),
    family("proxcenter_pbs_datastore_guests", guestsSamples),
  ]
}
