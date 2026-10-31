import { readingRoute } from "@/lib/resources/readingRoute"
import { getForecastInsights } from "@/lib/resources/forecastInsightsService"

export const runtime = "nodejs"

/**
 * GET /api/v1/resources/forecast-insights?connectionId=&refresh=1
 *
 * AI reading of the capacity forecast of the scope shown on the resources page,
 * or the rule-based reading when no model is configured. Built from the overview
 * snapshot (60 s cache, no extra Proxmox call when the page was just loaded);
 * the model is called at most once per scope and language every 15 minutes,
 * `refresh=1` asks for a new reading.
 */
export const GET = readingRoute('forecast-insights', getForecastInsights)
