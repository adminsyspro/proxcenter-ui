import { aiTargetId, completeText, extractJsonObject, resolveAiTarget, type AiTarget } from '@/lib/ai/complete'
import { jsonLanguageInstruction } from '@/lib/ai/locale'
import { createReadingCache } from '@/lib/ai/readingCache'
import { safeLog } from '@/lib/log/sanitize'

import { getResourcesOverview } from './overviewBuilder'
import type { ReadingRequest } from './readingRoute'
import { basicPlan, buildPlanLevers, buildPlanPrompt, PLAN_SYSTEM_PROMPT, sanitizePlanReply, type OptimizationPlan } from './optimizationPlan'

const MODEL_TIMEOUT_MS = 45_000
const MAX_TOKENS = 1500

const plans = createReadingCache<OptimizationPlan>({ ttlMs: 15 * 60_000, fallbackTtlMs: 2 * 60_000, maxEntries: 200 })

type OptimizationPlanRequest = ReadingRequest

/** Null when the connection is not one of the tenant's. */
export async function getOptimizationPlan(request: OptimizationPlanRequest): Promise<OptimizationPlan | null> {
  const target = await resolveAiTarget(request.tenantId)
  const key = `${request.tenantId}|${request.filterConnectionId ?? '*'}|${request.locale}`

  return plans.get(key, aiTargetId(target), Boolean(request.refresh), () => computePlan(request, target))
}

async function computePlan(request: OptimizationPlanRequest, target: AiTarget | null): Promise<OptimizationPlan | null> {
  const { data } = await getResourcesOverview(request)
  const scope = request.filterConnectionId
    ? data.connections?.find((c: { id: string }) => c.id === request.filterConnectionId)?.name
    : request.scopeAll
  if (!scope) return null

  const levers = buildPlanLevers({
    overprovisioning: data.overprovisioning ?? null,
    stopped: data.stoppedAllocation ?? null,
    largestStopped: data.largestStopped ?? [],
    clusters: data.clusters ?? [],
    nodes: data.nodes ?? [],
    thresholds: data.thresholds,
  })
  const generatedAt = new Date().toISOString()

  // Nothing to rank: no model call.
  if (target && levers.length > 0) {
    try {
      const reply = await completeText(target, {
        system: PLAN_SYSTEM_PROMPT,
        user: buildPlanPrompt(scope, levers, jsonLanguageInstruction(request.locale)),
        maxTokens: MAX_TOKENS,
        timeoutMs: MODEL_TIMEOUT_MS,
      })
      const plan = sanitizePlanReply(extractJsonObject(reply), levers)

      if (plan) return { provider: target.provider, model: target.model, generatedAt, ...plan }
      console.warn('[resources/optimization-plan] unusable model reply, rule-based plan used')
    } catch (e: any) {
      console.warn('[resources/optimization-plan] model call failed:', safeLog(e?.message))
    }
  }

  return { provider: 'basic', generatedAt, aiFailed: target !== null && levers.length > 0, ...basicPlan(levers) }
}
