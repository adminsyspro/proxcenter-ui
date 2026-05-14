// Datacenter catalogue — provider-managed list of physical sites with
// their own PUE / electricity / CO₂ characteristics.
//
// All access is currently provider-only. The `tenant_id` column is kept on
// the row for forward-compat (per-tenant catalogues someday) and queries
// default to 'default'.

import { randomUUID } from 'crypto'

import { prisma } from './prisma'
import { getSetting } from './settings'
import { DEFAULT_TENANT_ID } from '@/lib/tenant'

export interface DatacenterRow {
  id: string
  tenantId: string
  name: string
  locationLabel: string | null
  country: string | null
  latitude: number | null
  longitude: number | null
  pue: number
  electricityPrice: number
  currency: string
  co2Factor: number
  co2CountryPreset: string | null
  tdpPerCoreW: number
  wattsPerGbRam: number
  overheadPerNodeW: number
  comment: string | null
  isDefault: boolean
  createdAt: string
  updatedAt: string

  /** Populated by listDatacenters() — counts of clusters/nodes anchored here. */
  clusterCount?: number
  nodeCount?: number
}

export interface DatacenterInput {
  name: string
  locationLabel?: string | null
  country?: string | null
  latitude?: number | null
  longitude?: number | null
  pue: number
  electricityPrice: number
  currency: string
  co2Factor: number
  co2CountryPreset?: string | null
  tdpPerCoreW?: number
  wattsPerGbRam?: number
  overheadPerNodeW?: number
  comment?: string | null
  isDefault?: boolean
}

function rowToDatacenter(r: any, counts?: { clusterCount?: number; nodeCount?: number }): DatacenterRow {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    locationLabel: r.locationLabel ?? null,
    country: r.country ?? null,
    latitude: r.latitude ?? null,
    longitude: r.longitude ?? null,
    pue: Number(r.pue),
    electricityPrice: Number(r.electricityPrice),
    currency: r.currency,
    co2Factor: Number(r.co2Factor),
    co2CountryPreset: r.co2CountryPreset ?? null,
    tdpPerCoreW: Number(r.tdpPerCoreW ?? 10),
    wattsPerGbRam: Number(r.wattsPerGbRam ?? 0.375),
    overheadPerNodeW: Number(r.overheadPerNodeW ?? 50),
    comment: r.comment ?? null,
    isDefault: !!r.isDefault,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
    clusterCount: counts?.clusterCount,
    nodeCount: counts?.nodeCount,
  }
}

export async function listDatacenters(tenantId: string = DEFAULT_TENANT_ID): Promise<DatacenterRow[]> {
  // Counts are pulled with _count include so each row carries its
  // own clusterCount/nodeCount. The UI shows them as a small "Resources"
  // badge so orphan DCs are visible at a glance.
  const rows = await prisma.datacenter.findMany({
    where: { tenantId },
    include: {
      _count: { select: { connectionGreen: true, nodeGreen: true } },
    },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  })


return rows.map(r => rowToDatacenter(r, {
    clusterCount: r._count.connectionGreen,
    nodeCount: r._count.nodeGreen,
  }))
}

export async function getDatacenterById(id: string): Promise<DatacenterRow | null> {
  const r = await prisma.datacenter.findUnique({ where: { id } })


return r ? rowToDatacenter(r) : null
}

export async function getDefaultDatacenter(tenantId: string = DEFAULT_TENANT_ID): Promise<DatacenterRow | null> {
  const r = await prisma.datacenter.findFirst({
    where: { tenantId, isDefault: true },
  })


return r ? rowToDatacenter(r) : null
}

export async function insertDatacenter(input: DatacenterInput, tenantId: string = DEFAULT_TENANT_ID): Promise<DatacenterRow> {
  const id = randomUUID()
  const now = new Date()

  await prisma.$transaction(async tx => {
    if (input.isDefault) {
      // Demote any existing default for this tenant.
      await tx.datacenter.updateMany({
        where: { tenantId, isDefault: true },
        data: { isDefault: false },
      })
    }

    await tx.datacenter.create({
      data: {
        id,
        tenantId,
        name: input.name,
        locationLabel: input.locationLabel ?? null,
        country: input.country ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        pue: input.pue,
        electricityPrice: input.electricityPrice,
        currency: input.currency,
        co2Factor: input.co2Factor,
        co2CountryPreset: input.co2CountryPreset ?? null,
        tdpPerCoreW: input.tdpPerCoreW ?? 10,
        wattsPerGbRam: input.wattsPerGbRam ?? 0.375,
        overheadPerNodeW: input.overheadPerNodeW ?? 50,
        comment: input.comment ?? null,
        isDefault: !!input.isDefault,
        createdAt: now,
        updatedAt: now,
      },
    })
  })

return (await getDatacenterById(id))!
}

