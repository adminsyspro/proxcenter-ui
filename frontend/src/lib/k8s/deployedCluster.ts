// src/lib/k8s/deployedCluster.ts
import { NextResponse } from 'next/server'
import { getClusterWithCredential } from '@/lib/k8s/repository'

export type DeployedCluster = NonNullable<Awaited<ReturnType<typeof getClusterWithCredential>>> & { runId: string; connectionId: string }

/** The cluster, when ProxCenter deployed it (its run and its connection known). */
export async function deployedCluster(tenantId: string, id: string): Promise<DeployedCluster | Response> {
  const found = await getClusterWithCredential(tenantId, id)
  if (!found) return NextResponse.json({ error: 'Cluster not found' }, { status: 404 })
  const runId = found.row.provisioningRunId
  const connectionId = found.row.proxmoxConnectionId
  if (found.row.source !== 'deployed' || !runId || !connectionId) {
    return NextResponse.json({ error: 'not_deployed' }, { status: 404 })
  }
  return { ...found, runId, connectionId }
}
