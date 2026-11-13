// src/lib/vdc/evpnNetworks.ts
// Self-service networks of a tenant in a shared EVPN zone (#1334).
//
// One network, one VNI of the zone range, one PVE VNet id, present on the
// vDCs of the tenant that are attached to the zone: all of them by default,
// then extended or reduced by the tenant. Each presence is an ordinary VNet
// of its vDC, so it counts in that vDC's network quota and nowhere else. The
// model is the stretched tenant network (#901) with the zone as the carrier.
//
// Everything here is scoped to one tenant: a vDC or a network of another
// tenant is "not found", and no message names anything outside its vDCs.

import { randomUUID } from 'crypto'

import { prisma } from '@/lib/db/prisma'

import { rowToEdgeModel } from './types'
import { clearVdcScopeCache } from './scope'
import { addMember, AttachedNicsError, removeMember } from './tenantNetworkMembers'
import { generateTenantNetworkPveName, normalizeName, normalizeSubnet } from './tenantNetworks'
import { checkVnetQuota } from './vnets'
import { takenVnisOnTransport, VniError } from './vniPolicy'

const ERR = 'Tenant network:'

export interface EvpnContext {
  /** True when the vDC is attached to a shared zone. */
  available: boolean
  /** The vDCs of the tenant attached to the same zone, this one included. */
  vdcs: Array<{ id: string; name: string }>
  /** The networks the tenant holds in the zone, with the vDCs carrying each. */
  networks: Array<{ id: string; name: string; vdcIds: string[] }>
}

interface TenantVdc {
  id: string
  name: string
  connectionId: string
  evpnZoneId: string | null
  edgeModel: string | null
}

async function tenantVdc(vdcId: string, tenantId: string): Promise<TenantVdc> {
  const vdc = await prisma.vdc.findFirst({
    where: { id: vdcId, tenantId, enabled: { not: false } },
    select: { id: true, name: true, connectionId: true, evpnZoneId: true, edgeModel: true },
  })
  if (!vdc) throw new Error('vDC not found')
  return vdc
}

/** The enabled vDCs of the tenant attached to the zone. */
async function eligibleVdcs(tenantId: string, evpnZoneId: string): Promise<TenantVdc[]> {
  return prisma.vdc.findMany({
    where: { tenantId, evpnZoneId, enabled: { not: false } },
    select: { id: true, name: true, connectionId: true, evpnZoneId: true, edgeModel: true },
    orderBy: { name: 'asc' },
  })
}

export async function evpnContextForVdc(vdcId: string, tenantId: string): Promise<EvpnContext> {
  const vdc = await tenantVdc(vdcId, tenantId)
  if (!vdc.evpnZoneId) return { available: false, vdcs: [], networks: [] }
  const [vdcs, networks] = await Promise.all([
    eligibleVdcs(tenantId, vdc.evpnZoneId),
    prisma.tenantNetwork.findMany({
      where: { tenantId, evpnZoneId: vdc.evpnZoneId },
      select: { id: true, name: true, members: { select: { vdcId: true } } },
      orderBy: { name: 'asc' },
    }),
  ])
  return {
    available: true,
    vdcs: vdcs.map(v => ({ id: v.id, name: v.name })),
    networks: networks.map(n => ({ id: n.id, name: n.name, vdcIds: n.members.map(m => m.vdcId) })),
  }
}

/** The vDCs asked for, checked against the tenant's attached ones; `always` is kept in. */
function pickTargets(eligible: TenantVdc[], requested: string[] | undefined, always?: string): TenantVdc[] {
  if (requested === undefined) return eligible
  const wanted = new Set(requested.map(String))
  if (always) wanted.add(always)
  const byId = new Map(eligible.map(v => [v.id, v]))
  for (const id of wanted) {
    if (!byId.has(id)) throw new Error(`${ERR} a selected vDC is not attached to the shared zone.`)
  }
  return eligible.filter(v => wanted.has(v.id))
}

async function assertQuota(vdc: TenantVdc): Promise<void> {
  const quota = await checkVnetQuota(vdc.id)
  if (!quota.allowed) {
    throw new Error(`Quota exceeded on vDC "${vdc.name}": max_vnets=${quota.max}, current=${quota.current}`)
  }
}

/** First free VNI of the zone range, against every VNI any cluster carries. */
async function allocateZoneVni(zone: { vniStart: number; vniEnd: number }): Promise<number> {
  const taken = await takenVnisOnTransport('')
  for (let vni = zone.vniStart; vni <= zone.vniEnd; vni++) {
    if (!taken.has(vni)) return vni
  }
  throw new VniError('No free VNI left in the shared zone. Ask your provider to extend it.', 409)
}

export interface CreateEvpnNetworkInput {
  vdcId: string
  tenantId: string
  displayName: string
  description?: string
  /** Optional: without it the network is pure L2 and the tenant brings its addressing. */
  subnet?: { cidr: string; gateway: string; dnsServers?: string[] } | null
  /** The vDCs carrying the network; absent = every attached vDC of the tenant. */
  vdcIds?: string[]
  createdBy: string | null
}

/**
 * Creates the network and its presence on each chosen vDC. Every refusal that
 * can be known up front (name, subnet, quota of each vDC) comes before the
 * first write; a cluster that fails afterwards undoes the presences already
 * created, so the tenant never keeps half a network. Per cluster: one VNet
 * list, one VNet creation, one SDN apply (a network reload on each node).
 */
