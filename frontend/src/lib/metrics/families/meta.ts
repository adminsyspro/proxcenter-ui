// Build information, the one family with no scope: it matches no prefix in
// METRIC_FAMILY_SCOPES, so `familyScope` answers null and `isFamilyAllowed`
// treats it as always visible. Any valid token sees it, which is what lets a
// hub dashboard show which ProxCenter it is charting.
//
// Deliberately carries NO edition label: that would couple the exposition to
// the orchestrator's licence verdict, and `getServerLicense` falls back to
// community whenever the orchestrator is unreachable, so the label would lie
// during exactly the incident an operator is looking at the dashboard for.
import { APP_VERSION } from "@/config/version"
import type { MetricFamily } from "@/lib/metrics/prometheus"

import { family } from "./registry"

export function buildMetaFamilies(): MetricFamily[] {
  return [
    family("proxcenter_build_info", [
      { name: "proxcenter_build_info", labels: { version: APP_VERSION }, value: 1 },
    ]),
  ]
}
