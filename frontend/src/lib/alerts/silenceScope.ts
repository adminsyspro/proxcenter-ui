// src/lib/alerts/silenceScope.ts
//
// A silence hides an alert, by fingerprint, from the alert list and the
// dashboard of the whole tenant. A caller whose alerts.manage is scoped (a
// node, a VM, a vDC) silences only an alert it sees under that permission, the
// rule of the alert routes (roadmap#223). A caller nothing restricts keeps
// silencing any fingerprint, as before.

import { NextResponse } from "next/server"

import { visibleAlertFilter } from "@/lib/incidents/alertVisibility"
import { PERMISSIONS } from "@/lib/rbac"

import { isLocalAlertScopeRestricted } from "./localAlertScope"
import { fetchOrchestratorAlerts } from "./orchestratorAlertFeed"
import { buildOrchestratorFingerprint } from "./orchestratorFingerprint"

export async function refuseInvisibleSilence(fingerprint: string): Promise<NextResponse | null> {
  if (!(await isLocalAlertScopeRestricted(PERMISSIONS.ALERTS_MANAGE))) return null

  const isVisible = await visibleAlertFilter(PERMISSIONS.ALERTS_MANAGE)
  for (const alert of await fetchOrchestratorAlerts()) {
    if (buildOrchestratorFingerprint(alert) === fingerprint && (await isVisible(alert))) return null
  }

  return NextResponse.json({ error: "Alert not found" }, { status: 404 })
}
