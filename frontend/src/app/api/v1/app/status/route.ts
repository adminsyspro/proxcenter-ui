import { NextResponse } from "next/server"

import { getDb } from "@/lib/db/sqlite"
import { prisma } from "@/lib/db/prisma"

export const runtime = 'nodejs'

/**
 * GET /api/v1/app/status
 * Retourne l'état de l'application pour l'onboarding
 */
export async function GET() {
  try {
    const db = getDb()

    // Vérifier le nombre d'utilisateurs
    const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number }

    // Vérifier le nombre de connexions Proxmox
    const connectionCount = await prisma.connection.count()

    return NextResponse.json({
      setupRequired: userCount.count === 0,
      connectionsConfigured: connectionCount > 0,
      userCount: userCount.count,
      connectionCount,
    })
  } catch (error) {
    console.error("Error checking app status:", error)

    return NextResponse.json({
      setupRequired: true,
      connectionsConfigured: false,
      userCount: 0,
      connectionCount: 0,
    })
  }
}
