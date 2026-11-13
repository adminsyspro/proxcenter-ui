// src/lib/vdc/evpnZones.ts
// Provider EVPN zone shared between clusters (#1334).
//
// One zone, one PVE zone id, carried by every member cluster. ProxCenter
// creates the zone or adopts the one Proxmox already runs, and binds it to
// the EVPN controller of each cluster: an existing one, or a simple one it
// creates (one AS, one peer list). It never rewrites a controller it did not
// create and never deletes one: the BGP design stays the provider's.
//
// Every business message starts with "EVPN zone:" (see mapEvpnZoneError).

import { randomUUID } from 'crypto'

import { getConnectionById } from '@/lib/connections/getConnection'
import { prisma } from '@/lib/db/prisma'
import { pveFetch } from '@/lib/proxmox/client'

import { attachedVdcCount } from './evpnVdc'
import { applySdn, deleteZone } from './sdn'
import { normalizePeerList, VNI_MAX } from './transport'
import { takenVnisOnTransport } from './vniPolicy'

const ERR = 'EVPN zone:'

export const EVPN_ZONE_ID_REGEX = /^[a-z][a-z0-9]{1,7}$/
export const EVPN_CONTROLLER_ID_REGEX = /^[a-z][a-z0-9_-]{0,62}[a-z0-9]$/
const NAME_MAX = 40
const ASN_MAX = 4294967295
const MTU_MIN = 1280
const MTU_MAX = 65520

export type EvpnControllerChoice =
  | { mode: 'existing'; name: string }
  | { mode: 'create'; name: string; asn: number; peers: string[] }

export interface EvpnZoneMemberInput {
  connectionId: string
  controller: EvpnControllerChoice
}

export interface CreateEvpnZoneInput {
  name: string
  description?: string | null
  zoneName: string
  vrfVxlan: number
  mtu?: number | null
  vniStart: number
  vniEnd: number
  members: EvpnZoneMemberInput[]
}

export interface EvpnZoneMember {
  id: string
  connectionId: string
  connectionName: string
  controller: string
  controllerCreated: boolean
  adopted: boolean
}

export interface EvpnZone {
  id: string
  name: string
  description: string | null
  zoneName: string
  vrfVxlan: number
  mtu: number | null
  vniStart: number
  vniEnd: number
  createdAt: string
  members: EvpnZoneMember[]
  /** vDCs attached to the zone and networks their tenants created in it. */
  vdcCount: number
  networkCount: number
}

export interface PveEvpnController {
  controller: string
  asn: number | null
  peers: string[]
}

export interface PveEvpnZone {
  zone: string
  controller: string | null
  vrfVxlan: number | null
  mtu: number | null
  /** `new` / `changed` / `deleted` while a staged change awaits the SDN apply. */
  state: string | null
}

// ---------------------------------------------------------------------------
// Input normalisation
// ---------------------------------------------------------------------------

