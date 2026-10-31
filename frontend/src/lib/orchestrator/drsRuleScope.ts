// src/lib/orchestrator/drsRuleScope.ts
//
// Tenancy of the DRS affinity rules. The orchestrator stores them fleet-wide
// and only applies a rule to the cluster named by its connection_id (a rule
// without one applies to none), so the frontend routes are where a tenant is
// kept to its own clusters: a rule is created on, moved to, and acted on
// through a connection the caller's tenant OWNS. A vDC binding is not enough:
// it lends a slice of a provider cluster, and a rule names guests and nodes of
// the whole cluster, other tenants' included.

import { getCurrentTenantId, getSessionPrisma, getTenantConnectionIds, requireProviderTenant } from "@/lib/tenant"
import { DEFAULT_TENANT_ID } from "@/lib/tenant/constants"

/** The connections whose DRS rules and recommendations the caller may see and act on. */
export async function drsConnectionIds(): Promise<Set<string>> {
  // The provider runs DRS for the whole fleet.
  if ((await getCurrentTenantId()) === DEFAULT_TENANT_ID) return getTenantConnectionIds()
  const prisma = await getSessionPrisma()
  const owned = await prisma.connection.findMany({ select: { id: true } })
  return new Set(owned.map((c: { id: string }) => c.id))
}

/** True when `connectionId` names a connection whose rules the caller manages. */
export async function isTenantRuleConnection(connectionId: unknown): Promise<boolean> {
  if (typeof connectionId !== "string" || !connectionId) return false
  return (await drsConnectionIds()).has(connectionId)
}

/**
 * Whether the caller may act on rule `id`. A rule of another tenant's cluster
 * reads as missing. A rule with no connection, which only an older version
 * could create, is left to the provider tenant to clean up.
 */
export async function mayActOnDrsRule(client: { getRules: () => Promise<{ data: unknown }> }, id: string): Promise<boolean> {
  const rulesRes = await client.getRules()
  const rules = Array.isArray(rulesRes.data) ? rulesRes.data : []
  const rule = rules.find((r: any) => r?.id === id)
  if (!rule) return true // unknown id: the orchestrator answers its own 404
  if (rule.connection_id) return isTenantRuleConnection(rule.connection_id)
  return !(await requireProviderTenant())
}
