// src/lib/vdc/vnets.ts
// Tenant-scoped VNet orchestration (DB mirror + PVE SDN operations).

import { randomUUID } from 'crypto'

import { getConnectionById } from '@/lib/connections/getConnection'
import { prisma } from '@/lib/db/prisma'

import type { VdcVnet, VdcSubnet } from './types'
import { clearVdcScopeCache } from './scope'
import {
  parseCidr,
  gatewayValidForCidr,
} from './network'

import {
  createVnetPve,
  setVnetFirewallEnabled,
  deleteVnetPve,
  allocateVni,
  applySdn,
  countVnetAttachments,
  generatePveVnetId,
} from './sdn'
import { allocateVlanTag, ensureVlanZone } from './vlan'

// ---------------------------------------------------------------------------
// resolveVdcForVnet
// ---------------------------------------------------------------------------

interface ResolvedVdc {
  id: string
  tenantId: string
  connectionId: string
  /** Null on a VLAN-only vDC: the VXLAN zone is provisioned per vDC, VLAN
   *  networks live in a shared per-(connection, bridge) zone instead. */
  sdnZoneName: string | null
}

export async function resolveVdcForVnet(vdcId: string, tenantId: string): Promise<ResolvedVdc | null> {
  const row = await prisma.vdc.findFirst({
    where: { id: vdcId, tenantId },
    select: { id: true, tenantId: true, connectionId: true, sdnZoneName: true, enabled: true },
  })
  if (!row) return null
  if (row.enabled === false) return null
  return {
    id: row.id,
    tenantId: row.tenantId,
    connectionId: row.connectionId,
    sdnZoneName: row.sdnZoneName,
  }
}

// ---------------------------------------------------------------------------
// checkVnetQuota
// ---------------------------------------------------------------------------

export interface VnetQuotaResult {
  allowed: boolean
  current: number
  max: number | null
}

export async function checkVnetQuota(vdcId: string): Promise<VnetQuotaResult> {
  const [quotaRow, current] = await Promise.all([
    prisma.vdcQuota.findUnique({ where: { vdcId }, select: { maxVnets: true } }),
    prisma.vdcVnet.count({ where: { vdcId } }),
  ])
  const max: number | null = quotaRow?.maxVnets ?? null
  if (max === null) return { allowed: true, current, max: null }
  return { allowed: current < max, current, max }
}

// ---------------------------------------------------------------------------
// listVnetsForTenant
// ---------------------------------------------------------------------------

function rowToSubnet(r: any): VdcSubnet | null {
  if (!r || !r.id) return null
  const dnsRaw: string | null = r.dnsServers ?? null
  const dnsServers = dnsRaw
    ? dnsRaw.split(',').map((s: string) => s.trim()).filter(Boolean)
    : []
  return {
    id: r.id,
    vnetId: r.vnetId,
    cidr: r.cidr,
    gateway: r.gateway,
    dnsServers,
    ipamEnabled: r.ipamEnabled !== false,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  }
}

function rowToVnet(r: any): VdcVnet {
  const subnet = rowToSubnet(r.subnet)
  if (!subnet) {
    // The schema enforces a 1-1 between VNet and subnet now (subnet is
    // created in the same transaction as the VNet). A missing row means
    // legacy data we couldn't migrate or hand-corrupted state — surface
    // it loudly rather than silently returning a half-broken VNet.
    throw new Error(`VNet ${r.id} has no subnet — DB migration required`)
  }
  return {
    id: r.id,
    vdcId: r.vdcId,
    pveName: r.pveName,
    displayName: r.displayName ?? r.pveName,
    description: r.description ?? null,
    tag: r.tag,
    type: (r.type ?? 'vxlan') as 'vxlan' | 'vlan',
    bridge: r.bridge ?? null,
    zoneName: r.zoneName ?? null,
    firewall: r.firewall !== false,
    subnet,
    createdBy: r.createdBy ?? null,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  }
}

