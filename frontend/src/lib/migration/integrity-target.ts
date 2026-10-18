// Server side of the post-copy integrity check (roadmap#1): the settings a
// migration runs with are those of its TARGET PVE connection (Settings >
// Connections > Migrations tab), like the thick zeroing cap of roadmap#45.

import { prisma as globalPrisma } from "@/lib/db/prisma"

import { integritySettingsFromConnection, type IntegritySettings } from "./integrity-settings"

type ConnectionReader = {
  connection: { findUnique: (args: any) => Promise<{ integrityCheckEnabled: boolean | null; integrityRegionCount: number | null; integrityRegionSizeMiB: number | null } | null> }
}

/**
 * The integrity settings of the target cluster; a value the connection does
 * not set takes its default. A read failure keeps the check ON with the
 * defaults: a copy is never handed over unverified because a lookup failed.
 */
export async function resolveIntegritySettings(
  targetConnectionId: string,
  db: ConnectionReader = globalPrisma as unknown as ConnectionReader,
): Promise<IntegritySettings> {
  try {
    const conn = await db.connection.findUnique({
      where: { id: targetConnectionId },
      select: { integrityCheckEnabled: true, integrityRegionCount: true, integrityRegionSizeMiB: true },
    })
    return integritySettingsFromConnection(conn)
  } catch {
    return integritySettingsFromConnection(null)
  }
}
