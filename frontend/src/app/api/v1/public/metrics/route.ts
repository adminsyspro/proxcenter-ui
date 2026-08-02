import { NextResponse } from "next/server"

import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"
import { loadPublicView, loadBackupFreshnessForView } from "@/lib/api-tokens/publicRoutePrologue"
import { isFamilyAllowed, renderExposition, type MetricFamily } from "@/lib/metrics/prometheus"
import { PERMISSIONS } from "@/lib/rbac"
import type { Principal } from "@/lib/auth/principal"

export const runtime = "nodejs"

function ratio(used: number, total: number): number {
  return total > 0 ? Math.round((used / total) * 10_000) / 10_000 : 0
}

async function handler(_req: Request, ctx: { principal?: Principal }) {
  const principal = ctx?.principal
  const result = await loadPublicView(principal, PERMISSIONS.NODE_VIEW)
  if (!result.ok) return result.response
  const view = result.view

  // Session (or anonymous) callers see every family, gated only by the
  // NODE_VIEW check above: family filtering is a TOKEN scope concept, per
  // spec section 8.
  const scopes = principal?.kind === "token" ? principal.scopes ?? [] : []
  const allowed = (name: string) => principal?.kind !== "token" || isFamilyAllowed(name, scopes)

  const families: MetricFamily[] = []

  if (allowed("proxcenter_node_online")) {
    families.push(
      {
        name: "proxcenter_node_online",
        help: "Node online state (1 online, 0 otherwise)",
        type: "gauge",
        samples: view.nodes.map(node => ({
          name: "proxcenter_node_online",
          labels: { connection: node.connectionName, node: node.node },
          value: node.status === "online" ? 1 : 0,
        })),
      },
      {
        name: "proxcenter_node_cpu_usage_ratio",
        help: "Node CPU usage ratio (0 to 1)",
        type: "gauge",
        samples: view.nodes.map(node => ({
          name: "proxcenter_node_cpu_usage_ratio",
          labels: { connection: node.connectionName, node: node.node },
          value: Math.round(node.cpu * 10_000) / 10_000,
        })),
      },
      {
        name: "proxcenter_node_mem_usage_ratio",
        help: "Node memory usage ratio (0 to 1)",
        type: "gauge",
        samples: view.nodes.map(node => ({
          name: "proxcenter_node_mem_usage_ratio",
          labels: { connection: node.connectionName, node: node.node },
          value: ratio(node.mem, node.maxmem),
        })),
      },
    )
  }

  if (allowed("proxcenter_vm_status")) {
    families.push(
      {
        name: "proxcenter_vm_status",
        help: "Guest running state (1 running, 0 otherwise)",
        type: "gauge",
        samples: view.guests.map(guest => ({
          name: "proxcenter_vm_status",
          labels: {
            connection: guest.connectionName,
            node: guest.node,
            vmid: guest.vmid,
            name: guest.name,
            type: guest.type,
          },
          value: guest.status === "running" ? 1 : 0,
        })),
      },
      {
        name: "proxcenter_vm_cpu_usage_ratio",
        help: "Guest CPU usage ratio (0 to 1)",
        type: "gauge",
        samples: view.guests.map(guest => ({
          name: "proxcenter_vm_cpu_usage_ratio",
          labels: {
            connection: guest.connectionName,
            node: guest.node,
            vmid: guest.vmid,
            name: guest.name,
            type: guest.type,
          },
          value: Math.round(guest.cpu * 10_000) / 10_000,
        })),
      },
      {
        name: "proxcenter_vm_agent_enabled",
        help: "Guest agent config flag (1 enabled, 0 otherwise)",
        type: "gauge",
        // agentEnabled is tri-state: null means "we do not know", and the
        // metric's whole purpose is finding agent-less VMs, so a null is
        // OMITTED here rather than published as a misleading 0.
        samples: view.guests
          .filter(guest => guest.agentEnabled !== null)
          .map(guest => ({
            name: "proxcenter_vm_agent_enabled",
            labels: { connection: guest.connectionName, node: guest.node, vmid: guest.vmid, name: guest.name },
            value: guest.agentEnabled ? 1 : 0,
          })),
      },
    )
  }

  if (allowed("proxcenter_backup_age_seconds")) {
    // Only computed when the family is exposed: the aggregation touches the
    // PBS cache, so skipping it is a real saving, not cosmetics.
    const freshness = await loadBackupFreshnessForView(view)
    families.push({
      name: "proxcenter_backup_age_seconds",
      help: "Seconds since the most recent backup of this guest",
      type: "gauge",
      samples: freshness.guests
        .filter(guest => guest.ageSeconds !== null)
        .map(guest => ({
          name: "proxcenter_backup_age_seconds",
          labels: { connection: guest.connectionName, vmid: guest.vmid, datastore: guest.datastore },
          value: guest.ageSeconds as number,
        })),
    })
  }

  return new NextResponse(renderExposition(families), {
    status: 200,
    headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8" },
  })
}

export const GET = withPublicApiGuard("public-metrics", handler)