function intIn(raw: unknown, label: string, min: number, max: number): number {
  const n = Number(raw)
  if (raw === null || raw === undefined || String(raw).trim() === '' || !Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${ERR} ${label} must be an integer between ${min} and ${max}.`)
  }
  return n
}

function normalizeName(raw: unknown): string {
  const name = String(raw ?? '').trim()
  if (!name || name.length > NAME_MAX) throw new Error(`${ERR} the name is required, ${NAME_MAX} characters at most.`)
  return name
}

function normalizeZoneId(raw: unknown): string {
  const id = String(raw ?? '').trim()
  if (!EVPN_ZONE_ID_REGEX.test(id)) {
    throw new Error(`${ERR} the Proxmox zone id must be 2 to 8 lowercase letters or digits and start with a letter.`)
  }
  return id
}

function normalizeMtu(raw: unknown): number | null {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null
  return intIn(raw, 'MTU', MTU_MIN, MTU_MAX)
}

function normalizeController(raw: any): EvpnControllerChoice {
  const name = String(raw?.name ?? '').trim()
  if (!EVPN_CONTROLLER_ID_REGEX.test(name)) {
    throw new Error(`${ERR} a controller id must be lowercase letters, digits, "-" or "_", and start with a letter.`)
  }
  if (raw?.mode === 'existing') return { mode: 'existing', name }
  if (raw?.mode !== 'create') throw new Error(`${ERR} each cluster needs an EVPN controller, existing or to create.`)
  const asn = intIn(raw.asn, 'the AS number', 1, ASN_MAX)
  let peers: string[]
  try {
    peers = normalizePeerList(raw.peers)
  } catch (e: any) {
    throw new Error(`${ERR} ${String(e?.message || e).replace(/^VXLAN transport:?\s*/, '')}`)
  }
  if (peers.length === 0) throw new Error(`${ERR} a new controller needs at least one peer address.`)
  return { mode: 'create', name, asn, peers }
}

function normalizeMembers(raw: unknown): EvpnZoneMemberInput[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error(`${ERR} select at least one cluster.`)
  const seen = new Set<string>()
  return raw.map((m: any) => {
    const connectionId = String(m?.connectionId ?? '').trim()
    if (!connectionId) throw new Error(`${ERR} a cluster is missing its id.`)
    if (seen.has(connectionId)) throw new Error(`${ERR} a cluster is listed twice.`)
    seen.add(connectionId)
    return { connectionId, controller: normalizeController(m?.controller) }
  })
}

function normalizeRange(start: unknown, end: unknown): { vniStart: number; vniEnd: number } {
  const vniStart = intIn(start, 'the first VNI of the range', 1, VNI_MAX)
  const vniEnd = intIn(end, 'the last VNI of the range', 1, VNI_MAX)
  if (vniStart > vniEnd) throw new Error(`${ERR} the VNI range starts at ${vniStart}, above its end ${vniEnd}.`)
  return { vniStart, vniEnd }
}

// ---------------------------------------------------------------------------
// PVE reads and writes
// ---------------------------------------------------------------------------

async function connectionFor(connectionId: string): Promise<{ conn: any; name: string }> {
  const meta = await prisma.connection.findUnique({
    where: { id: connectionId },
    select: { tenantId: true, name: true, type: true },
  })
  if (!meta || meta.type !== 'pve') throw new Error(`${ERR} cluster not found.`)
  return { conn: await getConnectionById(connectionId, meta.tenantId), name: meta.name }
}

function splitPeers(raw: unknown): string[] {
  return String(raw ?? '').split(/[\s,;]+/).map(p => p.trim()).filter(Boolean)
}

function numOrNull(raw: unknown): number | null {
  return raw === undefined || raw === null || raw === '' ? null : Number(raw)
}

export async function listEvpnControllersPve(conn: any): Promise<PveEvpnController[]> {
  const rows = await pveFetch<any[]>(conn, '/cluster/sdn/controllers')
  return (rows || [])
    .filter((c: any) => c?.type === 'evpn')
    .map((c: any) => ({ controller: String(c.controller), asn: numOrNull(c.asn), peers: splitPeers(c.peers) }))
}

export async function listEvpnZonesPve(conn: any): Promise<PveEvpnZone[]> {
  const rows = await pveFetch<any[]>(conn, '/cluster/sdn/zones?pending=1')
  return (rows || [])
    .filter((z: any) => z?.type === 'evpn')
    .map((z: any) => ({
      zone: String(z.zone),
      controller: z.controller ? String(z.controller) : null,
      vrfVxlan: numOrNull(z['vrf-vxlan']),
      mtu: numOrNull(z.mtu),
      state: z.state ? String(z.state) : null,
    }))
}

/** Every zone id of the cluster, whatever its type. */
async function listZoneIdsPve(conn: any): Promise<Map<string, string>> {
  const rows = await pveFetch<any[]>(conn, '/cluster/sdn/zones')
  return new Map((rows || []).map((z: any) => [String(z.zone), String(z.type ?? '')]))
}

async function createControllerPve(conn: any, c: Extract<EvpnControllerChoice, { mode: 'create' }>): Promise<void> {
  const body = new URLSearchParams()
  body.append('type', 'evpn')
  body.append('controller', c.name)
  body.append('asn', String(c.asn))
  body.append('peers', c.peers.join(','))
  try {
    await pveFetch(conn, '/cluster/sdn/controllers', { method: 'POST', body })
  } catch (err: any) {
    throw new Error(`Failed to create SDN controller "${c.name}": ${err?.message}`)
  }
}

async function deleteControllerPve(conn: any, name: string): Promise<void> {
  await pveFetch(conn, `/cluster/sdn/controllers/${encodeURIComponent(name)}`, { method: 'DELETE' })
}

async function createEvpnZonePve(conn: any, z: { zoneName: string; controller: string; vrfVxlan: number; mtu: number | null }): Promise<void> {
  const body = new URLSearchParams()
  body.append('type', 'evpn')
  body.append('zone', z.zoneName)
  body.append('controller', z.controller)
  body.append('vrf-vxlan', String(z.vrfVxlan))
  if (z.mtu) body.append('mtu', String(z.mtu))
  try {
    await pveFetch(conn, '/cluster/sdn/zones', { method: 'POST', body })
  } catch (err: any) {
    throw new Error(`Failed to create SDN zone "${z.zoneName}": ${err?.message}`)
  }
}

/**
 * Nodes of the cluster without the `frr` packages an EVPN zone needs. Proxmox
 * cannot install them through its API, so the provider is told. One GET per
 * node; a node that cannot be read is left out (best effort).
 */
export async function nodesWithoutFrr(conn: any): Promise<string[]> {
  const nodes = await pveFetch<any[]>(conn, '/nodes').catch(() => [])
  const missing = await Promise.all((nodes || []).map(async (n: any) => {
    try {
      const pkgs = await pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(n.node)}/apt/versions`)
      const frr = (pkgs || []).find((p: any) => p?.Package === 'frr-pythontools' || p?.Package === 'frr')
      if (!frr) return null
      return frr.CurrentState === 'Installed' ? null : String(n.node)
    } catch {
      return null
    }
  }))
  return missing.filter((n): n is string => n !== null)
}

