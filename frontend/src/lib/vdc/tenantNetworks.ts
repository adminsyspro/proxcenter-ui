// src/lib/vdc/tenantNetworks.ts
// Stretched tenant networks (#901): one L2 network of a tenant carried by
// several of its vDCs at once. This module owns the network itself: its
// identity, the tenant-wide VNI reservation and the preferred PVE VNet id.
// Memberships (the local VNet in each vDC's zone and the peer exchange
// between the member zones) are orchestrated separately.

import crypto, { randomUUID } from 'crypto'

import { getConnectionById } from '@/lib/connections/getConnection'
import { prisma } from '@/lib/db/prisma'
import { DEFAULT_TENANT_ID } from '@/lib/tenant'

import { gatewayValidForCidr, parseCidr } from './network'
import { listVnetsPve, VNI_BASE } from './sdn'
import { ZONE_MTU_MAX, ZONE_MTU_MIN } from './transport'

const ERR = 'Tenant network:'

/** What the tenant reads: same alphabet as a VNet display name, free of PVE's 8-char limit. */
export const TENANT_NETWORK_NAME_REGEX = /^[a-z][a-z0-9-]{0,19}$/

/** VXLAN Network Identifier is 24 bits. */
export const VNI_MAX = 16_777_215

// Same shape as a PVE VNet id from sdn.ts: a letter followed by 7 hex chars.
const PVE_VNET_ID_PREFIX = 'v'
const PVE_VNET_ID_HEX_LEN = 7

export interface TenantNetworkMemberDto {
  vdcId: string
  vdcName: string
  connectionId: string
  connectionName: string
  /** The local VNet's PVE id, the network's preferred one unless a legacy VNet held it. */
  pveName: string
  zoneName: string | null
}

export interface TenantNetworkSubnet {
  id: string
  cidr: string
  gateway: string
  dnsServers: string[]
  ipamEnabled: boolean
}

