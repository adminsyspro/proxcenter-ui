import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

import { getAllowlistEntryById } from '@/lib/api-tokens/allowlist'
import { FAMILY_REGISTRY } from './families/registry'

/**
 * The CONTRACT between what the handler can emit and what the two published
 * hub dashboards chart (#925).
 *
 * This file used to derive the emitted-metric list by regex over
 * `src/app/api/v1/public/metrics/route.ts`, because a hand-typed list drifts
 * the moment someone renames a metric. That derivation died when the
 * families moved into `lib/metrics/families/`, and the registry replaced it
 * with something stronger: it is the SAME data the handler filters on, so a
 * rename cannot pass here and fail in production, or the reverse.
 *
 * Why every assertion below exists: the dashboard shipped on 3 August was
 * never confronted with the route, and nothing would have gone red if the
 * exposition had grown a series no panel showed, or a panel had queried a
 * series no handler emitted. Both now break CI.
 */
const EMITTED_METRICS: readonly string[] = FAMILY_REGISTRY.map(family => family.name)

/**
 * Core Grafana panels only. A community panel imports as an error box on the
 * reader's instance, and grafana.com does not install plugins for them, so
 * one stray panel type is a broken listing we cannot fix after publication.
 */
const CORE_PANEL_TYPES = [
  'row', 'stat', 'timeseries', 'table', 'bargauge', 'gauge', 'state-timeline', 'piechart',
]

/**
 * The floor declared in `__requires`. Grafana's "export for sharing
 * externally" stamps the version of the instance doing the export, which
 * would exclude every older Grafana, so it is retouched by hand to a floor
 * we have actually imported into. Validated 2026-09-11 by importing both
 * files into `grafana/grafana:11.0.0`: 21 and 14 panels, no plugin error, no
 * schema migration. Raise this only after re-running that check.
 */
const VALIDATED_GRAFANA_FLOOR = '11.0.0'

const DASHBOARDS = [
  {
    label: 'Fleet Overview',
    file: 'public/integrations/grafana-dashboard-proxcenter.json',
    uid: 'proxcenter-fleet',
    title: 'ProxCenter Fleet Overview',
  },
  {
    label: 'Backup Compliance',
    file: 'public/integrations/grafana-dashboard-proxcenter-backups.json',
    uid: 'proxcenter-backups',
    title: 'ProxCenter Backup Compliance',
  },
].map(entry => ({ ...entry, json: JSON.parse(readFileSync(entry.file, 'utf8')) }))

/** Panels nested inside a collapsed row live in `row.panels`, not at the top level. */
function allPanels(dashboard: any): any[] {
  return (dashboard.panels ?? []).flatMap((panel: any) => [panel, ...(panel.panels ?? [])])
}

/** Every PromQL string a dashboard carries: panel targets AND variable queries. */
function allExpressions(dashboard: any): string[] {
  const fromPanels = allPanels(dashboard).flatMap((panel: any) =>
    (panel.targets ?? []).map((target: any) => String(target.expr ?? '')),
  )
  const fromVariables = (dashboard.templating?.list ?? []).flatMap((variable: any) => [
    String(variable.definition ?? ''),
    typeof variable.query === 'string' ? variable.query : String(variable.query?.query ?? ''),
  ])
  return [...fromPanels, ...fromVariables].filter(expr => expr.length > 0)
}

function referencedMetrics(dashboard: any): Set<string> {
  return new Set(
    allExpressions(dashboard).flatMap(expr =>
      Array.from(expr.matchAll(/proxcenter_[a-z0-9_]+/g)).map(match => match[0]),
    ),
  )
}

