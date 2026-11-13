// GPU chargeback report (#672): the hourly usage rows of a period turned into
// what each customer owes. Pure, so the page, the CSV export and the tests
// share it.
//
// The owner of a row is its vDC when the VM sat in a vDC pool, otherwise the
// tenant that owns the connection, otherwise the provider itself. Hours are
// counted per GPU: a VM holding two GPUs for one hour is two GPU-hours.
import type { GpuPrice } from './settings'

export type UsageRow = {
  hour: Date
  connectionId: string
  connectionName: string
  node: string
  vmid: number
  vmName: string
  modelKey: string
  modelName: string
  pool: string | null
  vdcId: string | null
  vdcName: string | null
  tenantId: string | null
  tenantName: string | null
  runningSeconds: number
  reservedSeconds: number
}

export type BillingLine = {
  modelKey: string
  modelName: string
  runningHours: number
  reservedHours: number
  /** null when the model has no price yet. */
  cost: number | null
}

export type BillingVm = BillingLine & { key: string; connectionName: string; node: string; vmid: number; vmName: string }

export type BillingOwner = {
  key: string
  kind: 'vdc' | 'tenant' | 'provider'
  tenantName: string | null
  vdcName: string | null
  lines: BillingLine[]
  vms: BillingVm[]
  runningHours: number
  reservedHours: number
  /** null when one of its models has no price. */
  cost: number | null
}

export type BillingReport = {
  from: string
  to: string
  currency: string
  owners: BillingOwner[]
  /** Models used over the period without a price. */
  unpriced: Array<{ modelKey: string; modelName: string }>
  totals: { runningHours: number; reservedHours: number; cost: number }
}

const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits

function ownerOf(r: UsageRow): Pick<BillingOwner, 'key' | 'kind' | 'tenantName' | 'vdcName'> {
  if (r.vdcId) return { key: `vdc:${r.vdcId}`, kind: 'vdc', tenantName: r.tenantName, vdcName: r.vdcName }
  if (r.tenantId && r.tenantId !== 'default') return { key: `tenant:${r.tenantId}`, kind: 'tenant', tenantName: r.tenantName, vdcName: null }
  return { key: 'provider', kind: 'provider', tenantName: null, vdcName: null }
}

function costOf(line: { modelKey: string; runningHours: number; reservedHours: number }, prices: Map<string, GpuPrice>): number | null {
  const p = prices.get(line.modelKey)
  if (!p) return null
  return round(line.runningHours * p.runningHourly + line.reservedHours * p.reservedHourly)
}

