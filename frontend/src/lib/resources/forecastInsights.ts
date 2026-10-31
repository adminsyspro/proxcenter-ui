import { linearRegression } from '@/app/(dashboard)/infrastructure/resources/algorithms/linearRegression'
import type { PredictiveAlert } from '@/app/(dashboard)/infrastructure/resources/types'

import type { ClusterCapacity, StoppedAllocation, StoragePoolCapacity, Thresholds } from './capacity'

/*
 * AI reading of the capacity forecast.
 *
 * The forecast itself stays the page's arithmetic (EWMA runway per cluster, linear
 * runway per pool, N+1). The model only reads it: what is structural, what is
 * noise, which risks compound, what to do first. It never produces a number: every
 * figure shown next to its text comes from the digest, matched through the `ref`
 * the model has to quote back.
 */

export type ForecastResource = 'cpu' | 'ram' | 'storage'
export type ForecastRisk = 'high' | 'medium' | 'low'
export type ForecastRefKind = 'estate' | 'cluster' | 'pool'

type ResourceLine = {
  pct: number
  /** Points per day over the last 30 days of daily averages, null under 7 days. */
  slope: number | null
  days: number | null
  threshold: number
  trendType?: string
  /** Measured 14-day error in points, null on a short history. */
  forecastError?: number | null
}

export type DigestCluster = {
  ref: string
  name: string
  nodesOnline: number
  nodesTotal: number
  vcpuRatio: number
  ramAllocatedPct: number
  imbalanceRam: number
  nPlusOne: { ok: boolean; node: string | null; ramAfter: number | null; cpuAfter: number | null } | null
  resources: Record<ForecastResource, ResourceLine>
}

export type DigestPool = {
  ref: string
  name: string
  cluster: string
  node: string | null
  pct: number
  growthPerDay: number | null
  days: number | null
}

export type ForecastDigest = {
  scope: string
  historyDays: number
  windowDays: number
  thresholds: Thresholds
  estate: {
    ref: 'estate'
    healthScore: number
    healthDelta30d: number | null
    resources: Record<ForecastResource, ResourceLine>
  }
  clusters: DigestCluster[]
  pools: DigestPool[]
  dormant: { count: number; vcpu: number; ramGiB: number }
}

export type ForecastOutlookItem = {
  ref: string
  kind: ForecastRefKind
  name: string
  cluster: string | null
  node: string | null
  resource: ForecastResource
  risk: ForecastRisk
  pct: number
  days: number | null
  explanation: string
  action: string
  /** Rule-based reading: i18n keys under resources.forecastAi.*, resolved by the page. */
  explanationKey?: string
  actionKey?: string
  params?: Record<string, string | number>
}

export type ForecastInsights = {
  provider: 'basic' | 'ollama' | 'openai' | 'anthropic'
  model?: string
  generatedAt: string
  summary: string
  summaryKey?: string
  summaryParams?: Record<string, string | number>
  outlook: ForecastOutlookItem[]
  /** How much history the forecast stands on, never the model's opinion of itself. */
  dataConfidence: ForecastRisk
  historyDays: number
  /** A model is configured but its call failed or its reply was unusable. */
  aiFailed?: boolean
}

const RESOURCES: ForecastResource[] = ['cpu', 'ram', 'storage']
const MAX_OUTLOOK = 8
const MAX_POOLS = 8
const POOL_HORIZON_DAYS = 180
const GiB = 1024 ** 3

const round1 = (value: number) => Math.round(value * 10) / 10
const round2 = (value: number) => Math.round(value * 100) / 100

function slopeOf(values: number[]): number | null {
  const recent = values.slice(-30).filter(v => Number.isFinite(v))

  return recent.length >= 7 ? round2(linearRegression(recent).slope) : null
}

function resourceLines(
  current: Record<ForecastResource, number>,
  trends: Array<{ cpu: number; ram: number; storage?: number }>,
  alerts: PredictiveAlert[],
  thresholds: Thresholds,
): Record<ForecastResource, ResourceLine> {
  const line = (resource: ForecastResource): ResourceLine => {
    const alert = alerts.find(a => a.resource === resource)

    return {
      pct: round1(current[resource]),
      slope: slopeOf(trends.map(t => (resource === 'storage' ? t.storage ?? Number.NaN : t[resource]))),
      days: alert?.daysToThreshold ?? null,
      threshold: thresholds[resource].critical,
      trendType: alert?.trendType,
      forecastError: alert?.forecastError == null ? null : round1(alert.forecastError),
    }
  }

  return { cpu: line('cpu'), ram: line('ram'), storage: line('storage') }
}

