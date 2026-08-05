// src/lib/tenant/vmidRange.ts
// Optional per-tenant VMID range (MSP tenants only). New guests created
// through ProxCenter must take a VMID inside the range; pre-existing guests
// are never checked (relaxed enforcement).

import { prisma } from "@/lib/db/prisma"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"

import { DEFAULT_TENANT_ID } from "./constants"

export const VMID_MIN = 100
export const VMID_MAX = 999_999_999

export interface VmidRange {
  start: number
  end: number
}

export interface ParsedVmidRange {
  ok: boolean
  /** Set only when ok: undefined = fields absent (leave unchanged), null = clear, object = new range. */
  range?: VmidRange | null
  /** Set only when !ok. */
  error?: string
}

/**
 * Parse vmidRangeStart/vmidRangeEnd from a request body.
 *  - both absent          → { range: undefined }  (leave unchanged)
 *  - both null            → { range: null }        (clear the range)
 *  - both valid integers  → { range: { start, end } }
 *  - anything else        → error
 */
export function parseVmidRangeInput(body: { vmidRangeStart?: unknown; vmidRangeEnd?: unknown }): ParsedVmidRange {
  const { vmidRangeStart: start, vmidRangeEnd: end } = body

  if (start === undefined && end === undefined) return { ok: true, range: undefined }
  if (start === null && end === null) return { ok: true, range: null }
  if (typeof start !== "number" || !Number.isInteger(start) || typeof end !== "number" || !Number.isInteger(end)) {
    return { ok: false, error: "vmidRangeStart and vmidRangeEnd must both be integers, or both be null" }
  }
  if (start < VMID_MIN || end > VMID_MAX) {
    return { ok: false, error: `VMID range must be within ${VMID_MIN}-${VMID_MAX}` }
  }
  if (start > end) {
    return { ok: false, error: "vmidRangeStart must be less than or equal to vmidRangeEnd" }
  }
  return { ok: true, range: { start, end } }
}

/** The tenant's VMID range, or null when no enforcement applies. */
export async function resolveTenantVmidRange(tenantId: string): Promise<VmidRange | null> {
  if (tenantId === DEFAULT_TENANT_ID) return null

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { operatingModel: true, vmidRangeStart: true, vmidRangeEnd: true },
  })

  if (tenant?.operatingModel !== "msp") return null
  if (tenant.vmidRangeStart == null || tenant.vmidRangeEnd == null) return null
  return { start: tenant.vmidRangeStart, end: tenant.vmidRangeEnd }
}

export interface TenantVmidUsage {
  used: Set<number>
  /** Tenant connections that could not be scanned. Callers MUST fail closed
   *  when non-empty: PVE only rejects intra-cluster duplicates, so a skipped
   *  cluster could silently break the tenant's cross-cluster uniqueness. */
  unreachable: string[]
}

/**
 * VMIDs currently in use across ALL of the tenant's PVE connections
 * (cross-cluster).
 */
export async function getUsedVmidsForTenant(tenantId: string): Promise<TenantVmidUsage> {
  const conns = await prisma.connection.findMany({
    where: { tenantId, type: "pve" },
    select: { id: true, name: true, tenantId: true },
  })

  const used = new Set<number>()
  const unreachable: string[] = []
  const results = await Promise.allSettled(
    conns.map(async (c) => {
      const conn = await getConnectionById(c.id, c.tenantId)
      return pveFetch<Array<{ vmid: number | string }>>(conn, "/cluster/resources?type=vm")
    }),
  )
  results.forEach((r, i) => {
    if (r.status !== "fulfilled") {
      unreachable.push(conns[i].name)
      return
    }
    for (const g of r.value || []) {
      const n = Number(g.vmid)
      if (Number.isInteger(n)) used.add(n)
    }
  })
  return { used, unreachable }
}

/** Lowest free VMID in the range, or null when the range is exhausted. */
export function findNextFreeVmid(range: VmidRange, used: Set<number>): number | null {
  for (let vmid = range.start; vmid <= range.end; vmid++) {
    if (!used.has(vmid)) return vmid
  }
  return null
}

/** First other tenant whose range intersects [start, end], or null. */
export async function findVmidRangeConflict(
  start: number,
  end: number,
  excludeTenantId?: string,
): Promise<{ id: string; name: string } | null> {
  return prisma.tenant.findFirst({
    where: {
      vmidRangeStart: { lte: end },
      vmidRangeEnd: { gte: start },
      ...(excludeTenantId ? { id: { not: excludeTenantId } } : {}),
    },
    select: { id: true, name: true },
  })
}

export interface VmidRangeCheck {
  ok: boolean
  /** Set only when !ok. */
  status?: 400 | 409 | 503
  /** Set only when !ok. */
  error?: string
}

/**
 * Enforcement check shared by the create, clone and template-deploy routes:
 * ok when no range applies; 400 outside the tenant range; 409 already in use
 * anywhere in the tenant's infrastructure; 503 when uniqueness cannot be
 * verified because a tenant cluster is unreachable (fail closed).
 */
export async function checkVmidAgainstTenantRange(
  tenantId: string,
  vmid: number,
): Promise<VmidRangeCheck> {
  const range = await resolveTenantVmidRange(tenantId)
  if (!range) return { ok: true }

  if (!Number.isInteger(vmid) || vmid < range.start || vmid > range.end) {
    return { ok: false, status: 400, error: `VMID must be within your tenant range ${range.start}-${range.end}` }
  }
  const { used, unreachable } = await getUsedVmidsForTenant(tenantId)
  if (unreachable.length > 0) {
    return {
      ok: false,
      status: 503,
      error: `Cannot verify VMID uniqueness across your clusters: connection(s) unreachable: ${unreachable.join(", ")}`,
    }
  }
  if (used.has(vmid)) {
    return { ok: false, status: 409, error: `VMID ${vmid} is already in use in your infrastructure` }
  }
  return { ok: true }
}

const RECENT_VMID_TTL_MS = 60_000

function recentVmidMap(): Map<string, Map<number, number>> {
  const g = globalThis as Record<string, any>
  g.__proxcenter_recent_vmids__ ??= new Map()
  return g.__proxcenter_recent_vmids__
}

/** Remember a vmid suggested to this tenant so the next suggestion skips it. */
export function noteRecentVmidAllocation(tenantId: string, vmid: number): void {
  const perTenant = recentVmidMap()
  const entry = perTenant.get(tenantId) ?? new Map<number, number>()
  entry.set(vmid, Date.now() + RECENT_VMID_TTL_MS)
  perTenant.set(tenantId, entry)
}

/** Union of `used` and the tenant's non-expired recent suggestions. */
export function withRecentVmidAllocations(tenantId: string, used: Set<number>): Set<number> {
  const entry = recentVmidMap().get(tenantId)
  if (!entry) return used
  const now = Date.now()
  const merged = new Set(used)
  for (const [vmid, expiresAt] of entry) {
    if (expiresAt <= now) entry.delete(vmid)
    else merged.add(vmid)
  }
  return merged
}
