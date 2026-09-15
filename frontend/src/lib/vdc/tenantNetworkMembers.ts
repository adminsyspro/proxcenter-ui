// src/lib/vdc/tenantNetworkMembers.ts
// Membership of a vDC in a stretched tenant network (#901): the local VNet
// created in the vDC's zone with the network's VNI and PVE id, the mirror of
// the network subnet that the VNet readers expect, and the exchange of
// transport peers between the member zones so the VXLAN tunnels meet.

import crypto, { randomUUID } from 'crypto'

import { prisma } from '@/lib/db/prisma'

import { clearVdcScopeCache } from './scope'
import {
  applySdn,
  countVnetAttachments,
  createVnetPve,
  deleteVnetPve,
  listVnetsPve,
  readZonePve,
  setVnetFirewallEnabled,
  updateZone,
} from './sdn'
import { connectionOf, memberPeersForVdc, VDC_TRANSPORT_SELECT, withMemberPeers, zoneConfigOfVdc } from './stretchPeers'
import { sameZoneConfig, transportFromRow } from './transport'
import { effectiveZoneConfig } from './transportOps'
import { checkVnetQuota } from './vnets'

const ERR = 'Tenant network:'

export interface ZoneSyncResult {
  vdcId: string
  vdcName: string
  connectionId: string
  zoneName: string
  /** Peers or MTU were rewritten and applied on that cluster. */
  changed: boolean
  error?: string
}

export interface AddMemberResult {
  vdcId: string
  vnetId: string
  /** The local VNet's PVE id: the network's preferred one, or a variant when that cluster already held it. */
  pveName: string
  zoneSync: ZoneSyncResult[]
}

const MEMBER_VDC_SELECT = {
  ...VDC_TRANSPORT_SELECT,
  tenantId: true,
  enabled: true,
} as const

async function loadNetwork(networkId: string) {
  const network = await prisma.tenantNetwork.findUnique({
    where: { id: networkId },
    include: {
      subnet: true,
      members: { select: { vdcId: true, vdc: { select: { connectionId: true } } } },
    },
  })
  if (!network) throw new Error(`${ERR} not found: ${networkId}`)
  return network
}

/**
 * The network's preferred PVE id when this cluster does not hold it yet,
 * otherwise a variant seeded on (network, cluster). Checked against the live
 * VNet list, which also sees legacy zones, and against our rows.
 */
async function pickMemberPveName(network: { id: string; pveName: string }, connectionId: string, conn: any): Promise<string> {
  const live = new Set((await listVnetsPve(conn)).map(v => v.vnet))
  const taken = async (name: string) =>
    live.has(name) || !!(await prisma.vdcVnet.findFirst({ where: { pveName: name, vdc: { connectionId } }, select: { id: true } }))

  if (!(await taken(network.pveName))) return network.pveName
  for (let i = 1; i <= 16; i++) {
    const candidate = 'v' + crypto.createHash('sha256').update(`${network.id}:${connectionId}#${i}`).digest('hex').slice(0, 7)
    if (!(await taken(candidate))) return candidate
  }
  throw new Error(`${ERR} cannot find a free PVE VNet id on this cluster for "${network.pveName}".`)
}

const mtuText = (mtu: number | null | undefined) => (mtu === null || mtu === undefined ? 'the Proxmox default' : String(mtu))

/**
 * Makes a vDC carry the network: one VNet in its zone with the network's
 * VNI, a mirror of the network subnet, the membership row, then the peers
 * of every member zone. Every refusal happens before Proxmox is touched.
 */