export function buildForecastDigest(input: {
  scope: string
  thresholds: Thresholds
  windowDays: number
  trends: Array<{ cpu: number; ram: number; storage?: number }>
  kpis: { cpu: { used: number }; ram: { used: number }; storage: { used: number; total: number } }
  alerts: PredictiveAlert[]
  healthScore: number
  healthHistory: Array<{ score: number }>
  clusters: Array<ClusterCapacity & { alerts: PredictiveAlert[] }>
  pools: StoragePoolCapacity[]
  stopped: StoppedAllocation | null
}): ForecastDigest {
  const { thresholds } = input
  const storagePct = input.kpis.storage.total > 0 ? (input.kpis.storage.used / input.kpis.storage.total) * 100 : 0
  const history = input.healthHistory.slice(-30)
  const healthDelta30d = history.length >= 2 ? history.at(-1)!.score - history[0].score : null

  const clusters: DigestCluster[] = input.clusters.map((c, i) => ({
    ref: `c${i + 1}`,
    name: c.name,
    nodesOnline: c.nodesOnline,
    nodesTotal: c.nodesTotal,
    vcpuRatio: round1(c.cpu.ratio),
    ramAllocatedPct: c.ram.total > 0 ? Math.round((c.ram.allocated / c.ram.total) * 100) : 0,
    imbalanceRam: round1(c.imbalance.ram),
    nPlusOne: c.nPlusOne.applicable
      ? { ok: c.nPlusOne.ok !== false, node: c.nPlusOne.largestNode, ramAfter: c.nPlusOne.ramPctAfter, cpuAfter: c.nPlusOne.cpuPctAfter }
      : null,
    resources: resourceLines({ cpu: c.cpu.usedPct, ram: c.ram.usedPct, storage: c.storage.pct }, c.trends, c.alerts, thresholds),
  }))

  const pools: DigestPool[] = input.pools
    .filter(p => p.pct >= thresholds.storage.warning || (p.daysToThreshold !== null && p.daysToThreshold <= POOL_HORIZON_DAYS))
    .sort((a, b) => (a.daysToThreshold ?? Infinity) - (b.daysToThreshold ?? Infinity) || b.pct - a.pct)
    .slice(0, MAX_POOLS)
    .map((p, i) => ({
      ref: `p${i + 1}`,
      name: p.name,
      cluster: p.connectionName,
      node: p.node,
      pct: round1(p.pct),
      growthPerDay: p.growthPctPerDay === null ? null : round2(p.growthPctPerDay),
      days: p.daysToThreshold,
    }))

  return {
    scope: input.scope,
    historyDays: input.trends.length,
    windowDays: input.windowDays,
    thresholds,
    estate: {
      ref: 'estate',
      healthScore: input.healthScore,
      healthDelta30d,
      resources: resourceLines({ cpu: input.kpis.cpu.used, ram: input.kpis.ram.used, storage: storagePct }, input.trends.slice(-input.windowDays), input.alerts, thresholds),
    },
    clusters,
    pools,
    dormant: {
      count: input.stopped?.count ?? 0,
      vcpu: input.stopped?.vcpu ?? 0,
      ramGiB: Math.round((input.stopped?.ramBytes ?? 0) / GiB),
    },
  }
}

