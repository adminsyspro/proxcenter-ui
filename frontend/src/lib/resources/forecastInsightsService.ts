import { aiTargetId, completeText, extractJsonObject, resolveAiTarget, type AiTarget } from '@/lib/ai/complete'
import { jsonLanguageInstruction } from '@/lib/ai/locale'
import { createReadingCache } from '@/lib/ai/readingCache'
import { safeLog } from '@/lib/log/sanitize'
import { calculateImprovedPredictions } from '@/app/(dashboard)/infrastructure/resources/algorithms/improvedPrediction'
import { calculateHealthScoreWithDetails } from '@/app/(dashboard)/infrastructure/resources/algorithms/healthScore'
import { computeClusterRunway } from '@/app/(dashboard)/infrastructure/resources/algorithms/capacityPlanning'
import { DEFAULT_HISTORY_WINDOW_DAYS } from '@/app/(dashboard)/infrastructure/resources/algorithms/historyWindow'

import { getResourcesOverview } from './overviewBuilder'
import type { ReadingRequest } from './readingRoute'
import {
  basicForecastReading,
  buildForecastDigest,
  buildForecastPrompt,
  dataConfidence,
  FORECAST_SYSTEM_PROMPT,
  sanitizeForecastReply,
  type ForecastInsights,
} from './forecastInsights'

const MODEL_TIMEOUT_MS = 45_000
const MAX_TOKENS = 1500

const readings = createReadingCache<ForecastInsights>({ ttlMs: 15 * 60_000, fallbackTtlMs: 2 * 60_000, maxEntries: 200 })

type ForecastInsightsRequest = ReadingRequest

/** Null when the connection is not one of the tenant's. */
export async function getForecastInsights(request: ForecastInsightsRequest): Promise<ForecastInsights | null> {
  const target = await resolveAiTarget(request.tenantId)
  const key = `${request.tenantId}|${request.filterConnectionId ?? '*'}|${request.locale}`

  return readings.get(key, aiTargetId(target), Boolean(request.refresh), () => computeForecastInsights(request, target))
}

async function computeForecastInsights(request: ForecastInsightsRequest, target: AiTarget | null): Promise<ForecastInsights | null> {
  const { data } = await getResourcesOverview(request)
  const scope = request.filterConnectionId
    ? data.connections?.find((c: { id: string }) => c.id === request.filterConnectionId)?.name
    : request.scopeAll
  if (!scope) return null

  const windowDays = DEFAULT_HISTORY_WINDOW_DAYS
  const trends = data.trends ?? []
  const { alerts } = calculateImprovedPredictions(data.kpis, trends.slice(-windowDays), data.thresholds, undefined, request.dateLocale)
  const healthScore = calculateHealthScoreWithDetails(data.kpis, alerts, data.thresholds).score
  const clusters = (data.clusters ?? []).map((cluster: any) => ({
    ...cluster,
    alerts: computeClusterRunway(cluster, data.thresholds, windowDays).alerts,
  }))

  const digest = buildForecastDigest({
    scope,
    thresholds: data.thresholds,
    windowDays,
    trends,
    kpis: data.kpis,
    alerts,
    healthScore,
    healthHistory: data.healthScoreHistory ?? [],
    clusters,
    pools: data.storagePools ?? [],
    stopped: data.stoppedAllocation ?? null,
  })

  const base = {
    generatedAt: new Date().toISOString(),
    dataConfidence: dataConfidence(digest.historyDays),
    historyDays: digest.historyDays,
  }

  if (target) {
    try {
      const reply = await completeText(target, {
        system: FORECAST_SYSTEM_PROMPT,
        user: buildForecastPrompt(digest, jsonLanguageInstruction(request.locale)),
        maxTokens: MAX_TOKENS,
        timeoutMs: MODEL_TIMEOUT_MS,
      })
      const reading = sanitizeForecastReply(extractJsonObject(reply), digest)

      if (reading) return { ...base, provider: target.provider, model: target.model, ...reading }
      console.warn('[resources/forecast-insights] unusable model reply, rule-based reading used')
    } catch (e: any) {
      console.warn('[resources/forecast-insights] model call failed:', safeLog(e?.message))
    }
  }

  return { ...base, provider: 'basic', aiFailed: target !== null, ...basicForecastReading(digest) }
}