export async function createEvpnNetworkForTenant(input: CreateEvpnNetworkInput): Promise<{ id: string; vni: number; vdcIds: string[] }> {
  const vdc = await tenantVdc(input.vdcId, input.tenantId)
  if (!vdc.evpnZoneId) throw new Error(`${ERR} this vDC is not attached to a shared zone.`)
  const zone = await prisma.sdnEvpnZone.findUnique({
    where: { id: vdc.evpnZoneId },
    select: { id: true, mtu: true, vniStart: true, vniEnd: true },
  })
  if (!zone) throw new Error(`${ERR} this vDC is not attached to a shared zone.`)

  const name = normalizeName(input.displayName)
  const targets = pickTargets(await eligibleVdcs(input.tenantId, zone.id), input.vdcIds, vdc.id)

  const subnet = input.subnet ? normalizeSubnet(input.subnet) : null
  if (!subnet && targets.some(t => rowToEdgeModel(t.edgeModel) === 'platform')) {
    throw new Error('A selected vDC gets its gateway, DHCP and NAT from the platform: define the subnet (CIDR and gateway) of the network.')
  }

  const duplicate = await prisma.tenantNetwork.findFirst({ where: { tenantId: input.tenantId, name }, select: { id: true } })
  if (duplicate) throw new Error(`VNet "${name}" already exists for this tenant`)
  const clash = await prisma.vdcVnet.findFirst({
    where: { vdcId: { in: targets.map(t => t.id) }, displayName: name },
    select: { vdc: { select: { name: true } } },
  })
  if (clash) throw new Error(`VNet "${name}" already exists in vDC "${clash.vdc.name}"`)
  for (const target of targets) await assertQuota(target)

  const vni = await allocateZoneVni(zone)
  const id = randomUUID()
  const pveName = await generateTenantNetworkPveName(id, targets.map(t => t.connectionId))
  const now = new Date()

  try {
    await prisma.tenantNetwork.create({
      data: {
        id, tenantId: input.tenantId, name, description: input.description?.trim() || null,
        pveName, vni, mtu: zone.mtu ?? null, evpnZoneId: zone.id, createdBy: input.createdBy, createdAt: now, updatedAt: now,
      },
    })
  } catch (err: any) {
    // Two creations at once picked the same VNI or the same name: the unique
    // indexes kept one, the other is asked to try again.
    if (err?.code === 'P2002') throw new VniError('Another network was created at the same time. Try again.', 409)
    throw err
  }
  const added: string[] = []
  try {
    if (subnet) {
      await prisma.vdcSubnet.create({
        data: { id: randomUUID(), tenantNetworkId: id, cidr: subnet.cidr, gateway: subnet.gateway, dnsServers: subnet.dnsServers, ipamEnabled: true, createdAt: now },
      })
    }
    for (const target of targets) {
      await addMember(id, target.id)
      added.push(target.id)
    }
  } catch (err) {
    for (const vdcId of added.reverse()) await removeMember(id, vdcId).catch(() => undefined)
    await prisma.tenantNetwork.delete({ where: { id } }).catch(() => undefined)
    throw err
  }
  clearVdcScopeCache(input.tenantId)
  return { id, vni, vdcIds: added }
}

async function tenantEvpnNetwork(networkId: string, tenantId: string) {
  const network = await prisma.tenantNetwork.findFirst({
    where: { id: networkId, tenantId, evpnZoneId: { not: null } },
    select: { id: true, name: true, evpnZoneId: true, members: { select: { vdcId: true } } },
  })
  if (!network) throw new Error(`${ERR} not found.`)
  return network
}

/**
 * Sets the vDCs that carry a network: added where it is newly ticked (quota
 * of that vDC checked first), removed where it is unticked (refused while a
 * guest still uses it there). At least one vDC must keep it.
 */
export async function setEvpnNetworkPresence(networkId: string, tenantId: string, vdcIds: string[]): Promise<{ vdcIds: string[] }> {
  const network = await tenantEvpnNetwork(networkId, tenantId)
  const eligible = await eligibleVdcs(tenantId, network.evpnZoneId!)
  const targets = pickTargets(eligible, vdcIds)
  if (targets.length === 0) throw new Error(`${ERR} a network must stay on at least one vDC. Delete it instead.`)

  const current = new Set(network.members.map(m => m.vdcId))
  const wanted = new Set(targets.map(t => t.id))
  const toAdd = targets.filter(t => !current.has(t.id))
  const toRemove = [...current].filter(id => !wanted.has(id))
  for (const target of toAdd) await assertQuota(target)

  for (const target of toAdd) await addMember(networkId, target.id)
  for (const vdcId of toRemove) await removeMember(networkId, vdcId)
  clearVdcScopeCache(tenantId)
  return { vdcIds: targets.map(t => t.id) }
}

/**
 * Takes a network off one vDC; the network itself goes with its last vDC.
 * Answers like a VNet deletion: the NIC count when guests still use it.
 */
export async function removeEvpnNetworkFromVdc(
  networkId: string,
  vdcId: string,
): Promise<{ deleted: true } | { deleted: false; attachmentCount: number }> {
  try {
    await removeMember(networkId, vdcId)
  } catch (err) {
    if (err instanceof AttachedNicsError) return { deleted: false, attachmentCount: err.count }
    throw err
  }
  await prisma.tenantNetwork.deleteMany({ where: { id: networkId, evpnZoneId: { not: null }, members: { none: {} } } })
  return { deleted: true }
}