export function dataConfidence(historyDays: number): ForecastRisk {
  if (historyDays >= 90) return 'high'
  if (historyDays >= 30) return 'medium'

  return 'low'
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

/** The rule item of a cluster that cannot absorb the loss of a node. */
export const isNPlusOneItem = (item: Pick<ForecastOutlookItem, 'explanationKey'>) => item.explanationKey?.startsWith('explainNPlusOne') ?? false

function fmtCrossing(days: number | null): string {
  if (days === null) return 'not reached within 365 days'
  if (days <= 0) return 'already crossed'

  return `reached in ${days} days`
}
const signed = (value: number) => (value >= 0 ? `+${value}` : String(value))
const fmtSlope = (slope: number | null) => (slope === null ? 'n/a' : `${signed(slope)} pts/day`)

function resourceText(name: string, line: ResourceLine): string {
  const extra = [line.trendType && `trend ${line.trendType}`, line.forecastError != null && `measured 14-day forecast error ±${line.forecastError} pts`].filter(Boolean).join(', ')

  const suffix = extra ? ` (${extra})` : ''

  return `${name} ${line.pct}% (critical at ${line.threshold}%), 30-day slope ${fmtSlope(line.slope)}, critical threshold ${fmtCrossing(line.days)}${suffix}`
}

export const FORECAST_SYSTEM_PROMPT = `You are a capacity planning analyst for Proxmox VE clusters. You read a forecast computed by the platform and explain it to the infrastructure manager who decides on purchases and rebalancing.

Rules:
- Use only the figures given. Never compute, round or invent a number, a date or a node name that is not in the data.
- Put the ref of the cluster, pool or estate (estate, c1, c2, p1 ...) in the "ref" field. In every sentence, name clusters and pools by their name in quotes, never by their ref.
- A cluster that FAILS N+1, or anything already over its critical threshold, is always high risk.
- A risk on one storage pool goes under that pool's ref (p1, p2 ...), not under its cluster's.
- Judge each risk: is the growth structural (steady slope, high fit confidence) or noise (low confidence, stable trend)? Do risks compound (for example a cluster that fails N+1 while its RAM keeps growing)?
- Recommend concrete actions an operator can take in Proxmox: add a node or RAM, rebalance guests between nodes, reclaim the allocation of stopped guests, extend or clean a storage pool, review the vCPU ratio.
- Order the outlook by urgency. Leave out what needs no attention.
- Reply with JSON only, no markdown.`

export function buildForecastPrompt(digest: ForecastDigest, languageLine: string): string {
  const lines: string[] = []
  const { estate } = digest

  lines.push(`Scope: ${digest.scope}. History available: ${digest.historyDays} days of daily averages; forecast window: last ${digest.windowDays} days.`)
  lines.push('')
  const healthDelta = estate.healthDelta30d === null ? '' : `, ${signed(estate.healthDelta30d)} over 30 days`
  lines.push(`[estate] health score ${estate.healthScore}/100${healthDelta}`)
  for (const r of RESOURCES) lines.push(`  ${resourceText(r.toUpperCase(), estate.resources[r])}`)

  for (const c of digest.clusters) {
    lines.push('')
    lines.push(`[${c.ref}] cluster "${c.name}": ${c.nodesOnline}/${c.nodesTotal} nodes online, vCPU:pCPU ${c.vcpuRatio}:1, RAM allocated ${c.ramAllocatedPct}% of physical, RAM spread across nodes ${c.imbalanceRam} pts std dev`)
    if (c.nPlusOne) {
      const after = c.nPlusOne.ramAfter === null || c.nPlusOne.cpuAfter === null
        ? 'no capacity left on the remaining nodes'
        : `remaining nodes at ${c.nPlusOne.ramAfter}% RAM, ${c.nPlusOne.cpuAfter}% CPU`
      lines.push(`  N+1: ${c.nPlusOne.ok ? 'holds' : 'FAILS'} if ${c.nPlusOne.node} is lost (${after})`)
    } else {
      lines.push('  N+1: not applicable (single node)')
    }
    // Storage is read per pool below: a cluster-wide storage figure would hide the pool that fills up.
    for (const r of ['cpu', 'ram'] as const) lines.push(`  ${resourceText(r.toUpperCase(), c.resources[r])}`)
  }

  if (digest.pools.length > 0) {
    lines.push('')
    lines.push('Storage pools at risk:')
    for (const p of digest.pools) {
      const growth = p.growthPerDay === null ? 'growth unknown' : `${signed(p.growthPerDay)} pts/day`
      const where = p.node ? `node ${p.node} of ` : 'shared storage of '
      lines.push(`[${p.ref}] pool "${p.name}" on ${where}${p.cluster}: ${p.pct}% used, ${growth}, critical threshold ${digest.thresholds.storage.critical}% ${fmtCrossing(p.days)}`)
    }
  }

  lines.push('')
  lines.push(`Stopped guests still holding allocation: ${digest.dormant.count} guests, ${digest.dormant.vcpu} vCPU, ${digest.dormant.ramGiB} GiB RAM.`)
  lines.push('')
  lines.push(`Answer with this JSON structure:
{
  "summary": "3 to 4 sentences: the overall outlook, the most urgent risk and the first decision to take",
  "outlook": [
    { "ref": "estate|c1|p1...", "resource": "cpu|ram|storage", "risk": "high|medium|low", "explanation": "why this matters, 1 to 2 sentences", "action": "what to do, 1 sentence" }
  ]
}
At most ${MAX_OUTLOOK} outlook entries. "ref", "resource" and "risk" are codes read by software: copy them exactly as listed.`)
  lines.push(languageLine)

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Reply
// ---------------------------------------------------------------------------

type RefInfo = { kind: ForecastRefKind; name: string; cluster: string | null; node: string | null; pct: (r: ForecastResource) => number; days: (r: ForecastResource) => number | null }

function refIndex(digest: ForecastDigest): Map<string, RefInfo> {
  const index = new Map<string, RefInfo>()

  index.set('estate', {
    kind: 'estate', name: digest.scope, cluster: null, node: null,
    pct: r => digest.estate.resources[r].pct, days: r => digest.estate.resources[r].days,
  })
  for (const c of digest.clusters) {
    index.set(c.ref, { kind: 'cluster', name: c.name, cluster: c.name, node: null, pct: r => c.resources[r].pct, days: r => c.resources[r].days })
  }
  for (const p of digest.pools) {
    index.set(p.ref, { kind: 'pool', name: p.name, cluster: p.cluster, node: p.node, pct: () => p.pct, days: () => p.days })
  }

  return index
}

const RISK_ORDER: Record<ForecastRisk, number> = { high: 0, medium: 1, low: 2 }
const MAX_MERGED_OUTLOOK = 12
const N_PLUS_ONE = /N\s*\+\s*1/i

function riskFromDays(days: number): ForecastRisk {
  if (days <= 30) return 'high'
  if (days <= 90) return 'medium'

  return 'low'
}

/** The least risk the figures allow: the model may raise it, never lower it. Null when the figures show nothing. */
function riskFloor(pct: number, days: number | null, critical: number): ForecastRisk | null {
  if (pct >= critical) return 'high'
  if (days === null) return null

  return riskFromDays(days)
}

// Same risk: a failing N+1 first (it is today's exposure, not a forecast), then the soonest.
function byUrgency(a: ForecastOutlookItem, b: ForecastOutlookItem): number {
  const urgency = (o: ForecastOutlookItem) => (isNPlusOneItem(o) ? -1 : o.days ?? Infinity)

  return RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || urgency(a) - urgency(b)
}

const higherRisk = (a: ForecastRisk, b: ForecastRisk | null) => (b !== null && RISK_ORDER[b] < RISK_ORDER[a] ? b : a)

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

/**
 * The model's reply, kept only where it points at something in the digest. Null
 * when nothing usable is left, so the caller falls back to the rule-based reading.
 */
export function sanitizeForecastReply(raw: unknown, digest: ForecastDigest): Pick<ForecastInsights, 'summary' | 'outlook'> | null {
  if (!raw || typeof raw !== 'object') return null
  const reply = raw as { summary?: unknown; outlook?: unknown }
  const index = refIndex(digest)
  const rules = basicForecastReading(digest).outlook
  const seen = new Set<string>()
  const outlook: ForecastOutlookItem[] = []

  for (const entry of Array.isArray(reply.outlook) ? reply.outlook : []) {
    if (!entry || typeof entry !== 'object') continue
    const ref = text((entry as any).ref, 16).replace(/^\[|\]$/g, '')
    const resource = (entry as any).resource as ForecastResource
    const risk = (entry as any).risk as ForecastRisk
    const info = index.get(ref)

    if (!info || !RESOURCES.includes(resource) || !(risk in RISK_ORDER)) continue
    // A pool only has storage; a cluster's storage risk is read through its pools.
    if ((info.kind === 'pool') !== (resource === 'storage') && info.kind !== 'estate') continue
    if (seen.has(`${ref}:${resource}`)) continue
    seen.add(`${ref}:${resource}`)

    const explanation = text((entry as any).explanation, 600)
    const action = text((entry as any).action, 400)
    if (!explanation && !action) continue

    const pct = info.pct(resource)
    const days = info.days(resource)
    const floor = riskFloor(pct, days, digest.thresholds[resource].critical)
    const finalRisk = higherRisk(risk, floor)
    // Low risks, and anything short of high the figures do not back, are the
    // "nothing to do yet" lines: the summary covers them.
    if (finalRisk === 'low' || (floor === null && finalRisk !== 'high')) continue

    // Rated below what the figures show: the model misread the line, so its text
    // ("nothing to do" on a full pool) would contradict the figures. Rule text instead.
    const misread = finalRisk !== risk ? rules.find(o => o.ref === ref && o.resource === resource && !isNPlusOneItem(o)) : undefined

    outlook.push({
      ref, kind: info.kind, name: info.name, cluster: info.cluster, node: info.node,
      resource, risk: finalRisk, pct, days,
      ...(misread
        ? { explanation: '', action: '', explanationKey: misread.explanationKey, actionKey: misread.actionKey, params: misread.params }
        : { explanation, action }),
    })
    if (outlook.length >= MAX_OUTLOOK) break
  }

  const summary = text(reply.summary, 1200)
  if (!summary && outlook.length === 0) return null

  // A small model can leave out the worst risk (a failing N+1 most of all): the
  // high risks of the rule-based reading it missed are added, in their own words.
  for (const item of rules) {
    if (item.risk !== 'high' || outlook.length >= MAX_MERGED_OUTLOOK) continue
    const covered = isNPlusOneItem(item)
      ? outlook.some(o => o.ref === item.ref && N_PLUS_ONE.test(`${o.explanation} ${o.action}`))
      : outlook.some(o => o.ref === item.ref && o.resource === item.resource)
    if (!covered) outlook.push(item)
  }

  outlook.sort(byUrgency)

  return { summary, outlook }
}

// ---------------------------------------------------------------------------
// Rule-based reading, when no model is configured or it failed
// ---------------------------------------------------------------------------

const ACTION_KEY: Record<ForecastResource, string> = { cpu: 'actionCpu', ram: 'actionRam', storage: 'actionStorage' }

export function basicForecastReading(digest: ForecastDigest): Pick<ForecastInsights, 'summary' | 'summaryKey' | 'summaryParams' | 'outlook'> {
  const outlook: ForecastOutlookItem[] = []

  for (const c of digest.clusters) {
    if (c.nPlusOne && !c.nPlusOne.ok) {
      outlook.push({
        ref: c.ref, kind: 'cluster', name: c.name, cluster: c.name, node: null, resource: 'ram', risk: 'high',
        pct: c.resources.ram.pct, days: c.resources.ram.days, explanation: '', action: '',
        // No RAM figure when the remaining nodes have no capacity at all.
        explanationKey: c.nPlusOne.ramAfter === null ? 'explainNPlusOneEmpty' : 'explainNPlusOne', actionKey: 'actionNPlusOne',
        params: { node: c.nPlusOne.node ?? '', ram: c.nPlusOne.ramAfter ?? 0 },
      })
    }
    for (const r of RESOURCES) {
      const line = c.resources[r]
      if (line.days === null || line.days > 365) continue
      if (outlook.some(o => o.ref === c.ref && o.resource === r)) continue
      outlook.push({
        ref: c.ref, kind: 'cluster', name: c.name, cluster: c.name, node: null, resource: r, risk: riskFromDays(line.days),
        pct: line.pct, days: line.days, explanation: '', action: '',
        explanationKey: line.days <= 0 ? 'explainCrossed' : 'explainRunway', actionKey: ACTION_KEY[r],
        params: { threshold: line.threshold, slope: line.slope ?? 0 },
      })
    }
  }

  for (const p of digest.pools) {
    const full = p.pct >= digest.thresholds.storage.critical
    if (!full && (p.days === null || p.days > 90)) continue
    outlook.push({
      ref: p.ref, kind: 'pool', name: p.name, cluster: p.cluster, node: p.node, resource: 'storage',
      risk: full ? 'high' : riskFromDays(p.days ?? 365),
      pct: p.pct, days: p.days, explanation: '', action: '',
      explanationKey: full ? 'explainPoolFull' : 'explainPoolRunway', actionKey: 'actionPool',
      params: { threshold: digest.thresholds.storage.critical, growth: p.growthPerDay ?? 0 },
    })
  }

  outlook.sort(byUrgency)
  const kept = outlook.slice(0, MAX_OUTLOOK)
  const high = kept.filter(o => o.risk === 'high').length

  if (kept.length === 0) return { summary: '', summaryKey: 'summaryClear', summaryParams: { days: digest.historyDays }, outlook: [] }

  return {
    summary: '',
    summaryKey: high > 0 ? 'summaryUrgent' : 'summaryWatch',
    summaryParams: { total: kept.length, high, first: kept[0].name },
    outlook: kept,
  }
}