export async function addMember(networkId: string, vdcId: string): Promise<AddMemberResult> {
  const network = await loadNetwork(networkId)
  if (!network.subnet) throw new Error(`${ERR} "${network.name}" has no subnet yet, define it before adding a vDC.`)

  const vdc = await prisma.vdc.findUnique({ where: { id: vdcId }, select: MEMBER_VDC_SELECT })
  if (!vdc) throw new Error(`vDC not found: ${vdcId}`)
  if (vdc.tenantId !== network.tenantId) throw new Error(`${ERR} vDC "${vdc.name}" belongs to another tenant.`)
  if (vdc.enabled === false) throw new Error(`${ERR} vDC "${vdc.name}" is disabled.`)
  if (!vdc.sdnZoneName) {
    throw new Error(`${ERR} vDC "${vdc.name}" has no VXLAN zone, a VLAN-only vDC cannot carry a stretched network.`)
  }
  if (network.members.some(m => m.vdcId === vdcId)) throw new Error(`${ERR} vDC "${vdc.name}" already carries "${network.name}".`)
  if (network.members.some(m => m.vdc.connectionId === vdc.connectionId)) {
    throw new Error(`${ERR} another vDC on the same cluster already carries "${network.name}"; a VNI exists once per cluster.`)
  }
  // The interface MTU is a property of the whole L2 domain: the zone of
  // every member must carry the network's, or frames get fragmented on one
  // side only.
  const transport = transportFromRow(vdc)
  if ((transport.mtu ?? null) !== (network.mtu ?? null)) {
    throw new Error(
      `${ERR} the zone MTU of vDC "${vdc.name}" (${mtuText(transport.mtu)}) differs from the network MTU (${mtuText(network.mtu)}). Align them first.`,
    )
  }
  const quota = await checkVnetQuota(vdcId)
  if (!quota.allowed) throw new Error(`${ERR} quota exceeded on vDC "${vdc.name}": max_vnets=${quota.max}, current=${quota.current}.`)
  const clash = await prisma.vdcVnet.findFirst({ where: { vdcId, displayName: network.name }, select: { id: true } })
  if (clash) throw new Error(`${ERR} vDC "${vdc.name}" already has a network named "${network.name}".`)

  const conn = await connectionOf(vdc.connectionId)
  const pveName = await pickMemberPveName(network, vdc.connectionId, conn)

  await createVnetPve(conn, { pveName, zoneName: vdc.sdnZoneName, tag: network.vni, alias: network.name })

  const vnetId = randomUUID()
  const now = new Date()
  try {
    await prisma.$transaction(async tx => {
      await tx.vdcVnet.create({
        data: {
          id: vnetId,
          vdcId,
          pveName,
          displayName: network.name,
          description: network.description ?? `Tenant network "${network.name}"`,
          tag: network.vni,
          type: 'vxlan',
          bridge: null,
          zoneName: vdc.sdnZoneName,
          firewall: true,
          createdBy: network.createdBy ?? null,
          createdAt: now,
        },
      })
      // Mirror of the canonical subnet: same addressing for every reader
      // that expects one subnet per VNet; allocations go to the canonical
      // row through resolveSubnetForBridge.
      await tx.vdcSubnet.create({
        data: {
          id: randomUUID(),
          vnetId,
          cidr: network.subnet!.cidr,
          gateway: network.subnet!.gateway,
          dnsServers: network.subnet!.dnsServers,
          ipamEnabled: network.subnet!.ipamEnabled,
          createdAt: now,
        },
      })
      await tx.tenantNetworkMember.create({
        data: { id: randomUUID(), tenantNetworkId: networkId, vdcId, vnetId, createdAt: now },
      })
    })
  } catch (err: any) {
    try { await deleteVnetPve(conn, pveName) } catch {}
    throw new Error(`${ERR} failed to persist the membership of vDC "${vdc.name}": ${err?.message}`)
  }

  // Same order as a tenant VNet: apply first, the firewall endpoint refuses
  // a VNet it does not see yet. A firewall failure leaves the VNet usable
  // with PVE's default (filtering off), it is not worth a rollback.
  try { await applySdn(conn) } catch (err: any) {
    console.warn(`[tenant-network] applySdn failed after adding "${pveName}": ${err?.message}`)
  }
  try { await setVnetFirewallEnabled(conn, pveName, true) } catch (err: any) {
    console.warn(`[tenant-network] firewall enable failed on "${pveName}": ${err?.message}`)
  }

  clearVdcScopeCache(network.tenantId)
  const zoneSync = await syncNetworkZones(networkId)
  return { vdcId, vnetId, pveName, zoneSync }
}

/**
 * Stops a vDC carrying the network: refused while a guest NIC still uses
 * the local VNet, otherwise deletes that VNet (its mirror subnet, its
 * allocations and the membership go with it) and re-exchanges the peers.
 */