export async function listVnetsForTenant(vdcId: string): Promise<VdcVnet[]> {
  const rows = await prisma.vdcVnet.findMany({
    where: { vdcId },
    include: { subnet: true },
    orderBy: { displayName: 'asc' },
  })
  return rows.map(rowToVnet)
}

/** Resolve a user-facing display name (scoped to a vDC) to its row. */
async function findVnetByDisplayName(vdcId: string, displayName: string) {
  return prisma.vdcVnet.findFirst({
    where: { vdcId, displayName },
    include: { subnet: true },
  })
}

// ---------------------------------------------------------------------------
// createVnetForTenant
// ---------------------------------------------------------------------------

export interface CreateVnetInput {
  vdcId: string
  tenantId: string
  /** Free-form, tenant-facing name; unique per vDC. We hash this into the
   *  8-char pve_name actually sent to PVE so two tenants can both use "lan". */
  displayName: string
  description?: string
  firewall?: boolean
  /** L3 + IPAM config attached at create time. Mandatory: ProxCenter's IPAM
   *  is the only working IP allocator on VXLAN (PVE-native IPAM/DHCP are
   *  broken on PVE 9.x VXLAN zones), so a VNet without a subnet would have
   *  no way to assign IPs to its VMs. */
  subnet: {
    cidr: string
    gateway: string
    dnsServers?: string[]
  }
  /** 'vxlan' (default) or 'vlan'. VLAN requires `bridge` and a matching vDC pool. */
  type?: 'vxlan' | 'vlan'
  bridge?: string
  /** Explicit VLAN tag; null/undefined = auto (first free in the vDC pools). */
  vlanTag?: number | null
  /** True = subnet stays declarative: ipamEnabled=false, no auto-IP at deploy. */
  externalAddressing?: boolean
  createdBy: string | null
}

/** Validate the subnet config block. Throws on first violation with a
 *  user-readable message that survives across the API boundary unchanged. */
function validateSubnetInput(input: CreateVnetInput['subnet']): void {
  if (!parseCidr(input.cidr)) {
    throw new Error(`Invalid CIDR "${input.cidr}" — expected IPv4 form like 10.42.0.0/24`)
  }
  if (!gatewayValidForCidr(input.gateway, input.cidr)) {
    throw new Error(`Gateway "${input.gateway}" is not a usable host inside ${input.cidr}`)
  }
}

// Display name is what tenants type — kept scoped to their vDC, free of PVE's
// 8-char + cluster-wide constraints. Up to 20 lowercase alphanumeric chars,
// optionally separated by single dashes; must start with a letter.
const VNET_DISPLAY_NAME_REGEX = /^[a-z][a-z0-9-]{0,19}$/

async function getConn(vdc: ResolvedVdc): Promise<any> {
  const connMeta = await prisma.connection.findUnique({
    where: { id: vdc.connectionId },
    select: { tenantId: true },
  })
  if (!connMeta) throw new Error(`Connection not found: ${vdc.connectionId}`)
  return getConnectionById(vdc.connectionId, connMeta.tenantId)
}

