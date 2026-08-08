import { NextResponse } from "next/server"

import { prisma as globalPrisma } from "@/lib/db/prisma"
import { getCurrentTenantId, getTenantConnectionIds } from "@/lib/tenant"
import { getTenantInfrastructureScope, maskingScope } from "@/lib/tenant/infraScope"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { orchestratorHeaders } from "@/lib/orchestrator/headers"

export const runtime = "nodejs"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:8080"

/** Extract hostname from a baseUrl like "https://pve1.example.com:8006" */
function extractHostname(baseUrl: string): string {
  try {
    const u = new URL(baseUrl)
    return u.hostname
  } catch {
    return baseUrl
  }
}

// GET /api/v1/orchestrator/jobs - List all jobs (rolling updates, future: DRS, migrations, etc.)
export async function GET(req: Request) {
  try {
    // Gates the "Task Center" page (menuData permissions: ['tasks.view']).
    const denied = await checkPermission(PERMISSIONS.TASKS_VIEW)
    if (denied) return denied

    const { searchParams } = new URL(req.url)
    const type = searchParams.get("type") // filter by type: rolling_update, drs, migration, etc.
    const status = searchParams.get("status") // filter by status: running, completed, failed, etc.
    const limit = searchParams.get("limit") || "50"

    // The orchestrator (rolling-updates, drs/migrations, replication/jobs,
    // replication/plans) is NOT tenant-aware: it returns fleet-wide rows with
    // a raw connection_id / source_cluster / target_cluster field, so all
    // scoping happens here.
    //
    // Connection perimeter for the LIST: provider sees the whole fleet
    // (unchanged); msp/iaas ownership uses the tenant union
    // (getTenantConnectionIds); iaas additionally narrows to the active vDC
    // view context (Task 12 class rule — same pattern as /api/v1/changes and
    // /api/v1/tasks/running). getSessionPrisma() was wrong here: it only
    // returns connections owned DIRECTLY by the tenant, which is empty for
    // iaas tenants (provider-pool connections via vDC binding) and
    // under-inclusive for the provider (excludes MSP-owned connections).
    const tenantId = await getCurrentTenantId()
    const infra = await getTenantInfrastructureScope(tenantId)
    const vdcScope = maskingScope(infra)
    const tenantConnectionIds = await getTenantConnectionIds()
    const perimeterConnectionIds = vdcScope ? vdcScope.connectionIds : tenantConnectionIds

    // Build connection lookup maps: id → hostname, name → hostname. Uses the
    // global client (not tenant-scoped) restricted to the perimeter above,
    // since vDC-bound connections are provider-owned rows.
    const connections = perimeterConnectionIds.size > 0
      ? await globalPrisma.connection.findMany({
          where: { id: { in: Array.from(perimeterConnectionIds) } },
          select: { id: true, name: true, baseUrl: true },
        })
      : []
    const connById = new Map<string, string>()
    const connByName = new Map<string, string>()

    for (const c of connections) {
      const host = extractHostname(c.baseUrl)
      connById.set(c.id, host)
      connByName.set(c.name, host)
    }

    /** Resolve a connection identifier (id or name) to its server hostname */
    const resolve = (idOrName: string): string =>
      connById.get(idOrName) || connByName.get(idOrName) || idOrName

    const jobs: any[] = []

    // Fetch rolling updates
    try {
      const rollingRes = await fetch(`${ORCHESTRATOR_URL}/api/v1/rolling-updates`, {
        headers: orchestratorHeaders({ "Content-Type": "application/json" }),
      })

      if (rollingRes.ok) {
        const rollingData = await rollingRes.json()
        
        // Handle null, undefined, or different response formats
        let rollingUpdates: any[] = []
        if (Array.isArray(rollingData)) {
          rollingUpdates = rollingData
        } else if (rollingData && Array.isArray(rollingData.data)) {
          rollingUpdates = rollingData.data
        } else if (rollingData && typeof rollingData === 'object') {
          // Maybe it's a single object or has updates in another field
          rollingUpdates = []
        }

        // Transform rolling updates to job format
        for (const ru of rollingUpdates) {
          // Map rolling update status to job status
          let jobStatus = ru.status
          if (ru.status === "completed") jobStatus = "success"
          if (ru.status === "cancelled") jobStatus = "failed"

          // Calculate progress
          const progress = ru.total_nodes > 0 
            ? Math.round((ru.completed_nodes / ru.total_nodes) * 100) 
            : 0

          const ruTarget = resolve(ru.connection_id)

          jobs.push({
            id: ru.id,
            name: `Rolling Update - ${ruTarget}`,
            type: "rolling_update",
            status: jobStatus,
            progress,
            startedAt: ru.started_at,
            endedAt: ru.completed_at,
            createdAt: ru.created_at,
            detail: ru.current_node
              ? `En cours: ${ru.current_node} (${ru.completed_nodes}/${ru.total_nodes} nœuds)`
              : `${ru.completed_nodes}/${ru.total_nodes} nœuds`,
            target: ruTarget,
            // Additional data for drill-down
            metadata: {
              connectionId: ru.connection_id,
              totalNodes: ru.total_nodes,
              completedNodes: ru.completed_nodes,
              currentNode: ru.current_node,
              nodeStatuses: ru.node_statuses,
              error: ru.error,
            }
          })
        }
      }
    } catch (e) {
      if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
        console.error("Failed to fetch rolling updates:", e)
      }
    }

    // Fetch DRS migrations
    try {
      const drsRes = await fetch(`${ORCHESTRATOR_URL}/api/v1/drs/migrations?limit=50`, {
        headers: orchestratorHeaders({ "Content-Type": "application/json" }),
      })

      if (drsRes.ok) {
        const drsData = await drsRes.json()
        const migrations: any[] = Array.isArray(drsData) ? drsData : (drsData?.data || [])

        for (let i = 0; i < migrations.length; i++) {
          const m = migrations[i]
          let jobStatus = m.status
          if (m.status === "completed") jobStatus = "success"

          const drsTarget = resolve(m.connection_id)
          const vmLabel = m.vm_name || (m.vmid ? `VM ${m.vmid}` : `Migration #${i + 1}`)

          jobs.push({
            id: m.id || `drs-${m.connection_id || 'unknown'}-${m.vmid || i}-${m.started_at || i}`,
            name: `DRS Migration - ${vmLabel}`,
            type: "drs",
            status: jobStatus,
            progress: jobStatus === "success" ? 100 : jobStatus === "running" ? 50 : 0,
            startedAt: m.started_at,
            endedAt: m.completed_at,
            createdAt: m.started_at,
            detail: `${vmLabel}: ${m.source_node || '?'} → ${m.target_node || '?'}`,
            target: drsTarget,
            metadata: {
              connectionId: m.connection_id,
              vmid: m.vmid,
              vmName: m.vm_name,
              sourceNode: m.source_node,
              targetNode: m.target_node,
              taskId: m.task_id,
              error: m.error,
            },
          })
        }
      }
    } catch (e) {
      if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
        console.error("Failed to fetch DRS migrations:", e)
      }
    }

    // Fetch Site Recovery replication jobs
    try {
      const replRes = await fetch(`${ORCHESTRATOR_URL}/api/v1/replication/jobs`, {
        headers: orchestratorHeaders({ "Content-Type": "application/json" }),
      })

      if (replRes.ok) {
        const replData = await replRes.json()
        const replJobs: any[] = Array.isArray(replData) ? replData : (replData?.data || [])

        for (const rj of replJobs) {
          // Map replication status → unified job status
          let jobStatus = rj.status
          if (rj.status === "synced") jobStatus = "success"
          else if (rj.status === "syncing") jobStatus = "running"
          else if (rj.status === "error") jobStatus = "failed"
          // paused and pending stay as-is

          const vmLabel = (rj.vm_names || []).length > 0
            ? rj.vm_names.slice(0, 3).join(", ") + (rj.vm_names.length > 3 ? ` +${rj.vm_names.length - 3}` : "")
            : `${(rj.vm_ids || []).length} VM(s)`

          const replSource = resolve(rj.source_cluster)
          const replTarget = resolve(rj.target_cluster)

          jobs.push({
            id: rj.id,
            name: `Replication - ${vmLabel}`,
            type: "replication",
            status: jobStatus,
            progress: rj.progress_percent ?? (jobStatus === "success" ? 100 : 0),
            startedAt: rj.last_sync || rj.created_at,
            endedAt: rj.status === "synced" ? rj.last_sync : undefined,
            createdAt: rj.created_at,
            detail: `${replSource} → ${replTarget}${rj.schedule ? ` (${rj.schedule})` : ""}`,
            target: replSource,
            metadata: {
              sourceCluster: rj.source_cluster,
              targetCluster: rj.target_cluster,
              vmIds: rj.vm_ids,
              vmNames: rj.vm_names,
              schedule: rj.schedule,
              rpoTarget: rj.rpo_target,
              lastSync: rj.last_sync,
              nextSync: rj.next_sync,
              error: rj.error_message,
            },
          })
        }
      }
    } catch (e) {
      if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
        console.error("Failed to fetch replication jobs:", e)
      }
    }

    // Fetch Site Recovery plan executions (failover/failback/test)
    try {
      const plansRes = await fetch(`${ORCHESTRATOR_URL}/api/v1/replication/plans`, {
        headers: orchestratorHeaders({ "Content-Type": "application/json" }),
      })

      if (plansRes.ok) {
        const plansData = await plansRes.json()
        const plans: any[] = Array.isArray(plansData) ? plansData : (plansData?.data || [])

        // Fetch history for plans that have been executed
        for (const plan of plans) {
          if (!plan.last_failover && !plan.last_test) continue
          try {
            const histRes = await fetch(`${ORCHESTRATOR_URL}/api/v1/replication/plans/${plan.id}/history`, {
              headers: orchestratorHeaders({ "Content-Type": "application/json" }),
            })
            if (!histRes.ok) continue
            const histData = await histRes.json()
            const executions: any[] = Array.isArray(histData) ? histData : (histData?.data || [])

            for (const exec of executions) {
              let jobStatus = exec.status
              if (exec.status === "completed") jobStatus = "success"
              else if (exec.status === "cancelled") jobStatus = "failed"

              const typeLabel = exec.type === "failover" ? "Failover" : exec.type === "failback" ? "Failback" : "Test Failover"

              const planSource = resolve(plan.source_cluster)
              const planTarget = resolve(plan.target_cluster)

              jobs.push({
                id: exec.id,
                name: `${typeLabel} - ${plan.name}`,
                type: "maintenance",
                status: jobStatus,
                progress: jobStatus === "success" ? 100 : jobStatus === "running" ? 50 : 0,
                startedAt: exec.started_at,
                endedAt: exec.completed_at,
                createdAt: exec.started_at,
                detail: `${planSource} → ${planTarget} (${(exec.vm_results || []).length} VMs)`,
                target: planSource,
                metadata: {
                  planId: plan.id,
                  planName: plan.name,
                  executionType: exec.type,
                  sourceCluster: plan.source_cluster,
                  targetCluster: plan.target_cluster,
                  vmResults: exec.vm_results,
                },
              })
            }
          } catch {
            // Skip plan if history fetch fails
          }
        }
      }
    } catch (e) {
      if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
        console.error("Failed to fetch recovery executions:", e)
      }
    }

    // Filter all jobs by tenant connections. Provider keeps the unfiltered
    // fleet view; every non-provider caller is deny-by-default: a job whose
    // metadata carries NONE of connectionId/sourceCluster/targetCluster is
    // EXCLUDED (never "no key = pass"), and a job carrying one of those keys
    // is kept only if it resolves (by id or by name) inside the perimeter
    // built above.
    const tenantConnIds = new Set(connections.map((c: any) => c.id))
    const jobConnectionRefs = (j: any): string[] =>
      [j.metadata?.connectionId, j.metadata?.sourceCluster, j.metadata?.targetCluster].filter(Boolean)
    const inPerimeter = (ref: string) => tenantConnIds.has(ref) || connByName.has(ref)

    const tenantJobs = infra.kind === "provider"
      ? jobs
      : jobs.filter((j: any) => {
          const refs = jobConnectionRefs(j)
          if (refs.length === 0) return false
          return refs.some(inPerimeter)
        })

    // Apply filters
    let filtered = tenantJobs

    if (type && type !== "all") {
      filtered = filtered.filter(j => j.type === type)
    }

    if (status && status !== "all") {
      filtered = filtered.filter(j => j.status === status)
    }

    // Sort by most recent first
    filtered.sort((a, b) => {
      const dateA = new Date(a.startedAt || a.createdAt || 0).getTime()
      const dateB = new Date(b.startedAt || b.createdAt || 0).getTime()
      return dateB - dateA
    })

    // Apply limit
    const limitNum = Number.parseInt(limit, 10)
    if (limitNum > 0) {
      filtered = filtered.slice(0, limitNum)
    }

    // Calculate stats from tenant-filtered jobs
    const stats = {
      total: tenantJobs.length,
      running: tenantJobs.filter(j => j.status === "running").length,
      pending: tenantJobs.filter(j => j.status === "pending" || j.status === "queued").length,
      success: tenantJobs.filter(j => j.status === "success" || j.status === "completed").length,
      failed: tenantJobs.filter(j => j.status === "failed" || j.status === "cancelled").length,
      paused: tenantJobs.filter(j => j.status === "paused").length,
    }

    return NextResponse.json({ 
      data: filtered,
      stats,
    })
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error getting jobs:", error)
    }
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