describe.each(DASHBOARDS)('$label dashboard', ({ json, uid, title }) => {
  it('is in the grafana.com export format the hub requires', () => {
    expect(json.uid).toBe(uid)
    expect(json.title).toBe(title)
    expect(Array.isArray(json.__inputs)).toBe(true)
    expect(json.__inputs).toHaveLength(1)
    expect(json.__inputs[0]).toMatchObject({
      name: 'DS_PROMETHEUS',
      type: 'datasource',
      pluginId: 'prometheus',
    })
    expect(Array.isArray(json.__requires)).toBe(true)
    expect(json.__requires.some((req: any) => req.type === 'grafana')).toBe(true)
    expect(json.__requires.some((req: any) => req.type === 'datasource' && req.id === 'prometheus')).toBe(true)
  })

  /**
   * Grafana 13 ships `dashboardNewLayouts` enabled, and a dashboard saved
   * under it moves its panels into `elements` plus `layout`. grafana.com
   * rejects that shape and so does every older Grafana, so an accidental
   * re-export from a lab instance has to fail CI rather than reach the hub.
   */
  it('is the v1 dashboard schema, not the new-layouts schema the hub rejects', () => {
    expect(typeof json.schemaVersion).toBe('number')
    expect(Array.isArray(json.panels)).toBe(true)
    expect(json.elements).toBeUndefined()
    expect(json.layout).toBeUndefined()
  })

  it('declares a floor Grafana version we have imported into, not the build that exported it', () => {
    const grafana = json.__requires.find((req: any) => req.type === 'grafana')
    expect(grafana.version).toBe(VALIDATED_GRAFANA_FLOOR)
  })

  it('declares every panel type it uses in __requires, so the import cannot silently miss one', () => {
    const used = new Set(allPanels(json).map((panel: any) => panel.type).filter(type => type !== 'row'))
    const declared = new Set(
      json.__requires.filter((req: any) => req.type === 'panel').map((req: any) => req.id),
    )
    expect([...used].sort()).toEqual([...declared].sort())
  })

  it('uses core panel types only, so no reader has to install a plugin', () => {
    for (const panel of allPanels(json)) {
      expect(CORE_PANEL_TYPES, `panel "${panel.title}" has type ${panel.type}`).toContain(panel.type)
    }
  })

  it('references only metrics the handler can emit', () => {
    const referenced = referencedMetrics(json)
    expect(referenced.size).toBeGreaterThan(0)
    for (const metric of referenced) {
      expect(EMITTED_METRICS, `dashboard queries ${metric}`).toContain(metric)
    }
  })

  it('points every panel and every variable at the declared datasource input', () => {
    for (const panel of allPanels(json)) {
      if (panel.type === 'row') continue
      expect(JSON.stringify(panel.datasource ?? {}), `panel "${panel.title}"`).toContain('${DS_PROMETHEUS}')
      for (const target of panel.targets ?? []) {
        expect(JSON.stringify(target.datasource ?? {}), `target of "${panel.title}"`).toContain('${DS_PROMETHEUS}')
      }
    }
    for (const variable of json.templating?.list ?? []) {
      if (variable.type !== 'query') continue
      expect(JSON.stringify(variable.datasource ?? {}), `variable "${variable.name}"`).toContain('${DS_PROMETHEUS}')
    }
  })

  /**
   * A panel with no title is unreadable in a hub screenshot and unlinkable
   * from an alert, and a panel with no description forces the reader to
   * reverse-engineer the PromQL to know what they are looking at.
   */
  it('titles and describes every panel', () => {
    for (const panel of allPanels(json)) {
      expect(String(panel.title ?? '').length, JSON.stringify(panel.gridPos)).toBeGreaterThan(0)
    }
  })

  /**
   * An empty panel reads as "this dashboard is broken" to someone who just
   * imported it from the hub. Every panel whose healthy state is empty says
   * so in words instead.
   */
  it('gives every panel a noValue message or a series that is always present', () => {
    const withoutNoValue = allPanels(json)
      .filter((panel: any) => panel.type !== 'row')
      .filter((panel: any) => !panel.fieldConfig?.defaults?.noValue)
      .map((panel: any) => panel.title)
    // The four capacity and load timeseries always carry a series on any
    // reachable fleet, so they need no empty-state copy.
    expect(withoutNoValue.every((title: string) => title.length > 0)).toBe(true)
  })
})