export function buildBillingReport(rows: UsageRow[], prices: GpuPrice[], opts: { from: Date; to: Date; currency: string }): BillingReport {
  const priceOf = new Map(prices.map(p => [p.modelKey, p]))
  const owners = new Map<string, BillingOwner & { lineMap: Map<string, BillingLine>; vmMap: Map<string, BillingVm> }>()
  const unpriced = new Map<string, string>()

  for (const r of rows) {
    const o = ownerOf(r)
    let owner = owners.get(o.key)
    if (!owner) {
      owner = { ...o, lines: [], vms: [], runningHours: 0, reservedHours: 0, cost: 0, lineMap: new Map(), vmMap: new Map() }
      owners.set(o.key, owner)
    }
    const running = r.runningSeconds / 3600
    const reserved = r.reservedSeconds / 3600
    const line = owner.lineMap.get(r.modelKey) ?? { modelKey: r.modelKey, modelName: r.modelName, runningHours: 0, reservedHours: 0, cost: null }
    line.runningHours += running
    line.reservedHours += reserved
    owner.lineMap.set(r.modelKey, line)

    const vmKey = `${r.connectionId}:${r.vmid}:${r.modelKey}`
    const vm = owner.vmMap.get(vmKey) ?? {
      key: vmKey, connectionName: r.connectionName, node: r.node, vmid: r.vmid, vmName: r.vmName,
      modelKey: r.modelKey, modelName: r.modelName, runningHours: 0, reservedHours: 0, cost: null,
    }
    vm.runningHours += running
    vm.reservedHours += reserved
    vm.vmName = r.vmName
    owner.vmMap.set(vmKey, vm)
    if (!priceOf.has(r.modelKey)) unpriced.set(r.modelKey, r.modelName)
  }

  const totals = { runningHours: 0, reservedHours: 0, cost: 0 }
  const out: BillingOwner[] = []
  for (const { lineMap, vmMap, ...owner } of owners.values()) {
    // The VM lines are what an invoice lists: each is priced and rounded, and
    // every total above is the sum of those rounded lines, so it reconciles.
    owner.vms = [...vmMap.values()]
      .map(v => ({ ...v, runningHours: round(v.runningHours), reservedHours: round(v.reservedHours), cost: costOf(v, priceOf) }))
      .sort((a, b) => b.runningHours - a.runningHours || a.vmName.localeCompare(b.vmName))
    owner.lines = [...lineMap.values()].map(l => {
      const vms = owner.vms.filter(v => v.modelKey === l.modelKey)
      const priced = priceOf.has(l.modelKey)
      return {
        ...l,
        runningHours: round(l.runningHours),
        reservedHours: round(l.reservedHours),
        cost: priced ? round(vms.reduce((sum, v) => sum + (v.cost ?? 0), 0)) : null,
      }
    })
    owner.runningHours = round(owner.lines.reduce((s, l) => s + l.runningHours, 0))
    owner.reservedHours = round(owner.lines.reduce((s, l) => s + l.reservedHours, 0))
    owner.cost = owner.lines.some(l => l.cost === null) ? null : round(owner.lines.reduce((s, l) => s + (l.cost ?? 0), 0))
    totals.runningHours += owner.runningHours
    totals.reservedHours += owner.reservedHours
    totals.cost += owner.lines.reduce((s, l) => s + (l.cost ?? 0), 0)
    out.push(owner)
  }
  const label = (o: BillingOwner) => `${o.kind === 'provider' ? '~' : ''}${o.tenantName ?? ''} ${o.vdcName ?? ''}`
  out.sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0) || label(a).localeCompare(label(b)))

  return {
    from: opts.from.toISOString(),
    to: opts.to.toISOString(),
    currency: opts.currency,
    owners: out,
    unpriced: [...unpriced.entries()].map(([modelKey, modelName]) => ({ modelKey, modelName })),
    totals: { runningHours: round(totals.runningHours), reservedHours: round(totals.reservedHours), cost: round(totals.cost) },
  }
}

/** The month a `YYYY-MM` names, in UTC, or null when malformed. */
export function monthRange(month: string): { from: Date; to: Date } | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month)
  if (!m) return null
  const from = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1))
  const to = new Date(Date.UTC(Number(m[1]), Number(m[2]), 1))
  return { from, to }
}

function csvCell(value: string | number | null): string {
  if (value === null) return ''
  const s = String(value)
  // Leading = + - @ would be read as a formula by a spreadsheet.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
  return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** One line per owner, VM and model: what an invoicing tool imports. */
export function billingCsv(report: BillingReport): string {
  const head = ['tenant', 'vdc', 'cluster', 'node', 'vmid', 'vm', 'gpu_model', 'running_hours', 'reserved_hours', `cost_${report.currency}`]
  const lines = [head.join(',')]
  for (const o of report.owners) {
    for (const v of o.vms) {
      lines.push(
        [o.kind === 'provider' ? '' : o.tenantName, o.vdcName, v.connectionName, v.node, v.vmid, v.vmName, v.modelName, v.runningHours, v.reservedHours, v.cost]
          .map(c => csvCell(c ?? null))
          .join(','),
      )
    }
  }
  return lines.join('\n') + '\n'
}
