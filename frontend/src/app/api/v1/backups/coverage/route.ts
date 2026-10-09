import { NextResponse } from "next/server"

import { getSessionPrisma, getCurrentTenantId } from "@/lib/tenant"
import { prisma as globalPrisma } from "@/lib/db/prisma"
import { getSetting } from "@/lib/db/settings"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, filterVmsByPermission, getRBACContext, PERMISSIONS } from "@/lib/rbac"
import { getTenantInfrastructureScope, inventoryConnectionPlan, maskingScope } from "@/lib/tenant/infraScope"
import { mapWithConcurrency, PVEPROXY_CONCURRENCY } from "@/lib/inventory/concurrency"
import {
  coverageSettingsFromThresholds,
  creationTimesFromTasks,
  guestKey,
  parseMetaCtime,
  resolveBackupCoverage,
  type CoverageGuest,
  type UncoveredGuest,
  type VzdumpJob,
} from "@/lib/backups/coverage"

export const runtime = "nodejs"

type ConnectionError = { connId: string; connectionName: string; error: string }

type ConnectionData = {
  connId: string
  connectionName: string
  conn: Awaited<ReturnType<typeof getConnectionById>>
  guests: CoverageGuest[]
  jobs: VzdumpJob[]
}

function tagsOf(raw: unknown): string[] {
  return typeof raw === "string" ? raw.split(/[;,]/).map(t => t.trim()).filter(Boolean) : []
}

/**
 * Creation times of the uncovered guests of one connection, for the grace
 * period. QEMU: the `meta: ctime=` stamp of the config. LXC, or a VM created
 * before PVE 7: the latest create or restore task in /cluster/tasks. A guest
 * found in neither has no creation time and is never treated as recent.
 */
async function loadCreationTimes(data: ConnectionData, candidates: UncoveredGuest[], out: Map<string, number>) {
  const missing: UncoveredGuest[] = []

  await mapWithConcurrency(candidates, PVEPROXY_CONCURRENCY, async guest => {
    if (guest.type !== "qemu") {
      missing.push(guest)
      return
    }
    try {
      const config = await pveFetch<any>(
        data.conn,
        `/nodes/${encodeURIComponent(guest.node)}/qemu/${encodeURIComponent(guest.vmid)}/config`,
      )
      const ctime = parseMetaCtime(config)
      if (ctime === null) missing.push(guest)
      else out.set(guestKey(guest), ctime)
    } catch {
      missing.push(guest)
    }
  })

  if (missing.length === 0) return
  try {
    const fromTasks = creationTimesFromTasks(await pveFetch<any[]>(data.conn, "/cluster/tasks"))
    for (const guest of missing) {
      const ctime = fromTasks.get(String(guest.vmid))
      if (ctime) out.set(guestKey(guest), ctime)
    }
  } catch {
    /* no task list, no grace for these guests */
  }
}

/**
 * GET /api/v1/backups/coverage
 *
 * Guests covered by no PVE backup job (roadmap#48), across every PVE
 * connection the caller can see: one row per uncovered guest with the reason
 * (excluded from an `all` job, job pinned to another node, only a disabled
 * job selects it, no job selects it, no enabled job at all). Templates, guests
 * tagged with the opt-out tag and guests younger than the grace period are
 * counted but not listed. Settings live in the alert thresholds so the
 * orchestrator can share them once it raises the alert itself.
 *
 * A connection whose /cluster/backup cannot be read is reported in `errors`
 * and contributes no row: without its jobs every guest would look uncovered.
 */
