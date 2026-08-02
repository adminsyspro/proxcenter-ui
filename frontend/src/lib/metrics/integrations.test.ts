import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

import { getAllowlistEntryById } from '@/lib/api-tokens/allowlist'
import { familyScope } from './prometheus'

/**
 * DERIVED, not hand-copied, from the actual handler: a hardcoded literal
 * list here would drift silently from src/app/api/v1/public/metrics/route.ts
 * the moment someone renames a metric there, defeating the whole point of
 * this task ("a metric rename breaks CI instead of shipping an empty
 * dashboard" — plan Task 20). Proven by mutation while writing this test:
 * a hand-typed list did NOT go red when the literal name in route.ts was
 * renamed, only when the unrelated prefix table in prometheus.ts was
 * touched. Every metric name in that route is emitted as a `name:
 * "proxcenter_..."` string literal (family or sample), so extracting every
 * such literal is a faithful, exact mirror of what the handler can emit.
 */
const METRICS_ROUTE_SOURCE = readFileSync('src/app/api/v1/public/metrics/route.ts', 'utf8')
const EMITTED_METRICS = Array.from(
  new Set(Array.from(METRICS_ROUTE_SOURCE.matchAll(/name:\s*"(proxcenter_[a-z_]+)"/g)).map(m => m[1])),
)

const dashboard = JSON.parse(
  readFileSync('public/integrations/grafana-dashboard-proxcenter.json', 'utf8'),
)
const scrapeConfig = readFileSync('public/integrations/prometheus-scrape-config.yml', 'utf8')

describe('Grafana dashboard', () => {
  it('is importable: title, schemaVersion, panels and a datasource variable', () => {
    expect(dashboard.title).toBe('ProxCenter fleet')
    expect(typeof dashboard.schemaVersion).toBe('number')
    expect(Array.isArray(dashboard.panels)).toBe(true)
    expect(dashboard.panels.length).toBeGreaterThanOrEqual(4)
    expect(dashboard.templating.list[0].type).toBe('datasource')
  })

  it('derived the expected emitted-metric names from the real handler (sanity on the extraction itself)', () => {
    expect(EMITTED_METRICS.sort()).toEqual([
      'proxcenter_backup_age_seconds',
      'proxcenter_node_cpu_usage_ratio',
      'proxcenter_node_mem_usage_ratio',
      'proxcenter_node_online',
      'proxcenter_vm_agent_enabled',
      'proxcenter_vm_cpu_usage_ratio',
      'proxcenter_vm_status',
    ])
  })

  it('only references metrics the handler actually emits', () => {
    const expressions: string[] = dashboard.panels.flatMap((panel: any) =>
      (panel.targets ?? []).map((target: any) => String(target.expr)),
    )
    expect(expressions.length).toBeGreaterThan(0)
    const referenced = new Set(
      expressions.flatMap(expr => Array.from(expr.matchAll(/proxcenter_[a-z_]+/g)).map(m => m[0])),
    )
    expect(referenced.size).toBeGreaterThan(0)
    for (const metric of referenced) {
      expect(EMITTED_METRICS).toContain(metric)
      expect(familyScope(metric)).not.toBeNull()
    }
  })

  it('covers the four #254 use cases', () => {
    const titles = dashboard.panels.map((panel: any) => String(panel.title))
    expect(titles).toEqual(expect.arrayContaining([
      'Guests without a backup in the last 48h',
      'Guests pinned at 100% CPU',
      'Guests without the guest agent enabled',
      'Node capacity (CPU and memory)',
    ]))
  })

  /**
   * The guest-agent-enabled use case (#254) is real, but
   * `proxcenter_vm_agent_enabled` is deliberately omitted whenever the
   * agent flag is unknown (prometheus.ts route handler), and it is
   * UNKNOWN for every guest today: the inventory cache is built from
   * /cluster/resources, which carries no agent config flag at all
   * (publicData.ts). A panel for this use case would therefore ship
   * permanently empty on any real install right now — the "looks broken"
   * symptom this project keeps fighting.
   *
   * Choice made (not the alternative of leaving the panel out): the panel
   * stays, so the use case is not silently dropped, but it carries an
   * explicit, visible "no data yet" description naming the exact reason
   * (source is /cluster/resources, not /config) and what would re-enable
   * it. This test locks that disclosure in: silently deleting the
   * description while keeping the panel (or deleting the whole panel) is
   * exactly the "quietly removed" shortcut this task must not take, and
   * both would fail this assertion.
   */
  it('discloses, rather than hides, that the guest-agent panel has no data yet', () => {
    const agentPanel = dashboard.panels.find(
      (panel: any) => panel.title === 'Guests without the guest agent enabled',
    )
    expect(agentPanel).toBeDefined()
    expect(String(agentPanel.description)).toContain('No data yet')
    expect(String(agentPanel.description)).toContain('/cluster/resources')
    expect(String(agentPanel.description)).toContain('/config')
  })
})

describe('Prometheus scrape config snippet', () => {
  it('targets the allowlisted metrics path with a bearer credential', () => {
    const entry = getAllowlistEntryById('public-metrics')
    expect(scrapeConfig).toContain('scrape_configs:')
    expect(scrapeConfig).toContain(`metrics_path: ${entry?.pattern}`)
    expect(scrapeConfig).toContain('authorization:')
    expect(scrapeConfig).toContain('credentials: pxc_')
  })
})
