import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:8080"

// Default community features when orchestrator is unavailable
const DEFAULT_COMMUNITY_FEATURES = {
  features: [
    { id: 'dashboard', name: 'Dashboard', enabled: true },
    { id: 'inventory', name: 'Inventory', enabled: true },
    { id: 'backups', name: 'Backups', enabled: true },
    { id: 'storage', name: 'Storage', enabled: true },
    { id: 'drs', name: 'DRS', enabled: false },
    { id: 'firewall', name: 'Firewall', enabled: false },
    { id: 'microsegmentation', name: 'Microsegmentation', enabled: false },
    { id: 'rolling_updates', name: 'Rolling Updates', enabled: false },
    { id: 'ai_insights', name: 'AI Insights', enabled: false },
    { id: 'predictive_alerts', name: 'Predictive Alerts', enabled: false },
    { id: 'green_metrics', name: 'Green Metrics', enabled: false },
    { id: 'cross_cluster_migration', name: 'Cross Cluster Migration', enabled: false },
    { id: 'ceph_replication', name: 'Ceph Replication', enabled: false },
    { id: 'ldap', name: 'LDAP', enabled: false },
    { id: 'reports', name: 'Reports', enabled: false },
    { id: 'rbac', name: 'RBAC', enabled: false },
    { id: 'jobs', name: 'Jobs', enabled: false },
    { id: 'notifications', name: 'Notifications', enabled: false },
  ]
}

export async function GET() {
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/license/features`, {
      cache: "no-store",
    })

    const data = await res.json()

    if (!res.ok) {
      return NextResponse.json(
        { error: data?.error || `HTTP ${res.status}` },
        { status: res.status }
      )
    }

    return NextResponse.json(data)
  } catch (e: any) {
    console.error("License features fetch failed:", e?.message)

    // Return default community features when orchestrator is unavailable
    if (e?.message?.includes('ECONNREFUSED') ||
        e?.message?.includes('fetch failed') ||
        e?.message?.includes('timeout')) {
      return NextResponse.json(DEFAULT_COMMUNITY_FEATURES)
    }

    return NextResponse.json(
      { error: e?.message || "Failed to fetch license features" },
      { status: 500 }
    )
  }
}