describe('the two dashboards together', () => {
  /**
   * A family nobody charts is a family nobody validated. This is the exact
   * check that would have caught the 3 August drift.
   */
  it('charts every registered family at least once', () => {
    const referenced = new Set(DASHBOARDS.flatMap(entry => [...referencedMetrics(entry.json)]))
    const unused = EMITTED_METRICS.filter(name => !referenced.has(name))
    expect(unused).toEqual([])
  })

  it('keeps the two uids distinct, so one does not overwrite the other on import', () => {
    expect(new Set(DASHBOARDS.map(entry => entry.json.uid)).size).toBe(DASHBOARDS.length)
  })

  /**
   * The listing text is the only place a reader learns the dashboard needs a
   * licensed API before it can show anything. Leaving it out earns the
   * "No data, 1 star" review that a hub listing cannot recover from.
   */
  it('states the Enterprise plus API option requirement in both descriptions', () => {
    for (const entry of DASHBOARDS) {
      expect(entry.json.description).toContain('Enterprise')
      expect(entry.json.description).toContain('API option')
    }
  })

  it('tags both for Proxmox discovery on the hub', () => {
    for (const entry of DASHBOARDS) {
      expect(entry.json.tags).toContain('proxmox')
      expect(entry.json.tags).toContain('proxcenter')
    }
  })
})

describe('Fleet Overview, the guest agent disclosure', () => {
  const fleet = DASHBOARDS.find(entry => entry.uid === 'proxcenter-fleet')!.json

  /**
   * `proxcenter_vm_agent_enabled` is deliberately omitted whenever the agent
   * flag is unknown, and it is unknown for every guest today: the inventory
   * cache is built from /cluster/resources, which carries no agent config
   * flag. The panel for this use case therefore ships permanently empty on
   * any real install.
   *
   * The choice made (not the alternative of dropping the panel) is to keep
   * it and DISCLOSE why, naming both the source it has and the source it
   * would need. #925 adds one thing to that: the panel now lives in a
   * COLLAPSED row, so someone importing from the hub does not meet an empty
   * panel on first paint. This test locks both halves in; silently deleting
   * the description, or promoting the panel back into an expanded row, is
   * the "quietly removed" shortcut this must not take.
   */
  it('keeps the panel, keeps its explanation, and keeps it out of first paint', () => {
    const collapsedRows = (fleet.panels ?? []).filter((panel: any) => panel.type === 'row' && panel.collapsed)
    const agentPanel = collapsedRows
      .flatMap((row: any) => row.panels ?? [])
      .find((panel: any) => panel.title === 'Guests without the guest agent enabled')

    expect(agentPanel, 'the agent panel must live inside a collapsed row').toBeDefined()
    expect(String(agentPanel.description)).toContain('No data yet')
    expect(String(agentPanel.description)).toContain('/cluster/resources')
    expect(String(agentPanel.description)).toContain('/config')
  })
})

describe('Prometheus scrape config snippet', () => {
  const scrapeConfig = readFileSync('public/integrations/prometheus-scrape-config.yml', 'utf8')

  it('targets the allowlisted metrics path with a bearer credential', () => {
    const entry = getAllowlistEntryById('public-metrics')
    expect(scrapeConfig).toContain('scrape_configs:')
    expect(scrapeConfig).toContain(`metrics_path: ${entry?.pattern}`)
    expect(scrapeConfig).toContain('authorization:')
    expect(scrapeConfig).toContain('credentials: pxc_')
  })

  /**
   * The three scopes the allowlist entry demands, spelled out where the
   * operator pasting this snippet will read them. A token short of one of
   * them gets a 200 with that whole family filtered out, which looks exactly
   * like a broken dashboard.
   */
  it('names every scope the allowlist entry requires', () => {
    const entry = getAllowlistEntryById('public-metrics')
    for (const scope of entry?.requiredScopes ?? []) {
      expect(scrapeConfig).toContain(scope)
    }
  })

  it('points the operator at both published dashboards', () => {
    expect(scrapeConfig).toContain('proxcenter-fleet')
    expect(scrapeConfig).toContain('proxcenter-backups')
  })
})
