import { escapeHtml } from '@/lib/compliance/report/escapeHtml'

import type { ClusterCapacity, NodeCapacity, StoppedAllocation, StoragePoolCapacity, Thresholds } from './capacity'

export type ReportTranslator = (key: string, params?: Record<string, string | number>) => string

export type ReportAlert = { resource: 'cpu' | 'ram' | 'storage'; currentValue: number; daysToThreshold: number | null; threshold: number }

export type CapacityReportInput = {
  scope: string
  generatedAt: string
  brandColor: string
  logoDataUri: string
  appName: string
  healthScore: number
  kpis: {
    cpuPct: number
    ramPct: number
    storageUsed: number
    storageTotal: number
    vmsRunning: number
    vmsTotal: number
  }
  alerts: ReportAlert[]
  clusters: Array<ClusterCapacity & { runwayDays: number | null; runwayResource: string | null }>
  nodes: NodeCapacity[]
  pools: StoragePoolCapacity[]
  stopped: StoppedAllocation
  thresholds: Thresholds
}

const GiB = 1024 ** 3

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))

  return `${Number.parseFloat((bytes / 1024 ** i).toFixed(1))} ${units[i]}`
}

const pct = (value: number) => `${Math.round(value)}%`

function level(value: number, warning: number, critical: number): 'crit' | 'warn' | 'ok' {
  if (value >= critical) return 'crit'
  if (value >= warning) return 'warn'
  return 'ok'
}

function scoreLevel(score: number): 'crit' | 'warn' | '' {
  if (score < 60) return 'crit'

  return score < 80 ? 'warn' : ''
}

