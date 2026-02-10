import { NextRequest, NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

// Mock data until the Go backend implements /replication/* endpoints
const MOCK_JOBS = [
  {
    id: 'rep-001', vm_id: 100, vm_name: 'vm-web-01',
    source_cluster: 'dc1-prod', source_pool: 'rbd-ssd',
    target_cluster: 'dc2-dr', target_pool: 'rbd-ssd',
    status: 'synced', schedule: '*/5 * * * *',
    rpo_target: 300, rpo_actual: 28,
    last_sync: new Date(Date.now() - 60000).toISOString(),
    next_sync: new Date(Date.now() + 240000).toISOString(),
    volume_bytes: 42 * 1024 * 1024 * 1024, throughput_bps: 0,
    online_mode: true, rate_limit_mbps: 0, network_mapping: {},
    progress_percent: 100, created_at: '2026-01-15T10:00:00Z', updated_at: new Date().toISOString()
  },
  {
    id: 'rep-002', vm_id: 101, vm_name: 'vm-web-02',
    source_cluster: 'dc1-prod', source_pool: 'rbd-ssd',
    target_cluster: 'dc2-dr', target_pool: 'rbd-ssd',
    status: 'syncing', schedule: '*/5 * * * *',
    rpo_target: 300, rpo_actual: 180,
    last_sync: new Date(Date.now() - 300000).toISOString(),
    next_sync: new Date(Date.now() + 60000).toISOString(),
    volume_bytes: 86 * 1024 * 1024 * 1024, throughput_bps: 920 * 1024 * 1024,
    online_mode: true, rate_limit_mbps: 0, network_mapping: {},
    progress_percent: 67, created_at: '2026-01-15T10:00:00Z', updated_at: new Date().toISOString()
  },
  {
    id: 'rep-003', vm_id: 200, vm_name: 'vm-db-01',
    source_cluster: 'dc1-prod', source_pool: 'rbd-nvme',
    target_cluster: 'dc2-dr', target_pool: 'rbd-nvme',
    status: 'synced', schedule: '* * * * *',
    rpo_target: 30, rpo_actual: 12,
    last_sync: new Date(Date.now() - 12000).toISOString(),
    next_sync: new Date(Date.now() + 48000).toISOString(),
    volume_bytes: 256 * 1024 * 1024 * 1024, throughput_bps: 0,
    online_mode: true, rate_limit_mbps: 500, network_mapping: {},
    progress_percent: 100, created_at: '2026-01-10T08:00:00Z', updated_at: new Date().toISOString()
  },
  {
    id: 'rep-004', vm_id: 201, vm_name: 'vm-db-02',
    source_cluster: 'dc1-prod', source_pool: 'rbd-nvme',
    target_cluster: 'dc2-dr', target_pool: 'rbd-nvme',
    status: 'synced', schedule: '* * * * *',
    rpo_target: 30, rpo_actual: 18,
    last_sync: new Date(Date.now() - 18000).toISOString(),
    next_sync: new Date(Date.now() + 42000).toISOString(),
    volume_bytes: 512 * 1024 * 1024 * 1024, throughput_bps: 0,
    online_mode: true, rate_limit_mbps: 500, network_mapping: {},
    progress_percent: 100, created_at: '2026-01-10T08:00:00Z', updated_at: new Date().toISOString()
  },
  {
    id: 'rep-005', vm_id: 202, vm_name: 'vm-db-03',
    source_cluster: 'dc1-prod', source_pool: 'rbd-ssd',
    target_cluster: 'dc2-dr', target_pool: 'rbd-ssd',
    status: 'error', schedule: '*/15 * * * *',
    rpo_target: 900, rpo_actual: 7200,
    last_sync: new Date(Date.now() - 7200000).toISOString(),
    next_sync: '',
    volume_bytes: 180 * 1024 * 1024 * 1024, throughput_bps: 0,
    online_mode: true, rate_limit_mbps: 0, network_mapping: {},
    progress_percent: 0, error_message: 'Connection timeout to DC2 rbd-ssd pool: daemon not responding',
    created_at: '2026-01-12T14:00:00Z', updated_at: new Date().toISOString()
  },
  {
    id: 'rep-006', vm_id: 300, vm_name: 'vm-app-05',
    source_cluster: 'dc1-prod', source_pool: 'rbd-ssd',
    target_cluster: 'dc2-dr', target_pool: 'rbd-ssd',
    status: 'synced', schedule: '*/15 * * * *',
    rpo_target: 900, rpo_actual: 420,
    last_sync: new Date(Date.now() - 420000).toISOString(),
    next_sync: new Date(Date.now() + 480000).toISOString(),
    volume_bytes: 64 * 1024 * 1024 * 1024, throughput_bps: 0,
    online_mode: true, rate_limit_mbps: 200, network_mapping: {},
    progress_percent: 100, created_at: '2026-01-20T09:30:00Z', updated_at: new Date().toISOString()
  },
  {
    id: 'rep-007', vm_id: 400, vm_name: 'vm-monitoring-01',
    source_cluster: 'dc1-prod', source_pool: 'rbd-hdd',
    target_cluster: 'dc2-dr', target_pool: 'rbd-hdd',
    status: 'paused', schedule: '0 * * * *',
    rpo_target: 3600, rpo_actual: 0,
    last_sync: new Date(Date.now() - 86400000).toISOString(),
    next_sync: '',
    volume_bytes: 320 * 1024 * 1024 * 1024, throughput_bps: 0,
    online_mode: false, rate_limit_mbps: 100, network_mapping: {},
    progress_percent: 0, created_at: '2026-02-01T16:00:00Z', updated_at: new Date().toISOString()
  },
  {
    id: 'rep-008', vm_id: 301, vm_name: 'vm-proxy-02',
    source_cluster: 'dc1-prod', source_pool: 'rbd-ssd',
    target_cluster: 'dc2-dr', target_pool: 'rbd-ssd',
    status: 'synced', schedule: '*/5 * * * *',
    rpo_target: 300, rpo_actual: 55,
    last_sync: new Date(Date.now() - 55000).toISOString(),
    next_sync: new Date(Date.now() + 245000).toISOString(),
    volume_bytes: 120 * 1024 * 1024 * 1024, throughput_bps: 0,
    online_mode: true, rate_limit_mbps: 0, network_mapping: {},
    progress_percent: 100, created_at: '2026-02-05T11:00:00Z', updated_at: new Date().toISOString()
  }
]

export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW, "global", "*")

    if (denied) return denied

    const client = getOrchestratorClient()
    const response = await client.getReplicationJobs()

    return NextResponse.json(response.data || [])
  } catch (e: any) {
    // Return mock data when orchestrator is not available
    return NextResponse.json(MOCK_JOBS)
  }
}

export async function POST(request: NextRequest) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_MANAGE, "global", "*")

    if (denied) return denied

    const body = await request.json()
    const client = getOrchestratorClient()
    const response = await client.createReplicationJob(body)

    return NextResponse.json(response.data)
  } catch (e: any) {
    console.error("Error creating replication job:", e)

    return NextResponse.json(
      { error: e?.message || "Failed to create replication job" },
      { status: 500 }
    )
  }
}