// ---------------------------------------------------------------------------
// Discovery, for the declaration form
// ---------------------------------------------------------------------------

export interface EvpnDiscovery {
  connectionId: string
  connectionName: string
  reachable: boolean
  controllers: PveEvpnController[]
  /** EVPN zones Proxmox already runs, candidates for adoption. */
  zones: PveEvpnZone[]
  /** Node addresses, the default peers of a new controller. */
  nodeIps: string[]
  nodesWithoutFrr: string[]
}

/** What each cluster already holds. Three GETs per cluster plus one per node, on demand only. */
export async function discoverEvpn(connectionIds: string[]): Promise<EvpnDiscovery[]> {
  const rows = await prisma.connection.findMany({
    where: { type: 'pve', id: { in: connectionIds } },
    select: { id: true, name: true, tenantId: true },
    orderBy: { name: 'asc' },
  })
  return Promise.all(rows.map(async row => {
    const base = { connectionId: row.id, connectionName: row.name }
    try {
      const conn = await getConnectionById(row.id, row.tenantId)
      const [controllers, zones, status, withoutFrr] = await Promise.all([
        listEvpnControllersPve(conn),
        listEvpnZonesPve(conn),
        pveFetch<any[]>(conn, '/cluster/status').catch(() => []),
        nodesWithoutFrr(conn),
      ])
      const nodeIps = (status || []).filter((e: any) => e.type === 'node' && e.ip).map((e: any) => String(e.ip))
      return { ...base, reachable: true, controllers, zones, nodeIps, nodesWithoutFrr: withoutFrr }
    } catch {
      return { ...base, reachable: false, controllers: [], zones: [], nodeIps: [], nodesWithoutFrr: [] }
    }
  }))
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

const ZONE_INCLUDE = {
  members: { include: { connection: { select: { name: true } } }, orderBy: { createdAt: 'asc' as const } },
  _count: { select: { vdcs: true, tenantNetworks: true } },
}

function toIso(d: unknown): string {
  return d instanceof Date ? d.toISOString() : String(d ?? '')
}

function rowToZone(row: any): EvpnZone {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    zoneName: row.zoneName,
    vrfVxlan: row.vrfVxlan,
    mtu: row.mtu ?? null,
    vniStart: row.vniStart,
    vniEnd: row.vniEnd,
    createdAt: toIso(row.createdAt),
    members: (row.members || []).map((m: any) => ({
      id: m.id,
      connectionId: m.connectionId,
      connectionName: m.connection?.name ?? m.connectionId,
      controller: m.controller,
      controllerCreated: !!m.controllerCreated,
      adopted: !!m.adopted,
    })),
    vdcCount: row._count?.vdcs ?? 0,
    networkCount: row._count?.tenantNetworks ?? 0,
  }
}

