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
 * The job's own value when the operator set one, else the target connection's,
 * else unlimited (the historical behaviour). A read failure falls back to
 * unlimited rather than failing the migration.
 */
export async function resolveWarmZeroRateLimit(
  configValue: number | undefined | null,
  targetConnectionId: string,
  db: ConnectionReader = globalPrisma as unknown as ConnectionReader,
): Promise<number> {
  if (typeof configValue === "number" && Number.isFinite(configValue) && configValue >= 0) return Math.floor(configValue)
  try {
    const conn = await db.connection.findUnique({ where: { id: targetConnectionId }, select: { warmZeroRateLimitMBps: true } })
    const v = conn?.warmZeroRateLimitMBps
    return typeof v === "number" && v > 0 ? v : ZERO_RATE_UNLIMITED
  } catch {
    return ZERO_RATE_UNLIMITED
  }
}
