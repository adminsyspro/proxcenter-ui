// Guest (`proxcenter_vm_*`) families. The three pre-existing series
// (status, cpu_usage_ratio, agent_enabled) move here VERBATIM from
// route.ts: same label sets, same value expressions. Five new series join
// them: memory as a ratio and in bytes, uptime, and HA state as a bounded
// state set (#925).
import { ratio, type MetricFamily, type Sample } from "@/lib/metrics/prometheus"
import type { PublicFleetView } from "@/lib/api-tokens/publicData"

import { family } from "./registry"

const HA_STATES = ["started", "stopped", "disabled", "ignored", "error", "other"] as const

function haState(raw: string): (typeof HA_STATES)[number] {
  const lower = raw.toLowerCase()
  return (HA_STATES as readonly string[]).includes(lower) && lower !== "other"
    ? (lower as (typeof HA_STATES)[number])
    : "other"
}

export function buildGuestFamilies(view: PublicFleetView): MetricFamily[] {
  // `?? []` on purpose: a missing collection must yield empty families, never
  // a throw that takes the whole exposition down (#925).
  const guests = view.guests ?? []

  const statusSamples: Sample[] = []
  const cpuSamples: Sample[] = []
  const agentSamples: Sample[] = []
  const memRatioSamples: Sample[] = []
  const memBytesSamples: Sample[] = []
  const memTotalBytesSamples: Sample[] = []
  const uptimeSamples: Sample[] = []
  const haStateSamples: Sample[] = []
  const cpuCoresSamples: Sample[] = []
  const memHostBytesSamples: Sample[] = []
  const netInSamples: Sample[] = []
  const netOutSamples: Sample[] = []
  const diskReadSamples: Sample[] = []
  const diskWrittenSamples: Sample[] = []

  for (const guest of guests) {
    const labels = {
      connection: guest.connectionName,
      node: guest.node,
      vmid: guest.vmid,
      name: guest.name,
      type: guest.type,
    }

    statusSamples.push({
      name: "proxcenter_vm_status",
      labels,
      value: guest.status === "running" ? 1 : 0,
    })

    cpuSamples.push({
      name: "proxcenter_vm_cpu_usage_ratio",
      labels,
      value: Math.round(guest.cpu * 10_000) / 10_000,
    })

    // agentEnabled is tri-state: null means "we do not know", and the
    // metric's whole purpose is finding agent-less VMs, so a null is
    // OMITTED here rather than published as a misleading 0. No `type`
    // label, matching the series as it shipped on 3 August.
    if (guest.agentEnabled !== null) {
      agentSamples.push({
        name: "proxcenter_vm_agent_enabled",
        labels: { connection: guest.connectionName, node: guest.node, vmid: guest.vmid, name: guest.name },
        value: guest.agentEnabled ? 1 : 0,
      })
    }

    memRatioSamples.push({
      name: "proxcenter_vm_mem_usage_ratio",
      labels,
      value: ratio(guest.mem, guest.maxmem),
    })

    memBytesSamples.push({
      name: "proxcenter_vm_mem_bytes",
      labels,
      value: guest.mem,
    })

    memTotalBytesSamples.push({
      name: "proxcenter_vm_mem_total_bytes",
      labels,
      value: guest.maxmem,
    })

    uptimeSamples.push({
      name: "proxcenter_vm_uptime_seconds",
      labels,
      value: guest.uptime,
    })

    // A state set: every guest HA actually manages gets one sample per
    // bounded state, with a 1 on the current state only, so a dashboard
    // can chart `proxcenter_vm_ha_state{state="error"}` directly instead
    // of decoding a free-form string. Guests HA does not manage (hastate
    // null) contribute no sample at all.
    // typeof, not `!== null`: a view built before this field existed carries
    // `undefined`, and an exposition handler that throws takes the WHOLE scrape
    // down, blinding every panel over one missing optional field.
    if (typeof guest.hastate === "string" && guest.hastate !== "") {
      const current = haState(guest.hastate)
      for (const state of HA_STATES) {
        haStateSamples.push({
          name: "proxcenter_vm_ha_state",
          labels: { ...labels, state },
          value: state === current ? 1 : 0,
        })
      }
    }

    cpuCoresSamples.push({
      name: "proxcenter_vm_cpu_cores",
      labels,
      value: guest.cores,
    })

    // 0 for a container on purpose (PVE 9 reports none): the raw value is
    // pushed unconditionally, never guarded by a truthy check, or every LXC
    // would silently vanish from this series (#925).
    memHostBytesSamples.push({
      name: "proxcenter_vm_mem_host_bytes",
      labels,
      value: guest.memHost,
    })

    // Cumulative COUNTERS since guest start (#925): the raw value goes out
    // as-is, never a delta or a rate. Prometheus computes rates itself and
    // needs the raw counter to detect a reset when a guest restarts.
    netInSamples.push({
      name: "proxcenter_vm_network_receive_bytes_total",
      labels,
      value: guest.netIn,
    })

    netOutSamples.push({
      name: "proxcenter_vm_network_transmit_bytes_total",
      labels,
      value: guest.netOut,
    })

    diskReadSamples.push({
      name: "proxcenter_vm_disk_read_bytes_total",
      labels,
      value: guest.diskRead,
    })

    diskWrittenSamples.push({
      name: "proxcenter_vm_disk_written_bytes_total",
      labels,
      value: guest.diskWritten,
    })
  }

  return [
    family("proxcenter_vm_status", statusSamples),
    family("proxcenter_vm_cpu_usage_ratio", cpuSamples),
    family("proxcenter_vm_agent_enabled", agentSamples),
    family("proxcenter_vm_mem_usage_ratio", memRatioSamples),
    family("proxcenter_vm_mem_bytes", memBytesSamples),
    family("proxcenter_vm_mem_total_bytes", memTotalBytesSamples),
    family("proxcenter_vm_uptime_seconds", uptimeSamples),
    family("proxcenter_vm_ha_state", haStateSamples),
    family("proxcenter_vm_cpu_cores", cpuCoresSamples),
    family("proxcenter_vm_mem_host_bytes", memHostBytesSamples),
    family("proxcenter_vm_network_receive_bytes_total", netInSamples),
    family("proxcenter_vm_network_transmit_bytes_total", netOutSamples),
    family("proxcenter_vm_disk_read_bytes_total", diskReadSamples),
    family("proxcenter_vm_disk_written_bytes_total", diskWrittenSamples),
  ]
}
