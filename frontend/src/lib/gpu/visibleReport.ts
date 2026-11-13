// The GPU report a caller may see (#672): every connection of its scope,
// narrowed to the nodes and VMs its RBAC grants show. Shared by the inventory
// route and the GPU load routes, so both answer for the same perimeter.
import { getSessionPrisma, getCurrentTenantId } from "@/lib/tenant"
import { prisma as globalPrisma } from "@/lib/db/prisma"
import { getConnectionById } from "@/lib/connections/getConnection"
import { filterNodesByPermission, filterVmsByPermission, getRBACContext, PERMISSIONS } from "@/lib/rbac"
import { getTenantInfrastructureScope, inventoryConnectionPlan, maskingScope } from "@/lib/tenant/infraScope"

import { getConnectionGpus, type ConnectionGpuSnapshot } from "./collect"
import { buildGpuReport, nodeVisibilityKey, vmVisibilityKey, type GpuReport } from "./report"

export type VisibleReportOptions = { connId?: string | null; node?: string | null; refresh?: boolean }

export async function loadVisibleGpuReport(opts: VisibleReportOptions = {}): Promise<GpuReport> {
  const tenantId = await getCurrentTenantId()
  const infra = await getTenantInfrastructureScope(tenantId)
  const plan = inventoryConnectionPlan(infra)
  const prisma = plan.pveClient === "global" ? globalPrisma : await getSessionPrisma()

  let connections = await prisma.connection.findMany({
    where: { type: "pve" },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, tenantId: true },
  })
  if (plan.pveConnectionIds) {
    const allowed = new Set(plan.pveConnectionIds)
    connections = connections.filter((c) => allowed.has(c.id))
  }
  if (opts.connId) connections = connections.filter((c) => c.id === opts.connId)

  const snapshots: ConnectionGpuSnapshot[] = await Promise.all(
    connections.map(async (conn) => {
      try {
        const connData = await getConnectionById(conn.id, (conn as any).tenantId)
        return await getConnectionGpus(connData, { id: conn.id, name: conn.name }, { refresh: !!opts.refresh })
      } catch (e: any) {
        return {
          connId: conn.id,
          connectionName: conn.name,
          error: e?.message || String(e),
          mappingsError: null,
          guestsError: null,
          nodes: [],
          devices: [],
          allocations: [],
          configReads: 0,
          generatedAt: new Date().toISOString(),
        }
      }
    }),
  )

  const vdcScope = maskingScope(infra)
  let visibleNodes: Set<string> | null = null
  let visibleVms: Set<string> | null = null

  const rbacCtx = await getRBACContext()
  if (rbacCtx && !rbacCtx.isAdmin) {
    const principal = rbacCtx.principal ?? (rbacCtx.userId as string)
    const nodeRows = snapshots.flatMap((s) => s.nodes.map((n) => ({ connId: s.connId, node: n.node })))
    const vmRows = snapshots.flatMap((s) =>
      s.allocations.map((a) => ({ connId: a.connId, node: a.node, type: "qemu", vmid: a.vmid, tags: a.tags, pool: a.pool })),
    )
    const [nodesOk, vmsOk] = await Promise.all([
      vdcScope ? Promise.resolve([]) : filterNodesByPermission(principal, nodeRows, PERMISSIONS.NODE_VIEW, rbacCtx.tenantId),
      filterVmsByPermission(principal, vmRows, PERMISSIONS.VM_VIEW, rbacCtx.tenantId),
    ])
    visibleNodes = new Set(nodesOk.map((n) => nodeVisibilityKey(n.connId, n.node)))
    visibleVms = new Set(vmsOk.map((v) => vmVisibilityKey(v.connId, v.node, v.vmid)))
  }

  return buildGpuReport(snapshots, {
    tenantPools: vdcScope ? vdcScope.poolsByConnection : null,
    visibleNodes,
    visibleVms,
    node: opts.node ?? null,
  })
}
