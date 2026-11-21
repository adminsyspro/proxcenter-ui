import { NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { getReplicationScope, scopeReplicationItems, summarizeReplicationJobs } from "@/lib/orchestrator/replicationScope"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW, "global", "*")
    if (denied) return denied

    const scope = await getReplicationScope()
    const client = getOrchestratorClient()
    const [response, jobs] = await Promise.all([
      client.getReplicationHealth(),
      client.getReplicationJobs().then(r => r.data).catch(() => null),
    ])

    const data = response.data
    if (data?.sites && Array.isArray(data.sites)) {
      data.sites = data.sites.filter(s => !s.cluster_id || scope.connectionIds.has(s.cluster_id))
    }

    // The orchestrator counts every job it holds. Count the ones the Site
    // Recovery list shows instead, so a figure never points at a job nobody
    // can find (ui#1394): another tenant's, or one hidden for another reason.
    if (data && Array.isArray(jobs)) {
      const { job_summary, error_count, total_jobs } = summarizeReplicationJobs(scopeReplicationItems(jobs, scope))

      data.job_summary = job_summary
      if (data.kpis) Object.assign(data.kpis, { error_count, total_jobs })
    }

    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: "Failed to load replication status" }, { status: 502 })
  }
}
