// Node families (#925): the three pre-existing series moved out of the
// route verbatim, plus five new ones from the normative family table.
import type { MetricFamily } from "@/lib/metrics/prometheus"
import { ratio } from "@/lib/metrics/prometheus"
import type { PublicFleetView } from "@/lib/api-tokens/publicData"

import { family } from "./registry"

export function buildNodeFamilies(view: PublicFleetView): MetricFamily[] {
  return [
    family(
      "proxcenter_node_online",
      view.nodes.map(node => ({
        name: "proxcenter_node_online",
        labels: { connection: node.connectionName, node: node.node },
        value: node.status === "online" ? 1 : 0,
      })),
    ),
    family(
      "proxcenter_node_cpu_usage_ratio",
      view.nodes.map(node => ({
        name: "proxcenter_node_cpu_usage_ratio",
        labels: { connection: node.connectionName, node: node.node },
        value: Math.round(node.cpu * 10_000) / 10_000,
      })),
    ),
    family(
      "proxcenter_node_mem_usage_ratio",
      view.nodes.map(node => ({
        name: "proxcenter_node_mem_usage_ratio",
        labels: { connection: node.connectionName, node: node.node },
        value: ratio(node.mem, node.maxmem),
      })),
    ),
    family(
      "proxcenter_node_mem_bytes",
      view.nodes.map(node => ({
        name: "proxcenter_node_mem_bytes",
        labels: { connection: node.connectionName, node: node.node },
        value: node.mem,
      })),
    ),
    family(
      "proxcenter_node_mem_total_bytes",
      view.nodes.map(node => ({
        name: "proxcenter_node_mem_total_bytes",
        labels: { connection: node.connectionName, node: node.node },
        value: node.maxmem,
      })),
    ),
    family(
      "proxcenter_node_rootfs_usage_ratio",
      view.nodes.map(node => ({
        name: "proxcenter_node_rootfs_usage_ratio",
        labels: { connection: node.connectionName, node: node.node },
        value: ratio(node.disk, node.maxdisk),
      })),
    ),
    family(
      "proxcenter_node_uptime_seconds",
      view.nodes.map(node => ({
        name: "proxcenter_node_uptime_seconds",
        labels: { connection: node.connectionName, node: node.node },
        value: node.uptime,
      })),
    ),
    family(
      "proxcenter_node_maintenance",
      view.nodes.map(node => ({
        name: "proxcenter_node_maintenance",
        labels: { connection: node.connectionName, node: node.node },
        value: node.maintenance ? 1 : 0,
      })),
    ),
  ]
}