export async function createVnetForTenant(input: CreateVnetInput): Promise<VdcVnet> {
  const vdc = await resolveVdcForVnet(input.vdcId, input.tenantId)
  if (!vdc) throw new Error('vDC not found')

  const displayName = input.displayName
  if (!VNET_DISPLAY_NAME_REGEX.test(displayName)) {
    throw new Error('Invalid VNet name (1-20 chars, lowercase letters / digits / dashes, must start with a letter)')
  }

  // Subnet is mandatory — IPAM only works with a CIDR + gateway.
  validateSubnetInput(input.subnet)

  // Display name uniqueness is scoped to the vDC — two tenants can both
  // legitimately have a "lan". The unique index on (vdc_id, display_name)
  // also enforces this at the DB level.
  if (await findVnetByDisplayName(vdc.id, displayName)) {
    throw new Error(`VNet "${displayName}" already exists in this vDC`)
  }

  const quota = await checkVnetQuota(vdc.id)
  if (!quota.allowed) {
    throw new Error(`Quota exceeded: max_vnets=${quota.max}, current=${quota.current}`)
  }

  const pveName = await generatePveVnetId(vdc.id, displayName)
  const conn = await getConn(vdc)

  const type: 'vxlan' | 'vlan' = input.type === 'vlan' ? 'vlan' : 'vxlan'
  let tag: number
  let zoneName: string
  let bridge: string | null = null

  if (type === 'vlan') {
    if (!input.bridge) throw new Error('bridge is required for a VLAN network')
    bridge = input.bridge
    // Pool + DB + live-PVE union; throws the user-facing 400/409 messages.
    tag = await allocateVlanTag({
      vdcId: vdc.id, connectionId: vdc.connectionId,
      bridge, requestedTag: input.vlanTag ?? null, conn,
    })
    // Shared provider zone for (connection, bridge), lazily created, never
    // deleted. PVE's per-zone tag uniqueness backstops a cross-vDC race:
    // two concurrent creates with the same tag end in one PVE 400.
    zoneName = await ensureVlanZone(conn, vdc.connectionId, bridge)
  } else {
    if (!vdc.sdnZoneName) {
      throw new Error('vDC has no SDN zone - VXLAN networks are unavailable on this vDC')
    }
    zoneName = vdc.sdnZoneName
    // Pass the PVE connection so allocateVni can union our DB's max tag
    // with the live `/cluster/sdn/vnets` set, avoids handing back a tag a
    // legacy zone already booked under our feet.
    tag = await allocateVni(vdc.id, conn)
  }

  const firewall = input.firewall !== false

  await createVnetPve(conn, {
    pveName,
    zoneName,
    tag,
    alias: displayName,
  })

  const id = randomUUID()
  const now = new Date()

  try {
    await prisma.vdcVnet.create({
      data: {
        id,
        vdcId: vdc.id,
        pveName,
        displayName,
        description: input.description ?? null,
        tag,
        type,
        bridge,
        zoneName,
        firewall,
        createdBy: input.createdBy,
        createdAt: now,
      },
    })
  } catch (err: any) {
    try { await deleteVnetPve(conn, pveName) } catch {}
    throw new Error(`Failed to persist VNet: ${err?.message}`)
  }

  // applySdn MUST run before the firewall options endpoint: fresh VNets are
  // in a "pending" state until applied, and PVE's firewall subsystem refuses
  // to attach options to a VNet it doesn't see yet (500 "invalid vnet").
  try { await applySdn(conn) } catch (err: any) {
    console.warn(`[vdc-vnets] applySdn failed after create: ${err?.message}`)
  }

  // Firewall default on a fresh VNet is "disabled" — only POST when the user
  // asked for it enabled. If this fails we roll back both DB and PVE so the
  // system state stays consistent.
  if (firewall) {
    try {
      await setVnetFirewallEnabled(conn, pveName, true)
    } catch (err: any) {
      await prisma.vdcVnet.delete({ where: { id } }).catch(() => undefined)
      try { await deleteVnetPve(conn, pveName) } catch {}
      try { await applySdn(conn) } catch {}
      throw err
    }
  }

  // Subnet lives only in our DB now — no PVE-side subnet (see sdn.ts comment
  // about why mirroring it had no functional value on VXLAN zones).
  const dnsList = (input.subnet.dnsServers ?? []).map(s => s.trim()).filter(Boolean)
  const subnetId = randomUUID()
  try {
    await prisma.vdcSubnet.create({
      data: {
        id: subnetId,
        vnetId: id,
        cidr: input.subnet.cidr,
        gateway: input.subnet.gateway,
        dnsServers: dnsList.length > 0 ? dnsList.join(',') : null,
        // External addressing = the tenant runs its own DHCP/IPAM on this
        // network; we keep the CIDR declarative and never hand out IPs.
        ipamEnabled: input.externalAddressing === true ? false : true,
        createdAt: now,
      },
    })
  } catch (err: any) {
    await prisma.vdcVnet.delete({ where: { id } }).catch(() => undefined)
    try { await deleteVnetPve(conn, pveName) } catch {}
    try { await applySdn(conn) } catch {}
    throw new Error(`Failed to persist subnet: ${err?.message}`)
  }

  const created = await prisma.vdcVnet.findUnique({
    where: { id },
    include: { subnet: true },
  })

  // Invalidate the tenant scope cache so the next network-choices /
  // VM-create flow sees the new VNet instead of stale 60s-cached data.
  clearVdcScopeCache(vdc.tenantId)

  return rowToVnet(created)
}

