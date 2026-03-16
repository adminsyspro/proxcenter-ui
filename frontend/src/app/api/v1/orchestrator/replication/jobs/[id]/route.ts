import { NextRequest, NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getTenantConnectionIds } from "@/lib/tenant"

export const runtime = "nodejs"

/** Verify that a replication job belongs to the current tenant */
async function verifyJobOwnership(id: string) {
  const client = getOrchestratorClient()
  const tenantConnectionIds = await getTenantConnectionIds()
  const response = await client.getReplicationJob(id)
  const job = response.data

  if (
    job &&
    ((job.source_cluster && !tenantConnectionIds.has(job.source_cluster)) ||
    (job.target_cluster && !tenantConnectionIds.has(job.target_cluster)))
  ) {
    return null // not owned by tenant
  }

  return job
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW, "global", "*")

    if (denied) return denied

    const { id } = await params
    const job = await verifyJobOwnership(id)

    if (!job) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    return NextResponse.json(job)
  } catch (e: any) {
    if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error fetching replication job:", e)
    }

    return NextResponse.json(
      { error: e?.message || "Failed to fetch replication job" },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_MANAGE, "global", "*")

    if (denied) return denied

    const { id } = await params
    const job = await verifyJobOwnership(id)

    if (!job) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const body = await request.json()
    const client = getOrchestratorClient()
    const response = await client.updateReplicationJob(id, body)

    return NextResponse.json(response.data)
  } catch (e: any) {
    if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error updating replication job:", e)
    }

    return NextResponse.json(
      { error: e?.message || "Failed to update replication job" },
      { status: 500 }
    )
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_MANAGE, "global", "*")

    if (denied) return denied

    const { id } = await params
    const job = await verifyJobOwnership(id)

    if (!job) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const client = getOrchestratorClient()
    const response = await client.deleteReplicationJob(id)

    return NextResponse.json(response.data)
  } catch (e: any) {
    if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error deleting replication job:", e)
    }

    return NextResponse.json(
      { error: e?.message || "Failed to delete replication job" },
      { status: 500 }
    )
  }
}