export async function listEvpnZones(): Promise<EvpnZone[]> {
  const rows = await prisma.sdnEvpnZone.findMany({ include: ZONE_INCLUDE, orderBy: { name: 'asc' } })
  return rows.map(rowToZone)
}

async function loadZone(id: string): Promise<any> {
  const row = await prisma.sdnEvpnZone.findUnique({ where: { id }, include: ZONE_INCLUDE })
  if (!row) throw new Error(`${ERR} not found.`)
  return row
}

export async function getEvpnZone(id: string): Promise<EvpnZone> {
  return rowToZone(await loadZone(id))
}

// ---------------------------------------------------------------------------
// VNI space checks
// ---------------------------------------------------------------------------

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start <= b.end && b.start <= a.end
}

/**
 * The range and the VRF VNI of a zone against everything already reserved:
 * the other EVPN zones, the VNI range of every vDC and every VNI a VNet
 * carries on any cluster. The VNets of the zone itself (adoption) are
 * allowed inside its own range.
 */
async function assertVniSpaceFree(z: { zoneName: string; vrfVxlan: number; vniStart: number; vniEnd: number }, exceptZoneId?: string): Promise<void> {
  const range = { start: z.vniStart, end: z.vniEnd }
  if (z.vrfVxlan >= range.start && z.vrfVxlan <= range.end) {
    throw new Error(`${ERR} the VRF VNI ${z.vrfVxlan} must stay outside the VNI range of the zone.`)
  }

  const zones = await prisma.sdnEvpnZone.findMany({
    where: exceptZoneId ? { id: { not: exceptZoneId } } : undefined,
    select: { name: true, vrfVxlan: true, vniStart: true, vniEnd: true },
  })
  for (const other of zones) {
    const otherRange = { start: other.vniStart, end: other.vniEnd }
    if (overlaps(range, otherRange)) {
      throw new Error(`${ERR} the VNI range overlaps the range ${other.vniStart}-${other.vniEnd} of EVPN zone "${other.name}".`)
    }
    if (other.vrfVxlan === z.vrfVxlan || (z.vrfVxlan >= other.vniStart && z.vrfVxlan <= other.vniEnd)) {
      throw new Error(`${ERR} the VRF VNI ${z.vrfVxlan} is already reserved by EVPN zone "${other.name}".`)
    }
    if (other.vrfVxlan >= range.start && other.vrfVxlan <= range.end) {
      throw new Error(`${ERR} the VNI range contains the VRF VNI ${other.vrfVxlan} of EVPN zone "${other.name}".`)
    }
  }

  const vdcs = await prisma.vdc.findMany({
    where: { vniRangeStart: { not: null }, vniRangeEnd: { not: null } },
    select: { name: true, vniRangeStart: true, vniRangeEnd: true },
  })
  for (const vdc of vdcs) {
    const vdcRange = { start: vdc.vniRangeStart!, end: vdc.vniRangeEnd! }
    if (overlaps(range, vdcRange)) {
      throw new Error(`${ERR} the VNI range overlaps the range ${vdcRange.start}-${vdcRange.end} of vDC "${vdc.name}".`)
    }
    if (z.vrfVxlan >= vdcRange.start && z.vrfVxlan <= vdcRange.end) {
      throw new Error(`${ERR} the VRF VNI ${z.vrfVxlan} is inside the range ${vdcRange.start}-${vdcRange.end} of vDC "${vdc.name}".`)
    }
  }

  // The networks tenants already hold in this zone are its own: they may
  // sit in its range, and a new range must still contain every one of them.
  const own = exceptZoneId
    ? await prisma.tenantNetwork.findMany({ where: { evpnZoneId: exceptZoneId }, select: { vni: true, name: true } })
    : []
  const outside = own.find(n => n.vni < range.start || n.vni > range.end)
  if (outside) {
    throw new Error(`${ERR} the VNI range must still hold VNI ${outside.vni} of network "${outside.name}", already created in the zone.`)
  }
  const ownVnis = new Set(own.map(n => n.vni))

  const taken = await takenVnisOnTransport('')
  for (const [vni, holder] of taken) {
    if (ownVnis.has(vni)) continue
    if (holder.zone === z.zoneName && holder.zoneType === 'evpn') continue
    if (vni === z.vrfVxlan) throw new Error(`${ERR} the VRF VNI ${vni} is already used by ${holder.label}.`)
    if (vni >= range.start && vni <= range.end) {
      throw new Error(`${ERR} VNI ${vni} of the range is already used by ${holder.label}. Choose a free range.`)
    }
  }
}

