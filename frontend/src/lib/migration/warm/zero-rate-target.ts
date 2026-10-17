// Server side of the thick zeroing cap (roadmap#45): the value a warm job runs
// with. The cap protects the array behind the TARGET storage, so its default
// is a setting of the target PVE connection; a value typed in the migration
// dialog, persisted in the job config, wins over it.

import { prisma as globalPrisma } from "@/lib/db/prisma"

import { ZERO_RATE_UNLIMITED } from "./zero-rate"

type ConnectionReader = {
  connection: { findUnique: (args: any) => Promise<{ warmZeroRateLimitMBps: number | null } | null> }
}

/**
 * The cap a warm job runs with. The target connection's cap is a policy set by
 * whoever manages that cluster (Enterprise, connection.manage); a migration may
 * only TIGHTEN it: a lower value applies, a higher one or "unlimited" is held
 * to the cluster's cap. Without a cluster cap, the job's value applies as is.
 * Resolved here, at run time, so a retry replaying an old job config obeys the
 * cap the cluster has now. A read failure keeps the job's own value, or
 * unlimited, rather than failing the migration.
 */
export async function resolveWarmZeroRateLimit(
  configValue: number | undefined | null,
  targetConnectionId: string,
  db: ConnectionReader = globalPrisma as unknown as ConnectionReader,
): Promise<number> {
  const own = typeof configValue === "number" && Number.isFinite(configValue) && configValue >= 0 ? Math.floor(configValue) : undefined
  let cluster = ZERO_RATE_UNLIMITED
  try {
    const conn = await db.connection.findUnique({ where: { id: targetConnectionId }, select: { warmZeroRateLimitMBps: true } })
    const v = conn?.warmZeroRateLimitMBps
    if (typeof v === "number" && v > 0) cluster = v
  } catch {
    return own ?? ZERO_RATE_UNLIMITED
  }
  return tightenZeroRateLimit(cluster, own)
}

/** The cluster's cap, lowered by the job's value when that is stricter (0 = unlimited on both sides). */
export function tightenZeroRateLimit(clusterCap: number, own: number | undefined): number {
  if (own === undefined) return clusterCap
  if (clusterCap <= 0) return own
  return own > 0 ? Math.min(own, clusterCap) : clusterCap
}
