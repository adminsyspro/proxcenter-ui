import { NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

// Mock data until the Go backend implements /replication/* endpoints
const MOCK_HEALTH = {
  sites: [
    { cluster_id: 'dc1-prod', name: 'DC1 Production', role: 'primary', status: 'online', node_count: 4, vm_count: 38 },
    { cluster_id: 'dc2-dr', name: 'DC2 Disaster Recovery', role: 'dr', status: 'online', node_count: 3, vm_count: 32 }
  ],
  connectivity: 'connected',
  latency_ms: 1.2,
  kpis: {
    protected_vms: 32,
    unprotected_vms: 6,
    avg_rpo_seconds: 45,
    last_sync: new Date(Date.now() - 120000).toISOString(),
    replicated_bytes: 2.8 * 1024 * 1024 * 1024 * 1024, // 2.8 TB
    error_count: 1
  },
  recent_activity: [
    { timestamp: new Date(Date.now() - 60000).toISOString(), type: 'sync', message: 'RBD mirror sync completed for vm-web-01 (2.4 GB in 8s)', severity: 'success' },
    { timestamp: new Date(Date.now() - 300000).toISOString(), type: 'error', message: 'Sync failed for vm-db-03: connection timeout to DC2', severity: 'error' },
    { timestamp: new Date(Date.now() - 900000).toISOString(), type: 'sync', message: 'RBD mirror sync completed for vm-app-05 (18.2 GB in 45s)', severity: 'success' },
    { timestamp: new Date(Date.now() - 1800000).toISOString(), type: 'plan_tested', message: 'Recovery plan "Critical Services" test failover completed successfully', severity: 'info' },
    { timestamp: new Date(Date.now() - 3600000).toISOString(), type: 'job_created', message: 'New replication job created for vm-monitoring-01', severity: 'info' },
    { timestamp: new Date(Date.now() - 7200000).toISOString(), type: 'sync', message: 'Full initial sync completed for vm-proxy-02 (120 GB in 22min)', severity: 'success' }
  ]
}

export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW, "global", "*")

    if (denied) return denied

    const client = getOrchestratorClient()
    const response = await client.getReplicationHealth()

    return NextResponse.json(response.data)
  } catch (e: any) {
    // Return mock data when orchestrator is not available
    return NextResponse.json(MOCK_HEALTH)
  }
}