export interface TenantNetwork {
  id: string
  tenantId: string
  tenantName: string
  name: string
  description: string | null
  pveName: string
  vni: number
  mtu: number | null
  /** The one IPAM pool of the whole L2 domain, shared by every member. */
  subnet: TenantNetworkSubnet | null
  members: TenantNetworkMemberDto[]
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateTenantNetworkInput {
  tenantId: string
  name: string
  description?: string | null
  /** An operator-chosen VNI (routers that read the tag want a known number); allocated when absent. */
  vni?: number | null
  mtu?: number | null
  /** L3 of the whole domain, one IPAM pool shared by every member. Mandatory, like a VNet's. */
  subnet: { cidr: string; gateway: string; dnsServers?: string[] }
}

export interface UpdateTenantNetworkInput {
  name?: string
  description?: string | null
  mtu?: number | null
  /** Only DNS is editable: a CIDR or gateway change would invalidate the allocations. */
  subnet?: { dnsServers?: string[] }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function normalizeName(raw: unknown): string {
  const name = String(raw ?? '').trim()
  if (!TENANT_NETWORK_NAME_REGEX.test(name)) {
    throw new Error(`${ERR} invalid name "${name}" (1-20 chars, lowercase letters / digits / dashes, must start with a letter).`)
  }
  return name
}

function normalizeMtu(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null
  const n = typeof raw === 'string' ? Number(raw.trim()) : Number(raw)
  if (!Number.isInteger(n) || n < ZONE_MTU_MIN || n > ZONE_MTU_MAX) {
    throw new Error(`${ERR} MTU must be an integer between ${ZONE_MTU_MIN} and ${ZONE_MTU_MAX}.`)
  }
  return n
}

function normalizeRequestedVni(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null
  const n = typeof raw === 'string' ? Number(raw.trim()) : Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > VNI_MAX) {
    throw new Error(`${ERR} VNI must be an integer between 1 and ${VNI_MAX}.`)
  }
  return n
}

function dnsCsv(list: string[] | undefined): string | null {
  const clean = (list ?? []).map(s => String(s).trim()).filter(Boolean)
  return clean.length > 0 ? clean.join(',') : null
}

function splitDns(csv: string | null | undefined): string[] {
  return csv ? csv.split(',').map(s => s.trim()).filter(Boolean) : []
}

function normalizeSubnet(raw: CreateTenantNetworkInput['subnet'] | undefined): { cidr: string; gateway: string; dnsServers: string | null } {
  const cidr = String(raw?.cidr ?? '').trim()
  const gateway = String(raw?.gateway ?? '').trim()
  if (!cidr || !gateway) throw new Error(`${ERR} a subnet (CIDR and gateway) is required, it is the one IPAM pool of the whole network.`)
  if (!parseCidr(cidr)) throw new Error(`${ERR} invalid CIDR "${cidr}", expected IPv4 form like 10.42.0.0/24.`)
  if (!gatewayValidForCidr(gateway, cidr)) throw new Error(`${ERR} gateway "${gateway}" is not a usable host inside ${cidr}.`)
  return { cidr, gateway, dnsServers: dnsCsv(raw?.dnsServers) }
}

// ---------------------------------------------------------------------------
// Tenant-wide VNI allocation
// ---------------------------------------------------------------------------

/** The clusters a network of this tenant can ever reach: those of its enabled vDCs. */
async function tenantClusterIds(tenantId: string): Promise<string[]> {
  const rows = await prisma.vdc.findMany({
    where: { tenantId, enabled: true },
    select: { connectionId: true },
    distinct: ['connectionId'],
  })
  return rows.map(r => r.connectionId)
}

async function connectionFor(connectionId: string): Promise<any> {
  const meta = await prisma.connection.findUnique({ where: { id: connectionId }, select: { tenantId: true } })
  if (!meta) throw new Error(`Connection not found: ${connectionId}`)
  return getConnectionById(connectionId, meta.tenantId)
}

/**
 * Every VNI a stretched network of this tenant must avoid, with who holds
 * it: every other tenant network (the reservation is global, so a cluster
 * joining later never finds its VNI taken), the VXLAN VNets ProxCenter
 * created on the tenant's clusters, and the live `/cluster/sdn/vnets` tag
 * set of those clusters, which also carries legacy zones and manual work.
 * The live read is best effort: an unreachable cluster does not block an
 * allocation, the PVE 400 at member creation stays the backstop.
 */
async function takenVnis(clusterIds: string[]): Promise<Map<number, string>> {
  const taken = new Map<number, string>()

  const networks = await prisma.tenantNetwork.findMany({ select: { vni: true, name: true } })
  for (const n of networks) taken.set(n.vni, `tenant network "${n.name}"`)

  if (clusterIds.length === 0) return taken

  const vnets = await prisma.vdcVnet.findMany({
    where: { type: 'vxlan', vdc: { connectionId: { in: clusterIds } } },
    select: { tag: true, displayName: true, pveName: true, vdc: { select: { name: true } } },
  })
  for (const v of vnets) {
    if (!taken.has(v.tag)) taken.set(v.tag, `network "${v.displayName ?? v.pveName}" of vDC "${v.vdc.name}"`)
  }

  const connections = await prisma.connection.findMany({
    where: { id: { in: clusterIds } },
    select: { id: true, name: true },
  })
  for (const c of connections) {
    try {
      const conn = await connectionFor(c.id)
      for (const v of await listVnetsPve(conn)) {
        if (Number.isFinite(v.tag) && !taken.has(v.tag)) taken.set(v.tag, `a VNet of cluster "${c.name}"`)
      }
    } catch {
      // Best effort, see above.
    }
  }
  return taken
}

/**
 * Picks the VNI of a new network of the tenant: the requested one when it
 * is free everywhere the tenant has a vDC, otherwise the next number above
 * everything taken, never below the historical VNI floor so a VLAN-only
 * fleet does not drag the allocation into the VLAN tag range.
 */
export async function allocateTenantVni(tenantId: string, requested: number | null): Promise<number> {
  const taken = await takenVnis(await tenantClusterIds(tenantId))

  if (requested !== null) {
    const holder = taken.get(requested)
    if (holder) throw new Error(`${ERR} VNI ${requested} is already used by ${holder}.`)
    return requested
  }

  let max = VNI_BASE - 1
  for (const vni of taken.keys()) if (vni > max) max = vni
  const next = max + 1
  if (next > VNI_MAX) throw new Error(`${ERR} no free VNI left below ${VNI_MAX}.`)
  return next
}

// ---------------------------------------------------------------------------
// Preferred PVE VNet id
// ---------------------------------------------------------------------------

/**
 * The 8-char id the network wants on every member cluster. Seeded on the
 * network id so a retried create lands on the same name, and checked
 * against every VNet ProxCenter knows on the tenant's clusters and every
 * other network's preferred id. A member that still finds it taken on one
 * cluster (a legacy VNet) falls back to a nonce variant there.
 */
export async function generateTenantNetworkPveName(networkId: string, clusterIds: string[]): Promise<string> {
  for (let i = 0; i < 16; i++) {
    const seed = i === 0 ? networkId : `${networkId}#${i}`
    const candidate = PVE_VNET_ID_PREFIX + crypto.createHash('sha256').update(seed).digest('hex').slice(0, PVE_VNET_ID_HEX_LEN)
    const [vnet, network] = await Promise.all([
      clusterIds.length === 0
        ? Promise.resolve(null)
        : prisma.vdcVnet.findFirst({ where: { pveName: candidate, vdc: { connectionId: { in: clusterIds } } }, select: { id: true } }),
      prisma.tenantNetwork.findFirst({ where: { pveName: candidate }, select: { id: true } }),
    ])
    if (!vnet && !network) return candidate
  }
  throw new Error(`${ERR} cannot generate a unique PVE VNet id for network ${networkId}.`)
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

const NETWORK_INCLUDE = {
  tenant: { select: { name: true } },
  subnet: true,
  members: {
    select: {
      vdcId: true,
      vdc: { select: { name: true, connectionId: true } },
      vnet: { select: { pveName: true, zoneName: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
}

function toIso(d: unknown): string {
  return d instanceof Date ? d.toISOString() : String(d)
}

async function rowToNetwork(row: any): Promise<TenantNetwork> {
  const connectionIds = [...new Set<string>(row.members.map((m: any) => m.vdc.connectionId))]
  const connections = connectionIds.length === 0
    ? []
    : await prisma.connection.findMany({ where: { id: { in: connectionIds } }, select: { id: true, name: true } })
  const connectionName = new Map(connections.map(c => [c.id, c.name]))
  return {
    id: row.id,
    tenantId: row.tenantId,
    tenantName: row.tenant?.name ?? row.tenantId,
    name: row.name,
    description: row.description ?? null,
    pveName: row.pveName,
    vni: row.vni,
    mtu: row.mtu ?? null,
    subnet: row.subnet
      ? {
          id: row.subnet.id,
          cidr: row.subnet.cidr,
          gateway: row.subnet.gateway,
          dnsServers: splitDns(row.subnet.dnsServers),
          ipamEnabled: row.subnet.ipamEnabled !== false,
        }
      : null,
    members: row.members.map((m: any) => ({
      vdcId: m.vdcId,
      vdcName: m.vdc.name,
      connectionId: m.vdc.connectionId,
      connectionName: connectionName.get(m.vdc.connectionId) ?? m.vdc.connectionId,
      pveName: m.vnet.pveName,
      zoneName: m.vnet.zoneName ?? null,
    })),
    createdBy: row.createdBy ?? null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listTenantNetworks(tenantId?: string): Promise<TenantNetwork[]> {
  const rows = await prisma.tenantNetwork.findMany({
    where: tenantId ? { tenantId } : undefined,
    include: NETWORK_INCLUDE,
    orderBy: [{ tenantId: 'asc' }, { name: 'asc' }],
  })
  return Promise.all(rows.map(rowToNetwork))
}

export async function getTenantNetwork(id: string): Promise<TenantNetwork> {
  const row = await prisma.tenantNetwork.findUnique({ where: { id }, include: NETWORK_INCLUDE })
  if (!row) throw new Error(`${ERR} not found: ${id}`)
  return rowToNetwork(row)
}

export async function createTenantNetwork(input: CreateTenantNetworkInput, createdBy: string | null): Promise<TenantNetwork> {
  if (!input.tenantId || input.tenantId === DEFAULT_TENANT_ID) {
    throw new Error(`${ERR} a network belongs to a tenant, it cannot be created on the provider tenant.`)
  }
  const tenant = await prisma.tenant.findUnique({ where: { id: input.tenantId }, select: { id: true } })
  if (!tenant) throw new Error(`Tenant not found: ${input.tenantId}`)

  const name = normalizeName(input.name)
  const mtu = normalizeMtu(input.mtu)
  const requestedVni = normalizeRequestedVni(input.vni)
  const subnet = normalizeSubnet(input.subnet)

  const duplicate = await prisma.tenantNetwork.findFirst({ where: { tenantId: input.tenantId, name }, select: { id: true } })
  if (duplicate) throw new Error(`${ERR} "${name}" already exists for this tenant.`)

  // Allocation and naming look at the same clusters: those of the tenant's
  // vDCs, because any of them may join later.
  const clusterIds = await tenantClusterIds(input.tenantId)
  const vni = await allocateTenantVni(input.tenantId, requestedVni)
  const id = randomUUID()
  const pveName = await generateTenantNetworkPveName(id, clusterIds)
  const now = new Date()

  await prisma.tenantNetwork.create({
    data: {
      id,
      tenantId: input.tenantId,
      name,
      description: input.description?.trim() || null,
      pveName,
      vni,
      mtu,
      createdBy,
      createdAt: now,
      updatedAt: now,
    },
  })
  // The canonical subnet: owned by the network, referenced by every member's
  // allocations, so `@@unique([subnetId, ip])` holds for the whole domain.
  try {
    await prisma.vdcSubnet.create({
      data: { id: randomUUID(), tenantNetworkId: id, cidr: subnet.cidr, gateway: subnet.gateway, dnsServers: subnet.dnsServers, ipamEnabled: true, createdAt: now },
    })
  } catch (err: any) {
    await prisma.tenantNetwork.delete({ where: { id } }).catch(() => undefined)
    throw new Error(`${ERR} failed to write the subnet: ${err?.message}`)
  }
  return getTenantNetwork(id)
}

export async function updateTenantNetwork(id: string, input: UpdateTenantNetworkInput): Promise<TenantNetwork> {
  const existing = await prisma.tenantNetwork.findUnique({
    where: { id },
    select: { id: true, tenantId: true, name: true, mtu: true, members: { select: { id: true } } },
  })
  if (!existing) throw new Error(`${ERR} not found: ${id}`)

  const data: { name?: string; description?: string | null; mtu?: number | null; updatedAt: Date } = { updatedAt: new Date() }

  if (input.name !== undefined) {
    const name = normalizeName(input.name)
    if (name !== existing.name) {
      const duplicate = await prisma.tenantNetwork.findFirst({ where: { tenantId: existing.tenantId, name }, select: { id: true } })
      if (duplicate) throw new Error(`${ERR} "${name}" already exists for this tenant.`)
      data.name = name
    }
  }
  if (input.description !== undefined) data.description = input.description?.trim() || null
  if (input.mtu !== undefined) {
    const mtu = normalizeMtu(input.mtu)
    // The MTU is a property of the whole L2 domain, carried by every member
    // zone: it is set before the first member joins, not changed under the
    // guests that already run on it.
    if (mtu !== (existing.mtu ?? null) && existing.members.length > 0) {
      throw new Error(`${ERR} the MTU cannot change while ${existing.members.length} vDC(s) carry the network. Remove the members first.`)
    }
    data.mtu = mtu
  }

  // DNS reaches the canonical subnet and the mirror of every member, they
  // must read the same.
  if (input.subnet?.dnsServers !== undefined) {
    await prisma.vdcSubnet.updateMany({
      where: { OR: [{ tenantNetworkId: id }, { vnet: { tenantNetworkMember: { tenantNetworkId: id } } }] },
      data: { dnsServers: dnsCsv(input.subnet.dnsServers) },
    })
  }

  await prisma.tenantNetwork.update({ where: { id }, data })
  return getTenantNetwork(id)
}

/**
 * Deletes a network that no vDC carries any more; the VNI is released with
 * the row. A network with members is refused: removing a member is what
 * deletes its local VNet and checks for attached guests.
 */
export async function deleteTenantNetwork(id: string): Promise<void> {
  const existing = await prisma.tenantNetwork.findUnique({
    where: { id },
    select: { id: true, name: true, members: { select: { id: true } } },
  })
  if (!existing) throw new Error(`${ERR} not found: ${id}`)
  if (existing.members.length > 0) {
    throw new Error(`${ERR} "${existing.name}" is still carried by ${existing.members.length} vDC(s). Remove the members first.`)
  }
  await prisma.tenantNetwork.delete({ where: { id } })
}
