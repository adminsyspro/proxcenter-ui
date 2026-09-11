import type { PublicFleetView } from "@/lib/api-tokens/publicData"
import type { FleetBackupFreshness } from "@/lib/backups/freshness"
import type { MetricFamily, Sample } from "@/lib/metrics/prometheus"

import { family } from "./registry"

/** connId + vmid identifies a guest across the two caches. */
function key(connId: string, vmid: string): string {
  return `${connId} ${vmid}`
}

export function buildBackupFamilies(
  view: PublicFleetView,
  freshness: FleetBackupFreshness,
): MetricFamily[] {
  const byGuest = new Map(freshness.guests.map(guest => [key(guest.connId, guest.vmid), guest]))

  const ageSamples: Sample[] = []
  const protectedSamples: Sample[] = []

  for (const guest of view.guests) {
    const labels = {
      connection: guest.connectionName,
      node: guest.node,
      vmid: guest.vmid,
      name: guest.name,
      type: guest.type,
    }
    const entry = byGuest.get(key(guest.connId, guest.vmid))
    protectedSamples.push({
      name: "proxcenter_backup_protected",
      labels,
      value: entry && entry.ageSeconds !== null ? 1 : 0,
    })
    if (entry && entry.ageSeconds !== null) {
      ageSamples.push({
        name: "proxcenter_backup_age_seconds",
        labels: { ...labels, datastore: entry.datastore },
        value: entry.ageSeconds,
      })
    }
  }

  return [
    family("proxcenter_backup_age_seconds", ageSamples),
    family("proxcenter_backup_protected", protectedSamples),
  ]
}