// ---------------------------------------------------------------------------
// Member plan: what a cluster needs
// ---------------------------------------------------------------------------

interface MemberPlan {
  connectionId: string
  connectionName: string
  conn: any
  controller: EvpnControllerChoice
  /** The zone already runs on the cluster with the same settings. */
  adopt: boolean
}

async function planMember(
  zone: { zoneName: string; vrfVxlan: number; mtu: number | null },
  member: EvpnZoneMemberInput,
): Promise<MemberPlan> {
  const { conn, name } = await connectionFor(member.connectionId)
  let controllers: PveEvpnController[]
  let evpnZones: PveEvpnZone[]
  let zoneIds: Map<string, string>
  try {
    [controllers, evpnZones, zoneIds] = await Promise.all([
      listEvpnControllersPve(conn), listEvpnZonesPve(conn), listZoneIdsPve(conn),
    ])
  } catch (err: any) {
    throw new Error(`${ERR} cluster "${name}" cannot be read: ${err?.message}`)
  }

  const known = controllers.find(c => c.controller === member.controller.name)
  if (member.controller.mode === 'existing' && !known) {
    throw new Error(`${ERR} cluster "${name}" has no EVPN controller "${member.controller.name}".`)
  }
  if (member.controller.mode === 'create' && known) {
    throw new Error(`${ERR} cluster "${name}" already has a controller "${member.controller.name}": select it instead of creating it.`)
  }

  const live = evpnZones.find(z => z.zone === zone.zoneName)
  if (!live) {
    const type = zoneIds.get(zone.zoneName)
    if (type) throw new Error(`${ERR} cluster "${name}" already has a ${type} zone "${zone.zoneName}".`)
    const withoutFrr = await nodesWithoutFrr(conn)
    if (withoutFrr.length > 0) {
      throw new Error(`${ERR} the frr packages are missing on ${withoutFrr.join(', ')} of cluster "${name}": install frr and frr-pythontools on these nodes first.`)
    }
    return { connectionId: member.connectionId, connectionName: name, conn, controller: member.controller, adopt: false }
  }

  if (live.vrfVxlan !== zone.vrfVxlan) {
    throw new Error(`${ERR} zone "${zone.zoneName}" of cluster "${name}" uses VRF VNI ${live.vrfVxlan}, not ${zone.vrfVxlan}.`)
  }
  if (live.controller !== member.controller.name) {
    throw new Error(`${ERR} zone "${zone.zoneName}" of cluster "${name}" is bound to controller "${live.controller}".`)
  }
  if ((live.mtu ?? null) !== (zone.mtu ?? null)) {
    throw new Error(`${ERR} zone "${zone.zoneName}" of cluster "${name}" has MTU ${live.mtu ?? 'default'}, not ${zone.mtu ?? 'default'}.`)
  }
  return { connectionId: member.connectionId, connectionName: name, conn, controller: member.controller, adopt: true }
}

/** Stages controller and zone on one cluster. Returns what to undo. */
async function stageMember(plan: MemberPlan, zone: { zoneName: string; vrfVxlan: number; mtu: number | null }): Promise<() => Promise<void>> {
  let controllerCreated = false
  if (plan.controller.mode === 'create') {
    await createControllerPve(plan.conn, plan.controller)
    controllerCreated = true
  }
  let zoneCreated = false
  try {
    if (!plan.adopt) {
      await createEvpnZonePve(plan.conn, { ...zone, controller: plan.controller.name })
      zoneCreated = true
    }
  } catch (err) {
    if (controllerCreated) await deleteControllerPve(plan.conn, plan.controller.name).catch(() => {})
    throw err
  }
  return async () => {
    if (zoneCreated) await deleteZone(plan.conn, zone.zoneName).catch(() => {})
    if (controllerCreated) await deleteControllerPve(plan.conn, plan.controller.name).catch(() => {})
  }
}

