// src/lib/templates/catalogGrants.ts
//
// Who may see, and therefore deploy, a provider catalogue entry (#903).
//
// An entry (custom image or blueprint) owned by the provider tenant is
// visible to another tenant when any of these holds:
//   - it is flagged `isShared` (the historical "everyone" shortcut),
//   - a grant names that tenant,
//   - a grant names one of the tenant's vDCs that is in play: the vDC the
//     deployment targets, the vDC of the view context, or any enabled vDC of
//     the tenant when the view is the union.
// A tenant's own rows are always visible to it. The provider sees only its
// own rows, which is already everything it owns.
//
// Every read goes through the global prisma client on purpose: the grantee
// column of a grant is not the owner of the row, so the tenant-scoped
// extension (which filters on `tenantId`) must never be applied to it, and a
// granted entry is owned by the provider by design.

import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/db/prisma'
import { DEFAULT_TENANT_ID } from '@/lib/tenant'
import { getVdcContext } from '@/lib/vdc/context'

export interface GrantSummary {
  tenantIds: string[]
  vdcIds: string[]
}

export interface VdcCatalogGrants {
  imageIds: string[]
  blueprintIds: string[]
}

export interface VisibilityOpts {
  /**
   * The vDC a verdict is about. A string pins the grants to that vDC (the
   * deploy target); null asks for the tenant's union; undefined follows the
   * view context cookie, then the union.
   */
  vdcId?: string | null
}

export const CATALOG_NOT_GRANTED_IMAGE = 'This image is not available to your vDC'
export const CATALOG_NOT_GRANTED_BLUEPRINT = 'This blueprint is not available to your vDC'

/** The vDC ids whose grants count for `tenantId`, see VisibilityOpts. */
export async function granteeVdcIds(tenantId: string, opts?: VisibilityOpts): Promise<string[]> {
  if (tenantId === DEFAULT_TENANT_ID) return []
  if (typeof opts?.vdcId === 'string' && opts.vdcId) return [opts.vdcId]
  if (opts?.vdcId === undefined) {
    const context = await getVdcContext(tenantId)
    if (context) return [context]
  }
  const rows = await prisma.vdc.findMany({ where: { tenantId, enabled: true }, select: { id: true } })
  return rows.map(row => row.id)
}

function grantClause(tenantId: string, vdcIds: string[]): Prisma.CatalogGrantWhereInput {
  const or: Prisma.CatalogGrantWhereInput[] = [{ granteeTenantId: tenantId }]
  if (vdcIds.length > 0) or.push({ vdcId: { in: vdcIds } })
  return { OR: or }
}

/** `where` matching every custom image `tenantId` may see. */
export function customImageVisibilityWhere(tenantId: string, vdcIds: string[] = []): Prisma.CustomImageWhereInput {
  if (tenantId === DEFAULT_TENANT_ID) return { tenantId }
  return {
    OR: [
      { tenantId },
      { tenantId: DEFAULT_TENANT_ID, isShared: true },
      { tenantId: DEFAULT_TENANT_ID, grants: { some: grantClause(tenantId, vdcIds) } },
    ],
  }
}

/** `where` matching every blueprint `tenantId` may see. */
export function blueprintVisibilityWhere(tenantId: string, vdcIds: string[] = []): Prisma.BlueprintWhereInput {
  if (tenantId === DEFAULT_TENANT_ID) return { tenantId }
  return {
    OR: [
      { tenantId },
      { tenantId: DEFAULT_TENANT_ID, isShared: true },
      { tenantId: DEFAULT_TENANT_ID, grants: { some: grantClause(tenantId, vdcIds) } },
    ],
  }
}

/** Blueprints visible to the caller, newest first. */
export async function listVisibleBlueprints(tenantId: string, opts?: VisibilityOpts) {
  const vdcIds = await granteeVdcIds(tenantId, opts)
  return prisma.blueprint.findMany({
    where: blueprintVisibilityWhere(tenantId, vdcIds),
    orderBy: { createdAt: 'desc' },
  })
}

/** One blueprint by id, null when it is outside the caller's scope. */
export async function findBlueprintForTenant(tenantId: string, id: string, opts?: VisibilityOpts) {
  const vdcIds = await granteeVdcIds(tenantId, opts)
  return prisma.blueprint.findFirst({ where: { AND: [{ id }, blueprintVisibilityWhere(tenantId, vdcIds)] } })
}

/** True when the provider owns a blueprint with this id (hidden, not unknown). */
export async function isProviderBlueprint(id: string): Promise<boolean> {
  const row = await prisma.blueprint.findFirst({ where: { id, tenantId: DEFAULT_TENANT_ID }, select: { id: true } })
  return !!row
}

type EntryKind = 'image' | 'blueprint'

function entryKey(kind: EntryKind, entryId: string): Prisma.CatalogGrantWhereInput {
  return kind === 'image' ? { imageId: entryId } : { blueprintId: entryId }
}

