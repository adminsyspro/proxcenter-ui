/**
 * The changes made to a connection's infrastructure rather than to a guest:
 * firewall, access (ACLs, users, groups, tokens, failed logins), storages and
 * node interfaces. Their rows read as one line built from the object's own
 * fields, the full field table a click away.
 */

import type { ChangeFieldDiff } from './csv'

export const INFRA_TYPES = new Set(['firewall', 'access', 'storage', 'network'])

export const INFRA_ICONS: Record<string, string> = {
  firewall: 'ri-shield-line',
  access: 'ri-key-2-line',
  storage: 'ri-database-2-line',
  network: 'ri-router-line'
}

/** Words the summaries need, already translated. */
export type InfraWords = {
  pending: string
  disabled: string
  from: (host: string) => string
  times: (count: number) => string
}

type Values = Record<string, string>

/** The fields' values on one side: after a change, or before a removal. */
function side(fields: readonly ChangeFieldDiff[] | undefined, removed: boolean): Values {
  const out: Values = {}

  for (const f of fields || []) {
    const v = (removed ? f.oldValue : f.newValue) ?? ''

    if (f.field && v !== '') out[f.field] = v
  }

  return out
}

const join = (...parts: Array<string | undefined | false>) => parts.filter(Boolean).join(' · ')

/** A firewall rule as Proxmox's own list reads it: IN ACCEPT tcp 22 from … */
function ruleText(v: Values, w: InfraWords): string {
  const head = [v.type?.toUpperCase(), v.macro || v.action, v.proto, v.dport].filter(Boolean).join(' ')

  return join(head, v.source && w.from(v.source), v.comment && `(${v.comment})`, v.enable === '0' && w.disabled)
}

/** What changed, field by field, the first few. */
function diffText(fields: readonly ChangeFieldDiff[] | undefined): string {
  return (fields || [])
    .filter(f => f.field !== 'pos')
    .slice(0, 3)
    .map(f => `${f.field} ${f.oldValue || '-'} → ${f.newValue || '-'}`)
    .join(' · ')
}

/** The one-line summary of an infrastructure change. */
export function infraSummary(action: string | undefined, fields: readonly ChangeFieldDiff[] | undefined, w: InfraWords): string {
  const a = action || ''
  const removed = a.endsWith('_removed')
  const v = side(fields, removed)

  if (a === 'login_failed') return join(v.count && w.times(Number(v.count)), v.rhost && w.from(v.rhost))
  if (a === 'firewall_ipset_changed') {
    return (fields || []).map(f => (f.newValue ? `+${f.newValue}` : `−${f.oldValue}`)).join(' · ')
  }
  // The action says it all: the same rules, another order
  if (a === 'firewall_rules_reordered') return ''
  if (a.endsWith('_changed')) return diffText(fields)
  if (a.startsWith('firewall_rule')) return ruleText(v, w)
  if (a.startsWith('firewall_alias')) return join(v.cidr, v.comment)
  if (a.startsWith('acl')) return join(v.ugid, v.roleid)
  if (a.startsWith('token')) return join(v.privsep === '1' ? 'privsep' : undefined, v.comment)
  if (a.startsWith('storage')) return join(v.type, v.content)
  if (a.startsWith('iface')) return join(v.type, v.cidr, v.pending === '1' && w.pending)

  return join(v.comment, v.email)
}