export interface EvpnZoneWriteResult {
  zone: EvpnZone
  /** Clusters whose SDN apply failed: the change is staged, not running. */
  applyErrors: Array<{ connectionName: string; error: string }>
}

/** A cluster where the zone was adopted on an existing controller got no write: nothing to apply. */
async function applyOn(plans: MemberPlan[]): Promise<EvpnZoneWriteResult['applyErrors']> {
  const staged = plans.filter(p => !p.adopt || p.controller.mode === 'create')
  const results = await Promise.all(staged.map(async p => {
    try {
      await applySdn(p.conn)
      return null
    } catch (err: any) {
      return { connectionName: p.connectionName, error: String(err?.message || err) }
    }
  }))
  return results.filter((r): r is { connectionName: string; error: string } => r !== null)
}

function memberRow(zoneId: string, plan: MemberPlan) {
  return {
    id: randomUUID(),
    zoneId,
    connectionId: plan.connectionId,
    controller: plan.controller.name,
    controllerCreated: plan.controller.mode === 'create',
    adopted: plan.adopt,
  }
}

// ---------------------------------------------------------------------------
// Create, extend, shrink, delete
// ---------------------------------------------------------------------------

/**
 * Declares a zone on its clusters. Everything is checked on every cluster
 * before the first write; a staging failure undoes what was staged, so
 * nothing is applied unless every cluster accepted. Per cluster: three reads,
 * at most two writes and one SDN apply (a network reload on each node).
 */
export async function createEvpnZone(input: CreateEvpnZoneInput, createdBy: string | null): Promise<EvpnZoneWriteResult> {
  const name = normalizeName(input.name)
  const zoneName = normalizeZoneId(input.zoneName)
  const vrfVxlan = intIn(input.vrfVxlan, 'the VRF VNI', 1, VNI_MAX)
  const mtu = normalizeMtu(input.mtu)
  const { vniStart, vniEnd } = normalizeRange(input.vniStart, input.vniEnd)
  const members = normalizeMembers(input.members)
  const description = input.description ? String(input.description).trim() || null : null

  const clash = await prisma.sdnEvpnZone.findFirst({
    where: { OR: [{ name }, { zoneName }] },
    select: { name: true, zoneName: true },
  })
  if (clash) {
    throw new Error(clash.name === name
      ? `${ERR} a zone named "${name}" already exists.`
      : `${ERR} the Proxmox zone id "${zoneName}" is already declared by zone "${clash.name}".`)
  }
  await assertVniSpaceFree({ zoneName, vrfVxlan, vniStart, vniEnd })

  const zone = { zoneName, vrfVxlan, mtu }
  const plans = await Promise.all(members.map(m => planMember(zone, m)))

  const undo: Array<() => Promise<void>> = []
  try {
    for (const plan of plans) undo.push(await stageMember(plan, zone))
  } catch (err) {
    for (const revert of undo.reverse()) await revert()
    throw err
  }

  const id = randomUUID()
  const now = new Date()
  try {
    await prisma.sdnEvpnZone.create({
      data: {
        id, name, description, zoneName, vrfVxlan, mtu, vniStart, vniEnd, createdBy, createdAt: now, updatedAt: now,
        members: { create: plans.map(p => { const { zoneId: _z, ...row } = memberRow(id, p); return row }) },
      },
    })
  } catch (err) {
    for (const revert of undo.reverse()) await revert()
    throw err
  }

  const applyErrors = await applyOn(plans)
  return { zone: await getEvpnZone(id), applyErrors }
}

