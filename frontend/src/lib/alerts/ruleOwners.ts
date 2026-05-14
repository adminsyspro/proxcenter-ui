/**
 * Tracks which tenant authored each orchestrator alert rule.
 *
 * The Go orchestrator stores rules with no tenant_id. Without this map a
 * vDC-tenant rule would be visible to (and trigger alerts for) the
 * provider, leaking tenant policy and spamming the wrong dashboard.
 *
 * Rows live in `alert_rule_owners(rule_id, tenant_id)`. Migration of pre-
 * existing rules is implicit: any rule that has no row here is treated as
 * provider-owned (back-compat for setups that ran before this table).
 */

import { prisma } from "@/lib/db/prisma"
import { DEFAULT_TENANT_ID } from "@/lib/tenant"

export async function setRuleOwner(ruleId: string, tenantId: string): Promise<void> {
  await prisma.alertRuleOwner.upsert({
    where: { ruleId },
    update: { tenantId },
    create: { ruleId, tenantId },
  })
}

export async function deleteRuleOwner(ruleId: string): Promise<void> {
  await prisma.alertRuleOwner.deleteMany({ where: { ruleId } })
}

export async function getRuleOwner(ruleId: string): Promise<string | null> {
  const row = await prisma.alertRuleOwner.findUnique({
    where: { ruleId },
    select: { tenantId: true },
  })


return row?.tenantId ?? null
}

/**
 * Decide whether a rule (by id) is visible to the given tenant.
 *
 * - vDC tenants only see rules they authored (must have a row here with
 *   matching tenant_id).
 * - Provider tenant sees rules it authored AND rules with no row (legacy
 *   pre-migration entries that we treat as provider-owned by default).
 */
export async function ruleVisibleToTenant(ruleId: string, tenantId: string): Promise<boolean> {
  const owner = await getRuleOwner(ruleId)

  if (owner === null) return tenantId === DEFAULT_TENANT_ID

return owner === tenantId
}