// ---------------------------------------------------------------------------
// updateVnetForTenant
// ---------------------------------------------------------------------------

export async function updateVnetForTenant(
  vdcId: string,
  tenantId: string,
  displayName: string,
  patch: {
    description?: string
    firewall?: boolean
    /** Subnet patch — only DNS is editable. CIDR/gateway changes would
     *  invalidate IPAM allocations and require a recreate. */
    subnet?: {
      dnsServers?: string[]
    }
  }
): Promise<VdcVnet> {
  const vdc = await resolveVdcForVnet(vdcId, tenantId)
  if (!vdc) throw new Error('vDC not found')

  const row = await findVnetByDisplayName(vdc.id, displayName)
  if (!row) throw new Error(`VNet "${displayName}" not found`)

  const pveName: string = row.pveName
  const conn = await getConn(vdc)

  if (patch.firewall !== undefined) {
    await setVnetFirewallEnabled(conn, pveName, patch.firewall)
  }

  // DNS edits are DB-only — CloudInit pushes them to VMs at create time.
  if (patch.subnet?.dnsServers !== undefined) {
    if (!row.subnet) {
      throw new Error(`VNet "${displayName}" has no subnet — DB migration required`)
    }
    const dnsCsv = patch.subnet.dnsServers.length > 0
      ? patch.subnet.dnsServers.map(s => s.trim()).filter(Boolean).join(',')
      : ''
    await prisma.vdcSubnet.update({
      where: { id: row.subnet.id },
      data: { dnsServers: dnsCsv || null },
    })
  }

  if (patch.firewall !== undefined) {
    try { await applySdn(conn) } catch (err: any) {
      console.warn(`[vdc-vnets] applySdn failed after update: ${err?.message}`)
    }
  }

  const updateData: Record<string, unknown> = {}
  if (patch.description !== undefined) updateData.description = patch.description
  if (patch.firewall !== undefined) updateData.firewall = patch.firewall
  if (Object.keys(updateData).length > 0) {
    await prisma.vdcVnet.update({ where: { id: row.id }, data: updateData })
  }

  const updated = await prisma.vdcVnet.findUnique({
    where: { id: row.id },
    include: { subnet: true },
  })
  return rowToVnet(updated)
}

// ---------------------------------------------------------------------------
// deleteVnetForTenant
// ---------------------------------------------------------------------------

export async function deleteVnetForTenant(
  vdcId: string,
  tenantId: string,
  displayName: string
): Promise<{ deleted: true } | { deleted: false; attachmentCount: number }> {
  const vdc = await resolveVdcForVnet(vdcId, tenantId)
  if (!vdc) throw new Error('vDC not found')

  const row = await findVnetByDisplayName(vdc.id, displayName)
  if (!row) throw new Error(`VNet "${displayName}" not found`)

  const pveName: string = row.pveName

  const conn = await getConn(vdc)
  const attachments = await countVnetAttachments(conn, pveName)
  if (attachments > 0) {
    return { deleted: false, attachmentCount: attachments }
  }

  // No PVE-side subnet to drop anymore — subnet only lives in our DB and
  // is removed by the FK CASCADE below.
  await deleteVnetPve(conn, pveName)

  // ON DELETE CASCADE on vdc_subnets.vnet_id removes the subnet row.
  await prisma.vdcVnet.delete({ where: { id: row.id } })

  try { await applySdn(conn) } catch (err: any) {
    console.warn(`[vdc-vnets] applySdn failed after delete: ${err?.message}`)
  }

  clearVdcScopeCache(vdc.tenantId)

  return { deleted: true }
}

