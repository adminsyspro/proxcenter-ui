import { NextResponse } from "next/server"

import { audit, type AuditAction } from "@/lib/audit"
import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPlanTenantScope } from "@/lib/orchestrator/planTenantScope"
import { replicationErrorResponse } from "@/lib/orchestrator/replicationError"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

type OrchestratorClient = ReturnType<typeof getOrchestratorClient>

export interface ProxyPlanGuestActionOptions {
  /** Invokes the guest-scoped orchestrator action, e.g. (client, id, vmid) => client.guestFailback(id, vmid). */
  action: (client: OrchestratorClient, id: string, vmid: number, body: any) => Promise<{ data: any }>
  /** Audit action written for the attempt, success or refusal alike. */
  auditAction: AuditAction
  /** Fallback error message used when the caught error has none of its own. */
  fallbackMessage: string
}

/** Reads the guest VMID of a per-guest route; null when it is not a positive integer. */
export function parseGuestVMID(raw: string): number | null {
  const vmid = Number(raw)

  return Number.isInteger(vmid) && vmid > 0 ? vmid : null
}

/**
 * Shared body of the four per-guest Site Recovery routes (ui#943): failover,
 * failback, failback cutover and failback cancel of ONE guest of a plan.
 * Permission check, tenant-scoped plan lookup, the orchestrator call, an
 * audit entry naming the plan and the guest, and the same upstream-error
 * passthrough as the plan-wide routes (a 409 keeps the orchestrator's own
 * sentence, which says why the guest is refused).
 */
export async function proxyPlanGuestAction(
  params: Promise<{ id: string; vmid: string }>,
  body: any,
  options: ProxyPlanGuestActionOptions,
): Promise<NextResponse> {
  const { action, auditAction, fallbackMessage } = options
  const { id, vmid: rawVMID } = await params
  const vmid = parseGuestVMID(rawVMID)

  if (vmid === null) {
    return NextResponse.json({ error: "vmid must be a positive integer" }, { status: 400 })
  }

  let planName: string | undefined

  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_MANAGE, "global", "*")

    if (denied) return denied

    const { denied: scopeDenied, plan } = await checkPlanTenantScope(id)

    if (scopeDenied) return scopeDenied

    planName = plan?.name
    const guestName = (plan?.vms || []).find((vm: any) => vm.vm_id === vmid)?.vm_name

    const response = await action(getOrchestratorClient(), id, vmid, body)

    await audit({
      action: auditAction,
      category: "vms",
      resourceType: "recovery_plan_guest",
      resourceId: `${id}:${vmid}`,
      resourceName: guestName ? `${guestName} (${planName || id})` : `VM ${vmid} (${planName || id})`,
      // The identifying fields come last: no key of the request body can overwrite them.
      details: { ...(body && typeof body === "object" ? body : {}), plan_id: id, plan_name: planName, vm_id: vmid },
      status: "success",
    }).catch(() => { /* the action is done, a lost audit row never undoes it */ })

    return NextResponse.json(response.data)
  } catch (e: any) {
    const failure = replicationErrorResponse(e, fallbackMessage)

    await audit({
      action: auditAction,
      category: "vms",
      resourceType: "recovery_plan_guest",
      resourceId: `${id}:${vmid}`,
      resourceName: `VM ${vmid} (${planName || id})`,
      details: { plan_id: id, plan_name: planName, vm_id: vmid, http_status: failure.status },
      status: "failure",
      errorMessage: e?.message || fallbackMessage,
    }).catch(() => { /* same: the refusal is already on its way to the operator */ })

    return failure
  }
}