export async function removeMember(networkId: string, vdcId: string): Promise<{ zoneSync: ZoneSyncResult[] }> {
  const member = await prisma.tenantNetworkMember.findUnique({
    where: { tenantNetworkId_vdcId: { tenantNetworkId: networkId, vdcId } },
    include: {
      vnet: { select: { id: true, pveName: true } },
      vdc: { select: { name: true, tenantId: true, connectionId: true } },
      tenantNetwork: { select: { name: true } },
    },
  })
  if (!member) throw new Error(`${ERR} this vDC does not carry the network.`)

  const conn = await connectionOf(member.vdc.connectionId)
  const attached = await countVnetAttachments(conn, member.vnet.pveName)
  if (attached > 0) {
    throw new Error(
      `${ERR} ${attached} guest NIC(s) still use "${member.tenantNetwork.name}" on vDC "${member.vdc.name}". Detach them first.`,
    )
  }

  await deleteVnetPve(conn, member.vnet.pveName)
  // ON DELETE CASCADE: vdc_subnets (mirror), tenant_network_members, this
  // VNet's vdc_ipam_allocations.
  await prisma.vdcVnet.delete({ where: { id: member.vnet.id } })
  try { await applySdn(conn) } catch (err: any) {
    console.warn(`[tenant-network] applySdn failed after removing "${member.vnet.pveName}": ${err?.message}`)
  }

  clearVdcScopeCache(member.vdc.tenantId)
  return { zoneSync: await syncNetworkZones(networkId) }
}

/**
 * Brings the zone of every member to its own peers plus the other members',
 * rewriting and applying only where Proxmox differs. A cluster that fails
 * is reported and does not stop the others.
 */
export async function syncNetworkZones(networkId: string): Promise<ZoneSyncResult[]> {
  const members = await prisma.tenantNetworkMember.findMany({
    where: { tenantNetworkId: networkId },
    select: { vdc: { select: VDC_TRANSPORT_SELECT } },
    orderBy: { createdAt: 'asc' },
  })

  const results: ZoneSyncResult[] = []
  for (const { vdc } of members) {
    if (!vdc.sdnZoneName) continue
    const base = { vdcId: vdc.id, vdcName: vdc.name, connectionId: vdc.connectionId, zoneName: vdc.sdnZoneName }
    try {
      const conn = await connectionOf(vdc.connectionId)
      const desired = withMemberPeers(await zoneConfigOfVdc(vdc, conn), await memberPeersForVdc(vdc.id))
      const live = await readZonePve(conn, vdc.sdnZoneName)
      if (!live) throw new Error(`zone "${vdc.sdnZoneName}" not found on Proxmox`)
      const changed = !sameZoneConfig(desired, effectiveZoneConfig(live))
      if (changed) {
        await updateZone(conn, vdc.sdnZoneName, desired)
        await applySdn(conn)
      }
      results.push({ ...base, changed })
    } catch (err: any) {
      results.push({ ...base, changed: false, error: err?.message || String(err) })
    }
  }
  return results
}

/**
 * Re-exchanges the peers of every network a vDC carries, after that vDC's
 * own transport changed or after it was deleted: the other members' zones
 * still point at its old addresses otherwise. Never throws, the caller's
 * own write is done; failures are reported per cluster and logged.
 */
export async function syncNetworksOfVdc(vdcId: string, networkIds?: string[]): Promise<ZoneSyncResult[]> {
  const ids = networkIds ?? (await prisma.tenantNetworkMember.findMany({
    where: { vdcId },
    select: { tenantNetworkId: true },
  })).map(m => m.tenantNetworkId)
  const results: ZoneSyncResult[] = []
  for (const id of [...new Set(ids)]) {
    try {
      results.push(...await syncNetworkZones(id))
    } catch (err: any) {
      console.warn(`[tenant-network] zone re-sync failed for network ${id}: ${err?.message}`)
    }
  }
  for (const r of results) {
    if (r.error) console.warn(`[tenant-network] zone "${r.zoneName}" of vDC "${r.vdcName}" not re-synced: ${r.error}`)
  }
  return results
}
