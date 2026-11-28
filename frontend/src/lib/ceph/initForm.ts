import type { ParsedBody } from './service'
import { POOL_MAX_SIZE } from './poolForm'

/*
   The parameters of `POST /nodes/{n}/ceph/init` (ui#1450): the public network,
   an optional cluster network, and the default size and min. size of the
   pools, under the same rules as a pool (min. size 1 only on an explicit
   choice). PVE writes them in the cluster-wide /etc/pve/ceph.conf.
*/

const NODE_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/
const V4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}\/(3[0-2]|[12]?\d)$/
const V6 = /^[0-9A-Fa-f:]{2,39}\/(12[0-8]|1[01]\d|[1-9]?\d)$/

export function isCidr(value: unknown): value is string {
  return typeof value === 'string' && (V4.test(value) || (value.includes(':') && V6.test(value)))
}

const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : Number.NaN)

export function parseInitBody(body: unknown): ParsedBody<{ node: string; fields: Record<string, string> }> {
  const b = (body ?? {}) as Record<string, unknown>
  if (typeof b.node !== 'string' || !NODE_RE.test(b.node)) return { ok: false, error: 'Invalid node' }
  if (!isCidr(b.network)) return { ok: false, error: 'The public network must be a CIDR, such as 10.0.0.0/24' }
  const fields: Record<string, string> = { network: b.network }
  if (b.clusterNetwork !== undefined && b.clusterNetwork !== '') {
    if (!isCidr(b.clusterNetwork)) return { ok: false, error: 'The cluster network must be a CIDR, such as 10.1.0.0/24' }
    fields['cluster-network'] = b.clusterNetwork
  }
  const size = int(b.size)
  const minSize = int(b.minSize)
  if (!(size >= 1 && size <= POOL_MAX_SIZE)) return { ok: false, error: `Size must be a whole number from 1 to ${POOL_MAX_SIZE}` }
  if (!(minSize >= 1 && minSize <= size)) return { ok: false, error: 'Min. size must be a whole number from 1 to the size' }
  if (minSize === 1 && b.allowSingleCopy !== true) return { ok: false, error: 'Min. size 1 accepts writes on a single copy: confirm it explicitly' }
  fields.size = String(size)
  fields.min_size = String(minSize)
  return { ok: true, params: { node: b.node, fields } }
}
