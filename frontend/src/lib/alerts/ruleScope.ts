/**
 * Defense-in-depth scope injection for orchestrator alert rules.
 *
 * The Go orchestrator is not tenant-aware: rules fire on every event
 * matching the rule's filters. To stop a vDC tenant's rule from
 * triggering on a neighbour tenant's VMs we pin `node_pattern` to the
 * vDC's allowed nodes before forwarding the body to the orchestrator.
 *
 * **Limited in typical MSP deployments**: when several vDCs share the
 * same cluster nodes (the common layout), every vDC has every node in
 * its scope and the injected pattern matches all cluster events — same
 * as no pattern. The real isolation in that layout is by PVE pool,
 * which the orchestrator's rule schema doesn't support. Final
 * cross-tenant safety lives in the visibility filter
 * (`@/lib/alerts/visibility.ts`), which checks pool membership per alert.
 *
 * Provider (default) tenants are left alone — they intentionally see
 * everything and the rule form lets them set node_pattern explicitly.
 */

import { DEFAULT_TENANT_ID } from "@/lib/tenant"
import { getVdcScope } from "@/lib/vdc/scope"

/**
 * Pin `body.node_pattern` to a regex matching only the vDC's nodes for
 * this connection. Mutates the body in place and returns it.
 *
 * No-op when:
 * - the caller is the provider tenant
 * - no connection_id is set (the orchestrator wouldn't fire anyway)
 * - the vDC has no nodes recorded for that connection (can't form a pattern)
 */
export async function injectVdcNodeScope(
  body: { connection_id?: string; node_pattern?: string },
  tenantId: string
): Promise<void> {
  if (tenantId === DEFAULT_TENANT_ID) return
  if (!body.connection_id) return

  const vdcScope = await getVdcScope(tenantId)
  const allowedNodes = vdcScope?.nodesByConnection.get(body.connection_id)

  if (!allowedNodes || allowedNodes.size === 0) return

  const escaped = [...allowedNodes].map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

  body.node_pattern = `^(${escaped.join('|')})$`
}
