import { readingRoute } from "@/lib/resources/readingRoute"
import { getOptimizationPlan } from "@/lib/resources/optimizationPlanService"

export const runtime = "nodejs"

/**
 * GET /api/v1/resources/optimization-plan?connectionId=&refresh=1
 *
 * Optimisation plan of the scope shown on the resources page: levers computed
 * from the overview snapshot (60 s cache, no extra Proxmox call), ranked and
 * explained by the configured AI model, or by rules without one. The model is
 * called at most once per scope and language every 15 minutes; `refresh=1` asks
 * for a new plan.
 */
export const GET = readingRoute('optimization-plan', getOptimizationPlan)
