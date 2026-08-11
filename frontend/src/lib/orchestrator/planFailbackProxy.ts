import { NextResponse } from "next/server"

import { getOrchestratorClient, parseOrchestratorError } from "@/lib/orchestrator/client"
import { checkPlanTenantScope } from "@/lib/orchestrator/planTenantScope"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

type OrchestratorClient = ReturnType<typeof getOrchestratorClient>

export interface ProxyPlanFailbackActionOptions {
  /** Invokes the plan-scoped orchestrator action, e.g. (client, id) => client.executeFailback(id). */
  action: (client: OrchestratorClient, id: string) => Promise<{ data: any }>
  /** Label passed to console.error when a non-ORCHESTRATOR_UNAVAILABLE error is caught. */
  logLabel: string
  /** Fallback error message used when the caught error has none of its own. */
  fallbackMessage: string
}

/**
 * Shared body for the three failback-family POST routes (failback,
 * failback-cutover, failback-cancel): permission check, tenant-scoped plan
 * lookup, the orchestrator action call, and upstream-error passthrough.
 * Each route only differs by which client method it calls and the
 * log/fallback strings, both supplied via `options`.
 */
export async function proxyPlanFailbackAction(
  params: Promise<{ id: string }>,
  options: ProxyPlanFailbackActionOptions,
): Promise<NextResponse> {
  const { action, logLabel, fallbackMessage } = options

  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_MANAGE, "global", "*")

    if (denied) return denied

    const { id } = await params
    const { denied: scopeDenied } = await checkPlanTenantScope(id)

    if (scopeDenied) return scopeDenied

    const response = await action(getOrchestratorClient(), id)

    return NextResponse.json(response.data)
  } catch (e: any) {
    if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error(logLabel, e)
    }

    const upstream = parseOrchestratorError(e)

    if (upstream) {
      return NextResponse.json({ error: upstream.message }, { status: upstream.status })
    }

    return NextResponse.json(
      { error: e?.message || fallbackMessage },
      { status: 500 }
    )
  }
}