// ---------------------------------------------------------------------------
// Network allow-list helpers (used by the guest route enforcement)
// ---------------------------------------------------------------------------

export interface AllowedNetwork {
  kind: 'vnet' | 'shared'
  /** Inclusive VLAN ranges the tenant may tag on a shared bridge (from vDC pools). */
  vlanRanges: Array<{ start: number; end: number }>
}

/**
 * Networks a tenant may reference in a netN config string on this connection,
 * with the VLAN ranges (vDC pools) it may tag on each shared bridge.
 * Returns null when no restriction applies (tenant without vDCs here).
 */
export async function getAllowedNetworksForTenant(
  tenantId: string,
  connectionId: string,
): Promise<Map<string, AllowedNetwork> | null> {
  const vdcRows = await prisma.vdc.findMany({
    where: { tenantId, connectionId, enabled: true },
    select: {
      vnets: { select: { pveName: true } },
      sharedBridges: { select: { bridge: true } },
      vlanPools: { select: { bridge: true, rangeStart: true, rangeEnd: true } },
    },
  })
  if (vdcRows.length === 0) return null

  const allowed = new Map<string, AllowedNetwork>()
  for (const vdc of vdcRows) {
    for (const v of vdc.vnets) allowed.set(v.pveName, { kind: 'vnet', vlanRanges: [] })
    for (const b of vdc.sharedBridges) {
      if (!allowed.has(b.bridge)) allowed.set(b.bridge, { kind: 'shared', vlanRanges: [] })
    }
    // A pool only widens a bridge the vDC already shares: it never opens one on
    // its own, otherwise a leftover pool row would hand out an unrelated bridge.
    for (const p of vdc.vlanPools) {
      const entry = allowed.get(p.bridge)
      if (entry?.kind === 'shared') entry.vlanRanges.push({ start: p.rangeStart, end: p.rangeEnd })
    }
  }
  return allowed
}

/** 802.1Q tops out at 4094, so no legitimate list is longer than that. */
const MAX_VLAN_IDS = 4094

/** PVE trunks syntax: ids or ranges separated by ';' (e.g. "10;20-25"). */
function parseVlanIdList(raw: string): number[] {
  const out: number[] = []
  for (const part of raw.split(/[;,]/)) {
    const m = part.trim().match(/^(\d+)(?:-(\d+))?$/)
    if (!m) return [Number.NaN]
    const a = Number(m[1]); const b = m[2] ? Number(m[2]) : a
    if (b < a) return [Number.NaN]
    for (let t = a; t <= b; t++) {
      // The string is tenant-supplied: "trunks=1-4294967295" must be denied,
      // not expanded. Past the 802.1Q ceiling the whole list is refused.
      if (out.length >= MAX_VLAN_IDS) return [Number.NaN]
      out.push(t)
    }
  }
  return out
}

/**
 * Validates one netN config string against the tenant's allowed networks.
 * Closes the pre-existing hole where only the bridge NAME was checked: a
 * tenant could append tag=137 (or trunks=) on a shared bridge and land on a
 * neighbour's VLAN. Rules: SDN vnets never take a tag (the vnet carries its
 * own); shared bridges only take tags/trunks inside the vDC's VLAN pools.
 */
