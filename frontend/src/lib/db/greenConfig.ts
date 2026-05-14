// Per-cluster and per-node Green-IT overrides. Every spec field is nullable
// so callers can express "inherit from the level above". Resolution at calc
// time walks node → cluster → global default.

import { prisma } from './prisma'

export interface ConnectionGreenConfigRow {
  connectionId: string
  datacenterId: string | null
  tdpPerCoreW: number | null
  wattsPerGbRam: number | null
  overheadPerNodeW: number | null
  updatedAt: string
}

export interface NodeGreenConfigRow {
  connectionId: string
  nodeName: string
  datacenterId: string | null
  tdpPerCoreW: number | null
  wattsPerGbRam: number | null
  overheadPerNodeW: number | null
  updatedAt: string
}

export interface GreenConfigInput {
  datacenterId?: string | null
  tdpPerCoreW?: number | null
  wattsPerGbRam?: number | null
  overheadPerNodeW?: number | null
}

function rowToConnection(r: any): ConnectionGreenConfigRow {
  return {
    connectionId: r.connectionId,
    datacenterId: r.datacenterId ?? null,
    tdpPerCoreW: r.tdpPerCoreW == null ? null : Number(r.tdpPerCoreW),
    wattsPerGbRam: r.wattsPerGbRam == null ? null : Number(r.wattsPerGbRam),
    overheadPerNodeW: r.overheadPerNodeW == null ? null : Number(r.overheadPerNodeW),
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
  }
}

function rowToNode(r: any): NodeGreenConfigRow {
  return {
    connectionId: r.connectionId,
    nodeName: r.nodeName,
    datacenterId: r.datacenterId ?? null,
    tdpPerCoreW: r.tdpPerCoreW == null ? null : Number(r.tdpPerCoreW),
    wattsPerGbRam: r.wattsPerGbRam == null ? null : Number(r.wattsPerGbRam),
    overheadPerNodeW: r.overheadPerNodeW == null ? null : Number(r.overheadPerNodeW),
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
  }
}

// ── connection_green_config ────────────────────────────────────────────────

export async function getConnectionGreenConfig(connectionId: string): Promise<ConnectionGreenConfigRow | null> {
  const r = await prisma.connectionGreenConfig.findUnique({ where: { connectionId } })


return r ? rowToConnection(r) : null
}

export async function upsertConnectionGreenConfig(connectionId: string, input: GreenConfigInput): Promise<ConnectionGreenConfigRow> {
  const data = {
    datacenterId: input.datacenterId ?? null,
    tdpPerCoreW: input.tdpPerCoreW ?? null,
    wattsPerGbRam: input.wattsPerGbRam ?? null,
    overheadPerNodeW: input.overheadPerNodeW ?? null,
    updatedAt: new Date(),
  }

  const r = await prisma.connectionGreenConfig.upsert({
    where: { connectionId },
    update: data,
    create: { connectionId, ...data },
  })


return rowToConnection(r)
}

export async function deleteConnectionGreenConfig(connectionId: string): Promise<void> {
  await prisma.connectionGreenConfig.deleteMany({ where: { connectionId } })
}

// ── node_green_config ──────────────────────────────────────────────────────

export async function getNodeGreenConfig(connectionId: string, nodeName: string): Promise<NodeGreenConfigRow | null> {
  const r = await prisma.nodeGreenConfig.findUnique({
    where: { connectionId_nodeName: { connectionId, nodeName } },
  })


return r ? rowToNode(r) : null
}

export async function listNodeGreenConfigs(connectionId: string): Promise<NodeGreenConfigRow[]> {
  const rows = await prisma.nodeGreenConfig.findMany({
    where: { connectionId },
    orderBy: { nodeName: 'asc' },
  })


return rows.map(rowToNode)
}

export async function upsertNodeGreenConfig(
  connectionId: string,
  nodeName: string,
  input: GreenConfigInput,
): Promise<NodeGreenConfigRow> {
  const data = {
    datacenterId: input.datacenterId ?? null,
    tdpPerCoreW: input.tdpPerCoreW ?? null,
    wattsPerGbRam: input.wattsPerGbRam ?? null,
    overheadPerNodeW: input.overheadPerNodeW ?? null,
    updatedAt: new Date(),
  }

  const r = await prisma.nodeGreenConfig.upsert({
    where: { connectionId_nodeName: { connectionId, nodeName } },
    update: data,
    create: { connectionId, nodeName, ...data },
  })


return rowToNode(r)
}

export async function deleteNodeGreenConfig(connectionId: string, nodeName: string): Promise<void> {
  await prisma.nodeGreenConfig.deleteMany({ where: { connectionId, nodeName } })
}

/**
 * Bulk-applies the cluster's `datacenterId` to every node, wiping per-node
 * DC overrides for that connection. Used by the "Apply DC to all nodes"
 * UX action.
 */
export async function clearAllNodeDatacenterOverrides(connectionId: string): Promise<void> {
  await prisma.nodeGreenConfig.updateMany({
    where: { connectionId },
    data: { datacenterId: null, updatedAt: new Date() },
  })
}
