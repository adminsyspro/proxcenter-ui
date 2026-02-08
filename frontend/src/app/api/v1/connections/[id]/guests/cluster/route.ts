// src/app/api/v1/connections/[id]/cluster/route.ts
import { NextResponse } from 'next/server'

import { pveFetch } from '@/lib/proxmox/client'
import { getConnectionById } from '@/lib/connections/getConnection'

export const runtime = 'nodejs'

function round1(n: number) {
  return Math.round((n + Number.EPSILON) * 10) / 10
}

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const conn = await getConnectionById(id)
  if (!conn) return NextResponse.json({ error: "Connection not found" }, { status: 404 })

  // 1) Nom du cluster (best effort)
  let name = 'Proxmox Cluster'
  let quorum: any = null

  try {
    const status = await pveFetch<any[]>(conn, '/cluster/status')

    const row =
      status.find(x => x?.type === 'cluster') ||
      status.find(x => x?.type === 'quorum') ||
      status.find(x => x?.name || x?.clustername)

    name = String(row?.name || row?.clustername || row?.cluster_name || name)

    const q =
      status.find(x => x?.type === 'quorum') ||
      status.find(x => x?.quorate !== undefined || x?.quorum !== undefined)

    if (q) {
      quorum = {
        quorate: q.quorate ?? q.quorum ?? null,
        nodes: q.nodes ?? null,
        expected_votes: q.expected_votes ?? null,
        votes: q.votes ?? null
      }
    }
  } catch {
    // cluster/status peut échouer si pas clusterisé → fallback
  }

  // 2) KPIs cluster via /cluster/resources (nodes)
  const resources = await pveFetch<any[]>(conn, '/cluster/resources')
  const nodes = resources.filter(r => r?.type === 'node')
  const totalNodes = nodes.length
  const onlineNodes = nodes.filter(n => String(n?.status).toLowerCase() === 'online').length

  const cpuAvgPct =
    totalNodes > 0
      ? round1((nodes.reduce((acc, n) => acc + Number(n?.cpu || 0), 0) / totalNodes) * 100)
      : 0

  const memUsed = nodes.reduce((acc, n) => acc + Number(n?.mem || 0), 0)
  const memMax = nodes.reduce((acc, n) => acc + Number(n?.maxmem || 0), 0)
  const ramPct = memMax > 0 ? round1((memUsed / memMax) * 100) : 0

  let health: 'healthy' | 'degraded' | 'down' = 'healthy'

  if (totalNodes > 0 && onlineNodes < totalNodes) health = 'degraded'
  if (totalNodes > 0 && onlineNodes === 0) health = 'down'

  return NextResponse.json({
    data: {
      id,
      name,
      health,
      nodes: { total: totalNodes, online: onlineNodes },
      cpuAvgPct,
      ramPct,
      memUsed,
      memMax,
      quorum
    }
  })
}