export async function updateDatacenter(id: string, input: Partial<DatacenterInput>): Promise<DatacenterRow> {
  const existing = await getDatacenterById(id)

  if (!existing) throw new Error(`Datacenter not found: ${id}`)

  await prisma.$transaction(async tx => {
    if (input.isDefault === true && !existing.isDefault) {
      await tx.datacenter.updateMany({
        where: { tenantId: existing.tenantId, isDefault: true },
        data: { isDefault: false },
      })
    }

    if (input.isDefault === false && existing.isDefault) {
      // Refuse to demote the only default — keep at least one.
      const others = await tx.datacenter.count({
        where: { tenantId: existing.tenantId, isDefault: true, NOT: { id } },
      })

      if (others === 0) {
        throw new Error('Cannot demote the only default datacenter; promote another first.')
      }
    }

    const data: Record<string, unknown> = { updatedAt: new Date() }

    if (input.name !== undefined) data.name = input.name
    if (input.locationLabel !== undefined) data.locationLabel = input.locationLabel ?? null
    if (input.country !== undefined) data.country = input.country ?? null
    if (input.latitude !== undefined) data.latitude = input.latitude ?? null
    if (input.longitude !== undefined) data.longitude = input.longitude ?? null
    if (input.pue !== undefined) data.pue = input.pue
    if (input.electricityPrice !== undefined) data.electricityPrice = input.electricityPrice
    if (input.currency !== undefined) data.currency = input.currency
    if (input.co2Factor !== undefined) data.co2Factor = input.co2Factor
    if (input.co2CountryPreset !== undefined) data.co2CountryPreset = input.co2CountryPreset ?? null
    if (input.tdpPerCoreW !== undefined) data.tdpPerCoreW = input.tdpPerCoreW
    if (input.wattsPerGbRam !== undefined) data.wattsPerGbRam = input.wattsPerGbRam
    if (input.overheadPerNodeW !== undefined) data.overheadPerNodeW = input.overheadPerNodeW
    if (input.comment !== undefined) data.comment = input.comment ?? null
    if (input.isDefault !== undefined) data.isDefault = !!input.isDefault

    await tx.datacenter.update({ where: { id }, data })
  })

return (await getDatacenterById(id))!
}

export async function deleteDatacenter(id: string): Promise<void> {
  const existing = await getDatacenterById(id)

  if (!existing) return

  // Don't delete a row still referenced by cluster/node configs — caller should
  // reassign first. We block at the DB layer with a clear error rather than
  // letting ON DELETE SET NULL silently break the resolution chain.
  const [clusterRefs, nodeRefs] = await Promise.all([
    prisma.connectionGreenConfig.count({ where: { datacenterId: id } }),
    prisma.nodeGreenConfig.count({ where: { datacenterId: id } }),
  ])

  const refs = clusterRefs + nodeRefs

  if (refs > 0) {
    throw new Error(`Datacenter is referenced by ${refs} cluster/node config(s); reassign them first.`)
  }

  if (existing.isDefault) {
    const others = await prisma.datacenter.count({
      where: { tenantId: existing.tenantId, NOT: { id } },
    })

    if (others > 0) {
      throw new Error('Cannot delete the default datacenter while others exist; promote another first.')
    }
  }

  await prisma.datacenter.delete({ where: { id } })
}

/**
 * Ensures at least one datacenter exists for the provider. Called lazily
 * from green-IT endpoints. If none exists and a legacy `settings.green` row
 * is present, seed the new "Default" DC from those values; otherwise create
 * one with safe defaults.
 */
export async function ensureDefaultDatacenter(tenantId: string = DEFAULT_TENANT_ID): Promise<DatacenterRow> {
  const existing = await getDefaultDatacenter(tenantId)

  if (existing) return existing

  let pue = 1.4
  let electricityPrice = 0.18
  let currency = 'EUR'
  let co2Factor = 0.052
  let co2CountryPreset: string | null = null
  let tdpPerCoreW = 10
  let wattsPerGbRam = 0.375
  let overheadPerNodeW = 50

  try {
    // Backfill from the legacy `settings.green` row if it still holds usable
    // values (some installs configured green-IT before the dedicated
    // `datacenters` table existed). Best-effort: if the row is missing or
    // unparseable we just fall through to the safe defaults above.
    const parsed = await getSetting<any>('green', tenantId)

    if (parsed) {
      if (typeof parsed.pue === 'number') pue = parsed.pue
      if (typeof parsed.electricityPrice === 'number') electricityPrice = parsed.electricityPrice
      if (typeof parsed.currency === 'string') currency = parsed.currency
      if (typeof parsed.co2Factor === 'number') co2Factor = parsed.co2Factor
      if (typeof parsed.co2Country === 'string') co2CountryPreset = parsed.co2Country
      const specs = parsed.serverSpecs ?? {}

      if (typeof specs.tdpPerCore === 'number') tdpPerCoreW = specs.tdpPerCore
      if (typeof specs.wattsPerGbRam === 'number') wattsPerGbRam = specs.wattsPerGbRam
      if (typeof specs.overheadPerServer === 'number') overheadPerNodeW = specs.overheadPerServer
    }
  } catch {
    // No legacy row — fall through to defaults.
  }

  return insertDatacenter({
    name: 'Default',
    pue,
    electricityPrice,
    currency,
    co2Factor,
    co2CountryPreset,
    tdpPerCoreW,
    wattsPerGbRam,
    overheadPerNodeW,
    isDefault: true,
  }, tenantId)
}
