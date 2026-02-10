import { NextRequest, NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

// Mock data until the Go backend implements /replication/* endpoints
const MOCK_PLANS = [
  {
    id: 'plan-001',
    name: 'Critical Services',
    description: 'Failover plan for all critical production databases and web frontends',
    status: 'ready',
    source_cluster: 'dc1-prod',
    target_cluster: 'dc2-dr',
    vms: [
      { vm_id: 200, vm_name: 'vm-db-01', replication_job_id: 'rep-003', tier: 1, boot_order: 1 },
      { vm_id: 201, vm_name: 'vm-db-02', replication_job_id: 'rep-004', tier: 1, boot_order: 2 },
      { vm_id: 100, vm_name: 'vm-web-01', replication_job_id: 'rep-001', tier: 2, boot_order: 3 },
      { vm_id: 101, vm_name: 'vm-web-02', replication_job_id: 'rep-002', tier: 2, boot_order: 4 },
      { vm_id: 301, vm_name: 'vm-proxy-02', replication_job_id: 'rep-008', tier: 2, boot_order: 5 }
    ],
    last_test: new Date(Date.now() - 15 * 86400000).toISOString(), // 15 days ago
    last_failover: null,
    created_at: '2026-01-15T10:00:00Z',
    updated_at: new Date().toISOString()
  },
  {
    id: 'plan-002',
    name: 'Application Tier',
    description: 'Secondary application servers and monitoring',
    status: 'degraded',
    source_cluster: 'dc1-prod',
    target_cluster: 'dc2-dr',
    vms: [
      { vm_id: 300, vm_name: 'vm-app-05', replication_job_id: 'rep-006', tier: 2, boot_order: 1 },
      { vm_id: 202, vm_name: 'vm-db-03', replication_job_id: 'rep-005', tier: 1, boot_order: 2 },
      { vm_id: 400, vm_name: 'vm-monitoring-01', replication_job_id: 'rep-007', tier: 3, boot_order: 3 }
    ],
    last_test: new Date(Date.now() - 45 * 86400000).toISOString(), // 45 days ago
    last_failover: null,
    created_at: '2026-01-20T14:00:00Z',
    updated_at: new Date().toISOString()
  }
]

export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW, "global", "*")

    if (denied) return denied

    const client = getOrchestratorClient()
    const response = await client.getRecoveryPlans()

    return NextResponse.json(response.data || [])
  } catch (e: any) {
    // Return mock data when orchestrator is not available
    return NextResponse.json(MOCK_PLANS)
  }
}

export async function POST(request: NextRequest) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_MANAGE, "global", "*")

    if (denied) return denied

    const body = await request.json()
    const client = getOrchestratorClient()
    const response = await client.createRecoveryPlan(body)

    return NextResponse.json(response.data)
  } catch (e: any) {
    console.error("Error creating recovery plan:", e)

    return NextResponse.json(
      { error: e?.message || "Failed to create recovery plan" },
      { status: 500 }
    )
  }
}