// A self-contained page for the WeasyPrint sidecar (no external resource: it runs
// with base_url=None). Every value coming from Proxmox or the database is escaped.
export function capacityReportHtml(input: CapacityReportInput, t: ReportTranslator): string {
  const e = (value: string | number) => escapeHtml(String(value))
  const { thresholds: th } = input
  const days = (value: number | null) => (value === null ? t('beyondHorizon') : t('days', { days: value }))
  const storagePct = input.kpis.storageTotal > 0 ? (input.kpis.storageUsed / input.kpis.storageTotal) * 100 : 0
  const cores = input.clusters.reduce((s, c) => s + c.cpu.cores, 0)
  const vcpu = input.clusters.reduce((s, c) => s + c.cpu.vcpuAllocated, 0)
  const ramTotal = input.clusters.reduce((s, c) => s + c.ram.total, 0)
  const ramAllocated = input.clusters.reduce((s, c) => s + c.ram.allocated, 0)
  const title = input.appName ? `${input.appName} · ${t('title')}` : t('title')

  const kpi = (label: string, value: string, cls = '') => `<div class="kpi ${cls}"><div class="kpi-label">${e(label)}</div><div class="kpi-value">${e(value)}</div></div>`

  const alertRows = input.alerts.map(a => `
    <tr>
      <td>${e(t(`resource.${a.resource}`))}</td>
      <td>${e(pct(a.currentValue))}</td>
      <td>${e(pct(a.threshold))}</td>
      <td class="${a.daysToThreshold !== null && a.daysToThreshold <= 30 ? 'crit' : ''}">${e(days(a.daysToThreshold))}</td>
    </tr>`).join('')

  const clusterRows = input.clusters.map(c => {
    const n1 = c.nPlusOne.applicable ? (c.nPlusOne.ok ? t('n1Ok') : t('n1Ko')) : t('notApplicable')

    return `
    <tr>
      <td><strong>${e(c.name)}</strong></td>
      <td>${e(`${c.nodesOnline}/${c.nodesTotal}`)}</td>
      <td class="${level(c.cpu.usedPct, th.cpu.warning, th.cpu.critical)}">${e(pct(c.cpu.usedPct))}</td>
      <td class="${level(c.ram.usedPct, th.ram.warning, th.ram.critical)}">${e(pct(c.ram.usedPct))}</td>
      <td class="${level(c.storage.pct, th.storage.warning, th.storage.critical)}">${e(pct(c.storage.pct))}</td>
      <td>${e(`${c.cpu.ratio.toFixed(1)}:1`)}</td>
      <td class="${c.nPlusOne.ok === false ? 'crit' : ''}">${e(n1)}</td>
      <td>${e(c.runwayResource ? `${days(c.runwayDays)} (${t(`resource.${c.runwayResource}`)})` : days(null))}</td>
    </tr>`
  }).join('')

  const nodeRows = input.nodes.map(n => `
    <tr>
      <td>${e(n.connectionName)}</td>
      <td><strong>${e(n.node)}</strong>${n.online ? '' : ` <span class="crit">(${e(t('offline'))})</span>`}</td>
      <td class="${level(n.cpuPct, th.cpu.warning, th.cpu.critical)}">${e(n.online ? pct(n.cpuPct) : '-')}</td>
      <td class="${level(n.ramPct, th.ram.warning, th.ram.critical)}">${e(n.online ? pct(n.ramPct) : '-')}</td>
      <td>${e(n.cores > 0 ? `${(n.vcpuAllocated / n.cores).toFixed(1)}:1` : '-')}</td>
      <td>${e(`${n.guestsRunning}/${n.guestsTotal}`)}</td>
    </tr>`).join('')

  const poolRows = input.pools.map(p => `
    <tr>
      <td><strong>${e(p.name)}</strong></td>
      <td>${e(p.connectionName)}</td>
      <td>${e(p.node ?? t('shared'))}</td>
      <td class="${level(p.pct, th.storage.warning, th.storage.critical)}">${e(pct(p.pct))}</td>
      <td>${e(`${formatBytes(p.used)} / ${formatBytes(p.total)}`)}</td>
      <td>${e(days(p.daysToThreshold))}</td>
    </tr>`).join('')

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${e(title)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; @bottom-right { content: counter(page) " / " counter(pages); font-size: 8pt; color: #777; } }
  body { font-family: 'DejaVu Sans', Arial, sans-serif; font-size: 9pt; color: #222; }
  header { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid ${e(input.brandColor)}; padding-bottom: 8px; margin-bottom: 14px; }
  header img { height: 34px; }
  h1 { font-size: 16pt; margin: 0; }
  h2 { font-size: 11pt; color: ${e(input.brandColor)}; margin: 18px 0 6px; }
  .meta { color: #666; font-size: 8.5pt; }
  .kpis { display: flex; flex-wrap: wrap; gap: 6px; }
  .kpi { flex: 1 1 22%; border: 1px solid #ddd; border-radius: 4px; padding: 6px 8px; background: #fafafa; }
  .kpi-label { font-size: 7.5pt; color: #666; text-transform: uppercase; }
  .kpi-value { font-size: 13pt; font-weight: bold; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th { text-align: left; font-size: 8pt; color: #555; border-bottom: 1.5px solid #bbb; padding: 4px; }
  td { border-bottom: 1px solid #eee; padding: 4px; }
  tr { page-break-inside: avoid; }
  .ok { color: #15803d; } .warn { color: #b45309; font-weight: bold; } .crit { color: #b91c1c; font-weight: bold; }
  .kpi.crit .kpi-value { color: #b91c1c; } .kpi.warn .kpi-value { color: #b45309; }
  .note { color: #666; font-size: 8pt; margin-top: 16px; }
</style></head>
<body>
  <header>
    <div><h1>${e(title)}</h1><div class="meta">${e(t('scope', { scope: input.scope }))} · ${e(t('generated', { date: input.generatedAt }))}</div></div>
    ${input.logoDataUri ? `<img src="${e(input.logoDataUri)}" alt="">` : ''}
  </header>

  <h2>${e(t('summary'))}</h2>
  <div class="kpis">
    ${kpi(t('healthScore'), `${input.healthScore}/100`, scoreLevel(input.healthScore))}
    ${kpi('CPU', pct(input.kpis.cpuPct), level(input.kpis.cpuPct, th.cpu.warning, th.cpu.critical))}
    ${kpi('RAM', pct(input.kpis.ramPct), level(input.kpis.ramPct, th.ram.warning, th.ram.critical))}
    ${kpi(t('storage'), pct(storagePct), level(storagePct, th.storage.warning, th.storage.critical))}
    ${kpi('vCPU:pCPU', cores > 0 ? `${(vcpu / cores).toFixed(1)}:1` : '-')}
    ${kpi(t('ramAllocation'), ramTotal > 0 ? pct((ramAllocated / ramTotal) * 100) : '-')}
    ${kpi(t('guests'), `${input.kpis.vmsRunning}/${input.kpis.vmsTotal}`)}
    ${kpi(t('dormant'), `${Math.round(input.stopped.ramBytes / GiB)} GB / ${input.stopped.count}`)}
  </div>

  <h2>${e(t('forecast'))}</h2>
  <table><thead><tr><th>${e(t('colResource'))}</th><th>${e(t('colCurrent'))}</th><th>${e(t('colThreshold'))}</th><th>${e(t('colRunway'))}</th></tr></thead>
  <tbody>${alertRows}</tbody></table>

  <h2>${e(t('clusters'))}</h2>
  <table><thead><tr><th>${e(t('colCluster'))}</th><th>${e(t('colNodes'))}</th><th>CPU</th><th>RAM</th><th>${e(t('storage'))}</th><th>vCPU:pCPU</th><th>N+1</th><th>${e(t('colRunway'))}</th></tr></thead>
  <tbody>${clusterRows}</tbody></table>

  <h2>${e(t('pools'))}</h2>
  <table><thead><tr><th>${e(t('colPool'))}</th><th>${e(t('colCluster'))}</th><th>${e(t('colScope'))}</th><th>${e(t('colUsage'))}</th><th>${e(t('colCapacity'))}</th><th>${e(t('colRunway'))}</th></tr></thead>
  <tbody>${poolRows}</tbody></table>

  <h2>${e(t('nodes'))}</h2>
  <table><thead><tr><th>${e(t('colCluster'))}</th><th>${e(t('colNode'))}</th><th>CPU</th><th>RAM</th><th>vCPU:pCPU</th><th>${e(t('guests'))}</th></tr></thead>
  <tbody>${nodeRows}</tbody></table>

  <p class="note">${e(t('method', {
    cpuW: th.cpu.warning, cpuC: th.cpu.critical, ramW: th.ram.warning, ramC: th.ram.critical, stW: th.storage.warning, stC: th.storage.critical,
  }))}</p>
</body></html>`
}
