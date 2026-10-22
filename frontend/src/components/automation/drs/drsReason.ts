// Pure helpers that translate why DRS recommends, made or cannot make a move:
// the orchestrator names the reason with a code and keeps an English text as
// a fallback for older payloads and history rows written before the codes.

/** The reason fields of a recommendation, a migration or a pinned guest. */
export interface DrsReasonFields {
  reason?: string
  reason_code?: string
  reason_params?: Record<string, string>
}

type Translate = (key: string, values?: Record<string, string | number>) => string

// Params the messages format as numbers, in the user's locale
const NUMERIC_PARAMS = new Set(['from', 'to'])

// Codes of a recommendation, kept on its migration (drsPage.reasons)
const RECOMMENDATION_REASONS = new Set([
  'evacuation', 'highCpu', 'highMemory', 'loadBalancing', 'homogenization', 'affinity', 'antiAffinity', 'nodeAffinity',
])

// Codes of a guest no other node can run (drsPage.pinnedReasons)
const PINNED_REASONS = new Set(['noTarget', 'network', 'storage'])

// The English texts an orchestrator wrote before the codes, still in the
// migration history: each fixed format maps back to its code and params.
const LEGACY_REASONS: { pattern: RegExp; code: string; params: string[] }[] = [
  { pattern: /^Node evacuation for maintenance$/, code: 'evacuation', params: [] },
  { pattern: /^High CPU load on source node$/, code: 'highCpu', params: [] },
  { pattern: /^High memory usage on source node$/, code: 'highMemory', params: [] },
  { pattern: /^Load balancing optimization$/, code: 'loadBalancing', params: [] },
  { pattern: /^Homogenization: reduce load from ([\d.]+)% to ([\d.]+)%$/, code: 'homogenization', params: ['from', 'to'] },
  { pattern: /^Affinity rule '(.+)': VMs should be on the same node$/, code: 'affinity', params: ['rule'] },
  { pattern: /^Anti-affinity rule '(.+)': VMs should be on different nodes$/, code: 'antiAffinity', params: ['rule'] },
  { pattern: /^Node affinity rule '(.+)': VM should run on (\S+)$/, code: 'nodeAffinity', params: ['rule', 'node'] },
]

const withLegacyCode = (fields: DrsReasonFields): DrsReasonFields => {
  if (fields.reason_code || !fields.reason) return fields

  for (const { pattern, code, params } of LEGACY_REASONS) {
    const match = pattern.exec(fields.reason)

    if (match) return { ...fields, reason_code: code, reason_params: Object.fromEntries(params.map((name, i) => [name, match[i + 1]])) }
  }

  return fields
}

const translated = (fields: DrsReasonFields, codes: Set<string>, namespace: string, t: Translate): string => {
  const code = fields.reason_code

  if (!code || !codes.has(code)) return fields.reason ?? ''

  const values = Object.fromEntries(
    Object.entries(fields.reason_params ?? {}).map(([key, value]) => [key, NUMERIC_PARAMS.has(key) ? Number(value) : value])
  )

  return t(`${namespace}.${code}`, values)
}

/** Why a recommendation or a migration moves a guest, in the user's language. */
export const drsReasonText = (fields: DrsReasonFields, t: Translate): string =>
  translated(withLegacyCode(fields), RECOMMENDATION_REASONS, 'drsPage.reasons', t)

/** Why no other node can run a guest, in the user's language. */
export const pinnedReasonText = (fields: DrsReasonFields, t: Translate): string =>
  translated(fields, PINNED_REASONS, 'drsPage.pinnedReasons', t)