export async function addEvpnZoneMember(id: string, memberInput: unknown): Promise<EvpnZoneWriteResult> {
  const row = await loadZone(id)
  const [member] = normalizeMembers([memberInput])
  if (row.members.some((m: any) => m.connectionId === member.connectionId)) {
    throw new Error(`${ERR} this cluster already carries the zone.`)
  }
  const zone = { zoneName: row.zoneName, vrfVxlan: row.vrfVxlan, mtu: row.mtu ?? null }
  const plan = await planMember(zone, member)
  const revert = await stageMember(plan, zone)
  try {
    await prisma.sdnEvpnZoneMember.create({ data: memberRow(id, plan) })
  } catch (err) {
    await revert()
    throw err
  }
  const applyErrors = await applyOn([plan])
  return { zone: await getEvpnZone(id), applyErrors }
}

/** VNets the zone holds on a cluster, as Proxmox lists them. */
async function zoneVnetCount(conn: any, zoneName: string): Promise<number> {
  const vnets = await pveFetch<any[]>(conn, '/cluster/sdn/vnets')
  return (vnets || []).filter((v: any) => String(v.zone) === zoneName).length
}

/**
 * Detaches a cluster. A zone ProxCenter created is deleted there, once it
 * holds no VNet; an adopted zone is left as it was found. The controller is
 * never deleted, even one ProxCenter created: other zones may use it.
 */
export async function removeEvpnZoneMember(id: string, connectionId: string): Promise<EvpnZoneWriteResult> {
  const row = await loadZone(id)
  const member = row.members.find((m: any) => m.connectionId === connectionId)
  if (!member) throw new Error(`${ERR} this cluster does not carry the zone.`)
  const attached = await attachedVdcCount(id, connectionId)
  if (attached > 0) {
    throw new Error(`${ERR} ${attached} vDC(s) of this cluster are still attached to "${row.name}". Detach them first.`)
  }

  const applyErrors: EvpnZoneWriteResult['applyErrors'] = []
  if (!member.adopted) {
    const { conn, name } = await connectionFor(connectionId)
    const vnets = await zoneVnetCount(conn, row.zoneName)
    if (vnets > 0) {
      throw new Error(`${ERR} zone "${row.zoneName}" still holds ${vnets} VNet(s) on cluster "${name}".`)
    }
    await deleteZone(conn, row.zoneName)
    try {
      await applySdn(conn)
    } catch (err: any) {
      applyErrors.push({ connectionName: name, error: String(err?.message || err) })
    }
  }
  await prisma.sdnEvpnZoneMember.delete({ where: { id: member.id } })
  return { zone: await getEvpnZone(id), applyErrors }
}

export async function deleteEvpnZone(id: string): Promise<EvpnZoneWriteResult['applyErrors']> {
  const row = await loadZone(id)
  const attached = await attachedVdcCount(id)
  if (attached > 0) throw new Error(`${ERR} ${attached} vDC(s) are still attached to "${row.name}". Detach them first.`)
  const applyErrors: EvpnZoneWriteResult['applyErrors'] = []
  for (const member of row.members) {
    const result = await removeEvpnZoneMember(id, member.connectionId)
    applyErrors.push(...result.applyErrors)
  }
  await prisma.sdnEvpnZone.delete({ where: { id } })
  return applyErrors
}

export interface UpdateEvpnZoneInput {
  name?: string
  description?: string | null
  vniStart?: number
  vniEnd?: number
}

/** Name, description and VNI range. The zone id, VRF VNI and MTU are what Proxmox runs: fixed. */
export async function updateEvpnZone(id: string, input: UpdateEvpnZoneInput): Promise<EvpnZone> {
  const row = await loadZone(id)
  const data: Record<string, unknown> = { updatedAt: new Date() }
  if (input.name !== undefined) {
    const name = normalizeName(input.name)
    const clash = await prisma.sdnEvpnZone.findFirst({ where: { name, id: { not: id } }, select: { id: true } })
    if (clash) throw new Error(`${ERR} a zone named "${name}" already exists.`)
    data.name = name
  }
  if (input.description !== undefined) data.description = input.description ? String(input.description).trim() || null : null
  if (input.vniStart !== undefined || input.vniEnd !== undefined) {
    const { vniStart, vniEnd } = normalizeRange(input.vniStart ?? row.vniStart, input.vniEnd ?? row.vniEnd)
    // The VNI scan reads every connection: only a range that moves needs it.
    // An unchanged range, sent back whole by an infrastructure-as-code client
    // on every update (issue #1360), was checked when it was set.
    if (vniStart !== row.vniStart || vniEnd !== row.vniEnd) {
      await assertVniSpaceFree({ zoneName: row.zoneName, vrfVxlan: row.vrfVxlan, vniStart, vniEnd }, id)
      data.vniStart = vniStart
      data.vniEnd = vniEnd
    }
  }
  await prisma.sdnEvpnZone.update({ where: { id }, data })
  return getEvpnZone(id)
}

