import { NextResponse } from "next/server"

export const runtime = "nodejs"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:8080"

// GET /api/v1/orchestrator/jobs - List all jobs (rolling updates, future: DRS, migrations, etc.)
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const type = searchParams.get("type") // filter by type: rolling_update, drs, migration, etc.
    const status = searchParams.get("status") // filter by status: running, completed, failed, etc.
    const limit = searchParams.get("limit") || "50"

    // For now, we only have rolling updates as jobs
    // In the future, this could aggregate from multiple sources
    const jobs: any[] = []

    // Fetch rolling updates
    try {
      const rollingRes = await fetch(`${ORCHESTRATOR_URL}/api/v1/rolling-updates`, {
        headers: { "Content-Type": "application/json" },
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

          jobs.push({
            id: ru.id,
            name: `Rolling Update - ${ru.cluster_name || ru.connection_id}`,
            type: "rolling_update",
            status: jobStatus,
            progress,
            startedAt: ru.started_at,
            endedAt: ru.completed_at,
            createdAt: ru.created_at,
            detail: ru.current_node 
              ? `En cours: ${ru.current_node} (${ru.completed_nodes}/${ru.total_nodes} nœuds)`
              : `${ru.completed_nodes}/${ru.total_nodes} nœuds`,
            target: ru.cluster_name || ru.connection_id,
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
      console.error("Failed to fetch rolling updates:", e)
    }

    // TODO: In the future, fetch other job types here:
    // - DRS jobs
    // - Migration jobs
    // - Backup jobs (from PBS)
    // - Replication jobs

    // Apply filters
    let filtered = jobs

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
    const limitNum = parseInt(limit, 10)
    if (limitNum > 0) {
      filtered = filtered.slice(0, limitNum)
    }

    // Calculate stats
    const stats = {
      total: jobs.length,
      running: jobs.filter(j => j.status === "running").length,
      pending: jobs.filter(j => j.status === "pending" || j.status === "queued").length,
      success: jobs.filter(j => j.status === "success" || j.status === "completed").length,
      failed: jobs.filter(j => j.status === "failed" || j.status === "cancelled").length,
      paused: jobs.filter(j => j.status === "paused").length,
    }

    return NextResponse.json({ 
      data: filtered,
      stats,
    })
  } catch (error: any) {
    console.error("Error getting jobs:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
