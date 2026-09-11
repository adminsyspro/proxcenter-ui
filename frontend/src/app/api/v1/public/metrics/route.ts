import { NextResponse } from "next/server"

import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"
import { loadPublicView, loadBackupFreshnessForView } from "@/lib/api-tokens/publicRoutePrologue"
import { isFamilyAllowed, renderExposition, type MetricFamily } from "@/lib/metrics/prometheus"
import { buildBackupFamilies } from "@/lib/metrics/families/backup"
import { buildClusterFamilies } from "@/lib/metrics/families/cluster"
import { buildGuestFamilies } from "@/lib/metrics/families/guest"
import { buildMetaFamilies } from "@/lib/metrics/families/meta"
import { buildNodeFamilies } from "@/lib/metrics/families/node"
import { buildPbsFamilies } from "@/lib/metrics/families/pbs"
import { buildStorageFamilies } from "@/lib/metrics/families/storage"
import { PERMISSIONS } from "@/lib/rbac"
import type { Principal } from "@/lib/auth/principal"

export const runtime = "nodejs"

/**
 * Assembly only (#925). Every sample is built by a PURE per-domain module
 * under lib/metrics/families/, which takes the fleet view and returns
 * families whose HELP text comes from the single registry. Five near
 * identical builders inline here is what the Sonar duplication gate flags,
 * and it is also what let the 3 August exposition drift away from the
 * dashboard shipped beside it.
 */
async function handler(_req: Request, ctx: { principal?: Principal }) {
  const principal = ctx?.principal
  const result = await loadPublicView(principal, PERMISSIONS.NODE_VIEW)
  if (!result.ok) return result.response
  const view = result.view

  // Session (or anonymous) callers see every family, gated only by the
  // NODE_VIEW check above: family filtering is a TOKEN scope concept, per
  // spec section 8.
  const scopes = principal?.kind === "token" ? principal.scopes ?? [] : []
  const allowed = (name: string) => principal?.kind !== "token" || isFamilyAllowed(name, scopes)

  const families: MetricFamily[] = [
    ...buildMetaFamilies(),
    ...buildClusterFamilies(view),
    ...buildNodeFamilies(view),
    ...buildGuestFamilies(view),
    ...buildPbsFamilies(view),
    ...buildStorageFamilies(view),
  ]

  // The backup aggregation walks every visible PBS connection, so it is the
  // expensive part of this handler and stays BEHIND the family check: a
  // token without backups:read must not pay for an aggregation whose output
  // it is not allowed to see. Every other family is cheap enough to build
  // and then drop in the filter below.
  if (allowed("proxcenter_backup_age_seconds")) {
    const freshness = await loadBackupFreshnessForView(view)
    families.push(...buildBackupFamilies(view, freshness))
  }

  return new NextResponse(renderExposition(families.filter(family => allowed(family.name))), {
    status: 200,
    headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8" },
  })
}

export const GET = withPublicApiGuard("public-metrics", handler)
