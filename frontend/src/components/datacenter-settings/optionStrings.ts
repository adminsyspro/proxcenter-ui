import { splitTags } from '@/lib/proxmox/tagAccess'

/* ------------------------------------------------------------------ */
/* PVE datacenter option values (GET returns objects, PUT takes strings) */
/* ------------------------------------------------------------------ */

function propertyEntries(val: unknown): Array<[string, string]> {
  if (!val) return []
  if (typeof val === 'object' && !Array.isArray(val)) {
    return Object.entries(val as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => [k, Array.isArray(v) ? v.join(';') : String(v)])
  }
  const entries: Array<[string, string]> = []
  for (const part of String(val).split(',')) {
    const eq = part.indexOf('=')
    if (eq > 0) entries.push([part.slice(0, eq), part.slice(eq + 1)])
  }
  return entries
}

export function parseKV(val: unknown, keys: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  keys.forEach(k => result[k] = '')
  for (const [k, v] of propertyEntries(val)) {
    if (keys.includes(k)) result[k] = v
  }
  return result
}

/**
 * Rebuilds a property string from the value PVE returned, with the form's
 * fields laid over it: an empty field drops its key, and every key the form
 * does not show (crs `ha-auto-rebalance`, webauthn `allow-subdomains`, a
 * future PVE key...) is written back unchanged instead of being erased.
 */
export function mergeKV(raw: unknown, fields: Record<string, string>): string {
  const entries = new Map(propertyEntries(raw))
  for (const [k, v] of Object.entries(fields)) {
    if (v) entries.set(k, v)
    else entries.delete(k)
  }
  return [...entries].map(([k, v]) => `${k}=${v}`).join(',')
}

/** A PVE tag list (`registered-tags`, `user-allow-list`): GET gives an array, PUT wants `a;b`. */
export function tagListValue(val: unknown): string {
  return splitTags(val).join(';')
}