export async function GET(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.VM_VIEW)
    if (denied) return denied

    const url = new URL(req.url)
    const connIdFilter = url.searchParams.get("connId")

    const tenantId = await getCurrentTenantId()
    const infra = await getTenantInfrastructureScope(tenantId)
    const plan = inventoryConnectionPlan(infra)
    const connPrisma = plan.pveClient === "global" ? globalPrisma : await getSessionPrisma()

    let connections = await connPrisma.connection.findMany({
      where: { type: "pve" },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, tenantId: true },
    })
    if (plan.pveConnectionIds) {
      const allowed = new Set(plan.pveConnectionIds)
      connections = connections.filter(c => allowed.has(c.id))
    }
    if (connIdFilter && connIdFilter !== "*") {
      connections = connections.filter(c => c.id === connIdFilter)
    }

    const settings = coverageSettingsFromThresholds(await getSetting("alert_thresholds", tenantId))
    const errors: ConnectionError[] = []

    const loaded = await Promise.all(
      connections.map(async (c): Promise<ConnectionData | null> => {
        try {
          const conn = await getConnectionById(c.id, c.tenantId)
          if (!conn.baseUrl || !conn.apiToken) return null
          const [resources, jobs, nodes] = await Promise.all([
            pveFetch<any[]>(conn, "/cluster/resources?type=vm"),
            pveFetch<any[]>(conn, "/cluster/backup"),
            // Only paints the node glyph: an unreadable /nodes is no reason to drop the connection.
            pveFetch<any[]>(conn, "/nodes").catch(() => []),
          ])
          const nodeStatus = new Map<string, string>(
            (nodes || []).filter((n: any) => n?.node).map((n: any) => [String(n.node), String(n.status || "unknown")]),
          )
          const guests: CoverageGuest[] = (resources || [])
            .filter((r: any) => r && r.vmid !== undefined && (r.type === "qemu" || r.type === "lxc"))
            .map((r: any) => ({
              connId: c.id,
              connectionName: c.name,
              node: String(r.node || ""),
              nodeStatus: nodeStatus.get(String(r.node || "")),
              vmid: String(r.vmid),
              type: r.type,
              name: r.name || `${r.type}/${r.vmid}`,
              status: r.status || "unknown",
              template: r.template === 1 || r.template === true,
              tags: tagsOf(r.tags),
              pool: r.pool || null,
            }))
          return { connId: c.id, connectionName: c.name, conn, guests, jobs: jobs || [] }
        } catch (e: any) {
          errors.push({ connId: c.id, connectionName: c.name, error: e?.message || String(e) })
          return null
        }
      }),
    )
    const datas = loaded.filter((d): d is ConnectionData => d !== null)

    // Visibility first, so neither the list nor the creation-time lookups
    // ever touch a guest this caller cannot see.
    let guests = datas.flatMap(d => d.guests)
    const rbacCtx = await getRBACContext()
    if (rbacCtx && !rbacCtx.isAdmin) {
      guests = await filterVmsByPermission(
        rbacCtx.principal ?? (rbacCtx.userId as string),
        guests,
        PERMISSIONS.VM_VIEW,
        rbacCtx.tenantId,
      )
    }
    const vdcScope = maskingScope(infra)
    if (vdcScope) {
      guests = guests.filter(g => {
        const pools = vdcScope.poolsByConnection.get(g.connId)
        return !!pools && g.pool != null && pools.has(g.pool)
      })
    }

    const jobsByConnection: Record<string, VzdumpJob[]> = {}
    for (const d of datas) jobsByConnection[d.connId] = d.jobs

    // First pass without grace: its uncovered list is exactly the set of
    // guests whose creation time matters.
    const now = Date.now()
    const createdAt = new Map<string, number>()
    if (settings.graceHours > 0) {
      const { uncovered: candidates } = resolveBackupCoverage({
        guests,
        jobsByConnection,
        settings: { ...settings, graceHours: 0 },
        now,
      })
      await Promise.all(
        datas.map(d => {
          const mine = candidates.filter(g => g.connId === d.connId)
          return mine.length ? loadCreationTimes(d, mine, createdAt) : Promise.resolve()
        }),
      )
    }

    const { uncovered, summary } = resolveBackupCoverage({ guests, jobsByConnection, settings, now, createdAt })

    // Job ids are provider configuration: a vDC tenant gets the reason only.
    const rows = vdcScope ? uncovered.map(g => ({ ...g, jobIds: [] })) : uncovered
    rows.sort(
      (a, b) =>
        (a.connectionName || "").localeCompare(b.connectionName || "") ||
        (Number.parseInt(a.vmid, 10) || 0) - (Number.parseInt(b.vmid, 10) || 0),
    )

    return NextResponse.json({
      data: { guests: rows, summary, settings, errors, generatedAt: new Date(now).toISOString() },
    })
  } catch (e: any) {
    console.error("[backups/coverage] GET error:", e)
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 })
  }
}