// ---------------------------------------------------------------------------
// Status and resync
// ---------------------------------------------------------------------------

export type EvpnMemberState = 'ok' | 'pending' | 'missing' | 'drift' | 'controller-missing' | 'unreachable'

export interface EvpnMemberStatus {
  connectionId: string
  connectionName: string
  state: EvpnMemberState
  /** What differs from the declaration, for `drift`. */
  detail: string | null
  vnetCount: number
}

async function memberStatus(row: any, member: any): Promise<EvpnMemberStatus> {
  const base = { connectionId: member.connectionId, connectionName: member.connection?.name ?? member.connectionId, vnetCount: 0 }
  try {
    const { conn } = await connectionFor(member.connectionId)
    const [controllers, zones, vnetCount] = await Promise.all([
      listEvpnControllersPve(conn), listEvpnZonesPve(conn), zoneVnetCount(conn, row.zoneName),
    ])
    const live = zones.find(z => z.zone === row.zoneName)
    if (!live || live.state === 'deleted') return { ...base, vnetCount, state: 'missing', detail: null }
    if (!controllers.some(c => c.controller === member.controller)) {
      return { ...base, vnetCount, state: 'controller-missing', detail: member.controller }
    }
    const diffs: string[] = []
    if (live.vrfVxlan !== row.vrfVxlan) diffs.push(`VRF VNI ${live.vrfVxlan}`)
    if (live.controller !== member.controller) diffs.push(`controller ${live.controller}`)
    if ((live.mtu ?? null) !== (row.mtu ?? null)) diffs.push(`MTU ${live.mtu ?? 'default'}`)
    if (diffs.length > 0) return { ...base, vnetCount, state: 'drift', detail: diffs.join(', ') }
    return { ...base, vnetCount, state: live.state ? 'pending' : 'ok', detail: null }
  } catch {
    return { ...base, state: 'unreachable', detail: null }
  }
}

/** The zone as each member cluster runs it. Three GETs per cluster, on demand. */
export async function getEvpnZoneStatus(id: string): Promise<EvpnMemberStatus[]> {
  const row = await loadZone(id)
  return Promise.all(row.members.map((m: any) => memberStatus(row, m)))
}

/**
 * Puts a member back in line: recreates a zone that is gone, and applies a
 * staged change. A zone that drifted is not rewritten: the provider changed
 * it in Proxmox on purpose or by mistake, and decides.
 */
export async function resyncEvpnZoneMember(id: string, connectionId: string): Promise<EvpnMemberStatus> {
  const row = await loadZone(id)
  const member = row.members.find((m: any) => m.connectionId === connectionId)
  if (!member) throw new Error(`${ERR} this cluster does not carry the zone.`)
  const before = await memberStatus(row, member)
  if (before.state === 'unreachable') throw new Error(`${ERR} cluster "${before.connectionName}" cannot be reached.`)
  if (before.state === 'drift') {
    throw new Error(`${ERR} zone "${row.zoneName}" differs on cluster "${before.connectionName}" (${before.detail}): fix it in Proxmox.`)
  }
  if (before.state === 'controller-missing') {
    throw new Error(`${ERR} controller "${member.controller}" no longer exists on cluster "${before.connectionName}".`)
  }
  const { conn } = await connectionFor(connectionId)
  if (before.state === 'missing') {
    await createEvpnZonePve(conn, { zoneName: row.zoneName, controller: member.controller, vrfVxlan: row.vrfVxlan, mtu: row.mtu ?? null })
  }
  if (before.state !== 'ok') await applySdn(conn)
  return memberStatus(row, member)
}