export function validateNetAgainstScope(
  netStr: string,
  networks: Map<string, AllowedNetwork>,
): { ok: true } | { ok: false; error: string } {
  const bridge = parseBridgeFromNet(netStr)
  if (!bridge) return { ok: true }

  const entry = networks.get(bridge)
  if (!entry) {
    return {
      ok: false,
      error: `Bridge "${bridge}" is not authorized for this vDC. Allowed: ${Array.from(networks.keys()).join(', ')}`,
    }
  }

  // EVERY occurrence of both keys, case-insensitive and tolerant of padding.
  // Checking only the first tag= would let "tag=150,tag=250" ride in behind the
  // in-pool value and leave the foreign one to PVE's property-string parser:
  // a cross-tenant L2 control must not lean on that external invariant.
  const tags: number[] = []
  for (const m of String(netStr).matchAll(/(?:^|,)\s*tag=([^,]*)/gi)) {
    tags.push(...parseVlanIdList(m[1]))
  }
  for (const m of String(netStr).matchAll(/(?:^|,)\s*trunks=([^,]*)/gi)) {
    tags.push(...parseVlanIdList(m[1]))
  }
  if (tags.length === 0) return { ok: true }

  if (entry.kind === 'vnet') {
    return { ok: false, error: `VLAN tags are not allowed on SDN network "${bridge}" (the network carries its own tag)` }
  }
  for (const tag of tags) {
    const inRange = Number.isInteger(tag) && entry.vlanRanges.some(r => tag >= r.start && tag <= r.end)
    if (!inRange) {
      return { ok: false, error: `VLAN tag ${tag} on bridge "${bridge}" is outside your vDC's VLAN pools` }
    }
  }
  return { ok: true }
}

/** Parse bridge= from a PVE net config string */
export function parseBridgeFromNet(netStr: string): string | null {
  const m = String(netStr || '').match(/bridge=([^,]+)/)
  return m ? m[1] : null
}

// ---------------------------------------------------------------------------
// resolveSubnetForBridge — IPAM target lookup without tenant scoping
// ---------------------------------------------------------------------------

export interface SubnetForBridge {
  vdcId: string
  vnetId: string
  subnetId: string
  pveName: string
  cidr: string
  gateway: string
  dnsServers: string[]
  sdnZoneName: string
  /** PVE pool name backing the vDC. Used by the IPAM scanner to limit
   *  the search to the vDC's VMs instead of the whole cluster. */
  pvePoolName: string
}

/**
 * Find the (vDC, VNet, subnet) tuple that owns a given bridge on a given
 * PVE connection — *without* filtering by tenant. The deploy / VM-create
 * routes already enforce tenant access upstream (`resolveVdcForTenant`,
 * RBAC, vDC scope guards), so a second tenant filter here was the bug
 * that left the IPAM hook silent when a super-admin (default tenant)
 * deployed into a tenant-owned vDC.
 *
 * Returns null when:
 *   - no VNet on this connection matches the bridge name, OR
 *   - the matching VNet has no subnet (bridge-only mode)
 */
export async function resolveSubnetForBridge(
  connectionId: string,
  bridgePveName: string,
): Promise<SubnetForBridge | null> {
  const row = await prisma.vdcVnet.findFirst({
    where: {
      pveName: bridgePveName,
      vdc: { connectionId, enabled: true },
      subnet: { ipamEnabled: true },
    },
    include: {
      vdc: { select: { id: true, sdnZoneName: true, pvePoolName: true } },
      subnet: true,
    },
  })
  // A VLAN VNet carries its own (shared) zone; only a VXLAN VNet falls back
  // to the vDC zone. A vDC with neither is not deployable.
  if (!row || !row.subnet || !(row.zoneName ?? row.vdc.sdnZoneName)) return null
  return {
    vdcId: row.vdc.id,
    vnetId: row.id,
    subnetId: row.subnet.id,
    pveName: row.pveName,
    cidr: row.subnet.cidr,
    gateway: row.subnet.gateway,
    dnsServers: row.subnet.dnsServers
      ? row.subnet.dnsServers.split(',').map(s => s.trim()).filter(Boolean)
      : [],
    sdnZoneName: (row.zoneName ?? row.vdc.sdnZoneName)!,
    pvePoolName: row.vdc.pvePoolName,
  }
}
