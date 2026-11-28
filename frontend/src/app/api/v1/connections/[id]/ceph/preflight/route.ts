import { NextResponse } from 'next/server'

import { cephNodeState, defaultRepository, readReleases } from '@/lib/ceph/deployPreflight'
import { sudoAllows } from '@/lib/ceph/detachedPveceph'
import { cephConnection, checkCephWrite, provisionError } from '@/lib/ceph/provisionRoute'
import { installArgv } from '@/lib/ceph/pvecephCommands'
import { denyIaasTenantCeph } from '@/lib/ceph/tenantGuard'
import { pveFetch } from '@/lib/proxmox/client'
import { resolveNodeSshEndpoint } from '@/lib/ssh/node-endpoint'

export const runtime = 'nodejs'

/*
   First step of the Ceph deploy wizard (ui#1450), read once when it opens,
   never polled: for each online node, the state of Ceph (/ceph/status, whose
   errors PVE words itself), the PVE version, the subscription (the enterprise
   repository needs one) and whether the SSH account may run pveceph install
   (one `sudo -n -l`, nothing runs). Four PVE reads and one SSH probe per node.
   An offline node is listed and left alone.
*/

type Ctx = { params: Promise<{ id: string }> }

async function readNode(id: string, conn: any, node: string) {
  const base = `/nodes/${encodeURIComponent(node)}`
  const [status, version, subscription] = await Promise.all([
    pveFetch<any>(conn, `${base}/ceph/status`).then(() => ({ ok: true as const }), (error: unknown) => ({ error })),
    pveFetch<any>(conn, `${base}/version`).catch(() => null),
    pveFetch<any>(conn, `${base}/subscription`).catch(() => null),
  ])
  const endpoint = await resolveNodeSshEndpoint(conn, node)
  const ssh = await sudoAllows(id, endpoint, installArgv('tentacle', 'no-subscription'))
  return {
    ceph: cephNodeState(status),
    pveVersion: typeof version?.version === 'string' ? version.version : null,
    repository: defaultRepository(subscription),
    ssh,
  }
}

/** GET /api/v1/connections/[id]/ceph/preflight → { data: { nodes, releases } } */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const denied = await checkCephWrite(id)
    if (denied) return denied
    const cephDenied = await denyIaasTenantCeph()
    if (cephDenied) return cephDenied
    const gate = await cephConnection(id)
    if (gate.ok === false) return gate.response

    const status = await pveFetch<any[]>(gate.conn, '/cluster/status')
    const rows = (Array.isArray(status) ? status : []).filter((r: any) => r?.type === 'node' && typeof r.name === 'string')

    const nodes = await Promise.all(rows.map(async (r: any) => {
      const online = r.online === 1 || r.online === true
      const head = { node: r.name as string, online, address: typeof r.ip === 'string' ? r.ip : null }
      if (!online) return { ...head, ceph: 'unknown', pveVersion: null, repository: 'no-subscription', ssh: null }
      return { ...head, ...(await readNode(id, gate.conn, r.name)) }
    }))

    const firstOnline = nodes.find(n => n.online)?.node
    const releases = readReleases(firstOnline
      ? await pveFetch<any[]>(gate.conn, `/nodes/${encodeURIComponent(firstOnline)}/ceph/releases`).catch(() => null)
      : null)

    return NextResponse.json({ data: { nodes, releases } })
  } catch (e: any) {
    return provisionError('preflight', e, 'Failed to read the nodes of the cluster')
  }
}
