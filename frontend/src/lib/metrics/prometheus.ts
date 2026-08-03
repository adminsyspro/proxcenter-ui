// PURE Prometheus text-exposition helpers (spec section 8, D12). Metric
// names are prefixed proxcenter_ and filtered per family by token scope: a
// token holding only vms:read gets a 200 with the VM series only, never a
// 403 — the anyOf scope semantics settled for the allowlist (Task 7) apply
// per metric FAMILY here, not per route. Label values (connection, node,
// VM names) come straight from customer data, so escaping is not optional.
export type Sample = {
  name: string
  labels: Record<string, string | number | null | undefined>
  value: number
}

export type MetricFamily = {
  name: string
  help: string
  type: "gauge"
  samples: Sample[]
}

/** Family name prefix -> the single scope that unlocks it (spec section 8). */
export const METRIC_FAMILY_SCOPES: Record<string, string> = {
  proxcenter_node_: "nodes:read",
  proxcenter_vm_: "vms:read",
  proxcenter_backup_: "backups:read",
}

/**
 * Escapes a label value per the Prometheus text exposition format:
 * backslash first (so it does not double-escape the quote/newline
 * escapes it introduces), then double quote, then newline. Order matters:
 * escaping backslash last would turn the `\"` produced for a literal `"`
 * into `\\"`, corrupting the exposition.
 */
export function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")
}

/**
 * Escapes HELP text per the Prometheus text exposition format: backslash
 * and line feed only. HELP text is NOT quote-delimited (unlike a label
 * value), so a literal `"` needs no escaping here — reusing
 * escapeLabelValue would over-escape and misrepresent the source string.
 * Order matters for the same reason as escapeLabelValue: backslash first.
 */
export function escapeHelpText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n")
}

/** The scope (if any) required to see a given metric family, by prefix match. */
export function familyScope(metricName: string): string | null {
  for (const [prefix, scope] of Object.entries(METRIC_FAMILY_SCOPES)) {
    if (metricName.startsWith(prefix)) return scope
  }
  return null
}

/**
 * Whether a token holding `tokenScopes` may see this metric family. A
 * family with no configured scope (e.g. `proxcenter_up`) is always
 * allowed. This is a per-family FILTER, never a route-level gate: the
 * caller renders a 200 with disallowed families removed, never a 403,
 * per spec section 8. Only the absence of ANY relevant scope for the
 * whole route (checked in getPrincipal(), Task 7) yields a 403.
 */
export function isFamilyAllowed(metricName: string, tokenScopes: readonly string[]): boolean {
  const scope = familyScope(metricName)
  if (scope === null) return true
  return tokenScopes.includes(scope)
}

function renderLabels(labels: Sample["labels"]): string {
  const parts: string[] = []
  for (const [key, raw] of Object.entries(labels)) {
    if (raw === null || raw === undefined || raw === "") continue
    parts.push(`${key}="${escapeLabelValue(String(raw))}"`)
  }
  return parts.length > 0 ? `{${parts.join(",")}}` : ""
}

/**
 * Renders families in the Prometheus text exposition format: one `# HELP`
 * line and one `# TYPE` line per family, then its samples. A family with
 * zero samples is omitted entirely — real scrapers choke on a header with
 * no data line behind it. Null/undefined/empty-string label values are
 * dropped rather than rendered as an empty or literal-"null" label.
 */
export function renderExposition(families: MetricFamily[]): string {
  let out = ""
  for (const family of families) {
    if (family.samples.length === 0) continue
    out += `# HELP ${family.name} ${escapeHelpText(family.help)}\n`
    out += `# TYPE ${family.name} ${family.type}\n`
    for (const sample of family.samples) {
      out += `${sample.name}${renderLabels(sample.labels)} ${sample.value}\n`
    }
  }
  return out
}