/** Grants of several entries at once, keyed by entry id (every id gets a summary). */
export async function loadGrantSummaries(kind: EntryKind, ids: string[]): Promise<Map<string, GrantSummary>> {
  const out = new Map<string, GrantSummary>(ids.map(id => [id, { tenantIds: [], vdcIds: [] }]))
  if (ids.length === 0) return out
  const rows = await prisma.catalogGrant.findMany({
    where: kind === 'image' ? { imageId: { in: ids } } : { blueprintId: { in: ids } },
    select: { imageId: true, blueprintId: true, granteeTenantId: true, vdcId: true },
  })
  for (const row of rows) {
    const id = kind === 'image' ? row.imageId : row.blueprintId
    const summary = id ? out.get(id) : undefined
    if (!summary) continue
    if (row.granteeTenantId) summary.tenantIds.push(row.granteeTenantId)
    if (row.vdcId) summary.vdcIds.push(row.vdcId)
  }
  return out
}

/** Grants of a single entry. */
export async function loadGrantSummary(kind: EntryKind, id: string): Promise<GrantSummary> {
  return (await loadGrantSummaries(kind, [id])).get(id) ?? { tenantIds: [], vdcIds: [] }
}

/** Accepts arrays of non-empty strings only; anything else is ignored. */
export function normalizeIdList(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined
  return [...new Set(input.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map(x => x.trim()))]
}

/**
 * Replace the per-tenant grants of a provider entry. Only the provider may
 * grant, only on its own rows, and only to other tenants that exist: a
 * grant to the provider itself or to an unknown tenant is refused rather
 * than silently dropped, so the UI never shows a tick that did nothing.
 */
export async function replaceTenantGrants(
  kind: EntryKind,
  entryId: string,
  tenantIds: string[],
  createdBy: string | null,
): Promise<void> {
  const wanted = [...new Set(tenantIds)].filter(id => id !== DEFAULT_TENANT_ID)
  if (wanted.length > 0) {
    const known = await prisma.tenant.findMany({ where: { id: { in: wanted } }, select: { id: true } })
    const knownIds = new Set(known.map(t => t.id))
    const missing = wanted.filter(id => !knownIds.has(id))
    if (missing.length > 0) throw new Error(`Unknown tenant: ${missing.join(', ')}`)
  }
  await prisma.$transaction([
    prisma.catalogGrant.deleteMany({ where: { AND: [entryKey(kind, entryId), { granteeTenantId: { not: null } }] } }),
    ...(wanted.length > 0
      ? [prisma.catalogGrant.createMany({
          data: wanted.map(granteeTenantId => ({
            ...(kind === 'image' ? { imageId: entryId } : { blueprintId: entryId }),
            granteeTenantId,
            createdBy,
          })),
        })]
      : []),
  ])
}

/** The catalogue entries granted to one vDC. */
export async function vdcCatalogGrants(vdcId: string): Promise<VdcCatalogGrants> {
  const rows = await prisma.catalogGrant.findMany({ where: { vdcId }, select: { imageId: true, blueprintId: true } })
  return {
    imageIds: rows.map(r => r.imageId).filter((x): x is string => !!x),
    blueprintIds: rows.map(r => r.blueprintId).filter((x): x is string => !!x),
  }
}

/**
 * Replace the grants of one vDC. A list left undefined keeps the current
 * grants of that kind. Entries must be provider-owned: a tenant's private
 * image can never be pushed to another tenant's vDC through here.
 */
export async function replaceVdcCatalogGrants(
  vdcId: string,
  input: Partial<VdcCatalogGrants>,
  createdBy: string | null,
): Promise<void> {
  const current = (!input.imageIds || !input.blueprintIds) ? await vdcCatalogGrants(vdcId) : null
  const imageIds = [...new Set(input.imageIds ?? current?.imageIds ?? [])]
  const blueprintIds = [...new Set(input.blueprintIds ?? current?.blueprintIds ?? [])]
  if (imageIds.length > 0) {
    const rows = await prisma.customImage.findMany({ where: { id: { in: imageIds }, tenantId: DEFAULT_TENANT_ID }, select: { id: true } })
    const ok = new Set(rows.map(r => r.id))
    const bad = imageIds.filter(id => !ok.has(id))
    if (bad.length > 0) throw new Error(`Only provider images can be granted to a vDC (unknown or not provider-owned: ${bad.join(', ')})`)
  }
  if (blueprintIds.length > 0) {
    const rows = await prisma.blueprint.findMany({ where: { id: { in: blueprintIds }, tenantId: DEFAULT_TENANT_ID }, select: { id: true } })
    const ok = new Set(rows.map(r => r.id))
    const bad = blueprintIds.filter(id => !ok.has(id))
    if (bad.length > 0) throw new Error(`Only provider blueprints can be granted to a vDC (unknown or not provider-owned: ${bad.join(', ')})`)
  }
  await prisma.$transaction([
    prisma.catalogGrant.deleteMany({ where: { vdcId } }),
    ...(imageIds.length + blueprintIds.length > 0
      ? [prisma.catalogGrant.createMany({
          data: [
            ...imageIds.map(imageId => ({ imageId, vdcId, createdBy })),
            ...blueprintIds.map(blueprintId => ({ blueprintId, vdcId, createdBy })),
          ],
        })]
      : []),
  ])
}
