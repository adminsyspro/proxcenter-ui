import { NextResponse } from "next/server"

import { orchestratorHeaders } from "@/lib/orchestrator/headers"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:8080"

const COMMUNITY_FALLBACK = {
  enterprise: false,
  edition: "community",
  licensed: false,
  features: [] as string[],
}

export type ServerLicense = {
  enterprise: boolean
  edition: string
  licensed: boolean
  features: string[]
}

/**
 * Fetch license status from the orchestrator.
 * Fail-closed: any error, non-2xx response, or unreachable orchestrator
 * returns the community fallback (enterprise: false).
 * This matches the silent-community-default in the license/status proxy route.
 */
export async function getServerLicense(): Promise<ServerLicense> {
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/license/status`, {
      headers: orchestratorHeaders(),
      cache: "no-store",
    })

    if (!res.ok) {
      return { ...COMMUNITY_FALLBACK }
    }

    const data: { licensed?: boolean; expired?: boolean; edition?: string; features?: string[] } =
      await res.json()

    return {
      enterprise: data.licensed === true && (data.edition === "enterprise" || data.edition === "enterprise_plus"),
      edition: data.edition ?? "community",
      licensed: data.licensed ?? false,
      features: data.features ?? [],
    }
  } catch {
    return { ...COMMUNITY_FALLBACK }
  }
}

/**
 * Indirection object so vi.spyOn can intercept getServerLicense in tests.
 * requireEnterprise calls through this object instead of a direct closure ref.
 * @internal
 */
export const _impl = { getServerLicense }

/**
 * Server-side Enterprise license guard for API routes.
 * Returns a 403 NextResponse when the current installation is not Enterprise,
 * or null when access is permitted.
 *
 * Usage in a route handler:
 *   const guard = await requireEnterprise()
 *   if (guard) return guard
 */
export async function requireEnterprise(): Promise<NextResponse | null> {
  const lic = await _impl.getServerLicense()
  if (!lic.enterprise) {
    return NextResponse.json({ error: "Enterprise feature" }, { status: 403 })
  }
  return null
}
