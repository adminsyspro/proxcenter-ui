// Server side of the sync interval of a warm hold: the value a waiting job
// sleeps between two delta passes. Its default is a setting of the SOURCE
// connection, whose platform pays for each pass (a snapshot and its
// consolidation); a value chosen in the migration dialog, persisted in the job
// config, wins over it.

import { prisma as globalPrisma } from "@/lib/db/prisma"

import { SYNC_INTERVAL_DEFAULT_SEC, parseSyncInterval } from "./sync-interval"

type ConnectionReader = {
  connection: { findUnique: (args: any) => Promise<{ migrationSyncIntervalSec: number | null } | null> }
}

/** The setting of a source connection, one minute when it has none. Throws when the read fails. */
export async function connectionSyncIntervalSec(
  sourceConnectionId: string,
  db: ConnectionReader = globalPrisma as unknown as ConnectionReader,
): Promise<number> {
  const conn = await db.connection.findUnique({ where: { id: sourceConnectionId }, select: { migrationSyncIntervalSec: true } })
  return parseSyncInterval(conn?.migrationSyncIntervalSec) || SYNC_INTERVAL_DEFAULT_SEC
}

/**
 * The interval a waiting warm job sleeps before its next delta pass. Resolved
 * again during each sleep, so a change of the connection's setting reaches
 * the migrations already waiting. A value outside the bounds is ignored on either
 * side, and a read failure keeps the job's own value, or one minute, rather
 * than failing a migration that only waits.
 */
export async function resolveSyncIntervalSec(
  configValue: number | undefined | null,
  sourceConnectionId: string,
  db: ConnectionReader = globalPrisma as unknown as ConnectionReader,
): Promise<number> {
  const own = parseSyncInterval(configValue)
  if (typeof own === "number") return own
  try {
    return await connectionSyncIntervalSec(sourceConnectionId, db)
  } catch {
    return SYNC_INTERVAL_DEFAULT_SEC
  }
}
