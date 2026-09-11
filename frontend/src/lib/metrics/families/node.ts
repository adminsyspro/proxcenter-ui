// Node families (#925): the three pre-existing series moved out of the
// route verbatim, plus fifteen new ones from the normative family table.
import type { MetricFamily } from "@/lib/metrics/prometheus"
import { ratio } from "@/lib/metrics/prometheus"
import type { PublicFleetView } from "@/lib/api-tokens/publicData"

import { family } from "./registry"

export function buildNodeFamilies(view: PublicFleetView): MetricFamily[] {
  // `?? []` on purpose: a missing collection must yield empty families, never
  // a throw that takes the whole exposition down (#925).
  const nodes = view.nodes ?? []

  return [
    family(
      "proxcenter_node_online",
      nodes.map(node => ({
        name: "proxcenter_node_online",
        labels: { connection: node.connectionName, node: node.node },
        value: node.status === "online" ? 1 : 0,
      })),
    ),
    family(
      "proxcenter_node_cpu_usage_ratio",
      nodes.map(node => ({
        name: "proxcenter_node_cpu_usage_ratio",
        labels: { connection: node.connectionName, node: node.node },
        value: Math.round(node.cpu * 10_000) / 10_000,
      })),
    ),
    family(
      "proxcenter_node_mem_usage_ratio",
      nodes.map(node => ({
        name: "proxcenter_node_mem_usage_ratio",
        labels: { connection: node.connectionName, node: node.node },
        value: ratio(node.mem, node.maxmem),
      })),
    ),
    family(
      "proxcenter_node_mem_bytes",
      nodes.map(node => ({
        name: "proxcenter_node_mem_bytes",
        labels: { connection: node.connectionName, node: node.node },
        value: node.mem,
      })),
    ),
    family(
      "proxcenter_node_mem_total_bytes",
      nodes.map(node => ({
        name: "proxcenter_node_mem_total_bytes",
        labels: { connection: node.connectionName, node: node.node },
        value: node.maxmem,
      })),
    ),
    family(
      "proxcenter_node_rootfs_usage_ratio",
      nodes.map(node => ({
        name: "proxcenter_node_rootfs_usage_ratio",
        labels: { connection: node.connectionName, node: node.node },
        value: ratio(node.disk, node.maxdisk),
      })),
    ),
    family(
      "proxcenter_node_uptime_seconds",
      nodes.map(node => ({
        name: "proxcenter_node_uptime_seconds",
        labels: { connection: node.connectionName, node: node.node },
        value: node.uptime,
      })),
    ),
    family(
      "proxcenter_node_maintenance",
      nodes.map(node => ({
        name: "proxcenter_node_maintenance",
        labels: { connection: node.connectionName, node: node.node },
        value: node.maintenance ? 1 : 0,
      })),
    ),
    family(
      "proxcenter_node_load1",
      nodes.map(node => ({
        name: "proxcenter_node_load1",
        labels: { connection: node.connectionName, node: node.node },
        value: node.load1,
      })),
    ),
    family(
      "proxcenter_node_load5",
      nodes.map(node => ({
        name: "proxcenter_node_load5",
        labels: { connection: node.connectionName, node: node.node },
        value: node.load5,
      })),
    ),
    family(
      "proxcenter_node_load15",
      nodes.map(node => ({
        name: "proxcenter_node_load15",
        labels: { connection: node.connectionName, node: node.node },
        value: node.load15,
      })),
    ),
    family(
      "proxcenter_node_iowait_ratio",
      nodes.map(node => ({
        name: "proxcenter_node_iowait_ratio",
        labels: { connection: node.connectionName, node: node.node },
        value: Math.round(node.iowait * 10_000) / 10_000,
      })),
    ),
    family(
      "proxcenter_node_swap_bytes",
      nodes.map(node => ({
        name: "proxcenter_node_swap_bytes",
        labels: { connection: node.connectionName, node: node.node },
        value: node.swapUsed,
      })),
    ),
    family(
      "proxcenter_node_swap_total_bytes",
      nodes.map(node => ({
        name: "proxcenter_node_swap_total_bytes",
        labels: { connection: node.connectionName, node: node.node },
        value: node.swapTotal,
      })),
    ),
    family(
      "proxcenter_node_rootfs_bytes",
      nodes.map(node => ({
        name: "proxcenter_node_rootfs_bytes",
        labels: { connection: node.connectionName, node: node.node },
        value: node.rootfsUsed,
      })),
    ),
    family(
      "proxcenter_node_rootfs_total_bytes",
      nodes.map(node => ({
        name: "proxcenter_node_rootfs_total_bytes",
        labels: { connection: node.connectionName, node: node.node },
        value: node.rootfsTotal,
      })),
    ),
    family(
      "proxcenter_node_cpu_cores",
      nodes.map(node => ({
        name: "proxcenter_node_cpu_cores",
        labels: { connection: node.connectionName, node: node.node },
        value: node.cores,
      })),
    ),
    family(
      "proxcenter_node_info",
      // Omit the sample entirely when neither field is known: renderLabels
      // (prometheus.ts) drops null labels, so keeping the sample would
      // render a bare connection/node line indistinguishable from every
      // OTHER node with no version or kernel reported, colliding on the
      // same series.
      nodes
        .filter(node => node.pveVersion !== null || node.kernel !== null)
        .map(node => ({
          name: "proxcenter_node_info",
          labels: {
            connection: node.connectionName,
            node: node.node,
            pve_version: node.pveVersion,
            kernel: node.kernel,
          },
          value: 1,
        })),
    ),
  ]
}
