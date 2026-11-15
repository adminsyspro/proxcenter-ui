/**
 * Fixtures of the micro-segmentation lens tests: a deployed policy with two zones and one flow, its guests, the pending
 * suggestions, and sFlow pairs that cover every status.
 */

import type { MicrosegPolicy, MicrosegSuggestion, MicrosegZone } from '@/lib/microseg/types'
import {
  EXTERNAL_KEY, OTHER_KEY, UNZONED_KEY, buildResolver, canonicalRows, groupColor, pairVerdict, type LensPair,
} from '@/lib/microseg/trafficLens'

import type { TrafficLens } from './useTrafficLens'

export const zone = (id: string, color: string): MicrosegZone => ({
  id, policy_id: 'p1', name: id, label: '', color, enforcement: 'guest', vnet_id: '', state: 'observe',
  isolate_members: false, observe_since: null,
})

export const ZONES = [zone('web', '#3b82f6'), zone('db', '#10b981')]

export const POLICY: MicrosegPolicy = {
  policy: {
    id: 'p1', connection_id: 'c1', tag_prefix: 'zone-', version: 7, settings: {} as never, emergency_stop: false,
    created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-01T10:00:00Z', updated_by: 'me',
  },
  zones: ZONES,
  flows: [{
    id: 'f1', policy_id: 'p1', src_zone_id: 'web', src_cidr: '', dst_zone_id: 'db', dst_cidr: '', proto: 'tcp', dport: '5432',
    comment: '', origin: 'manual', created_by: 'me',
  }],
  pending_members: [],
  last_revision: { id: 'r1', version: 6, author: 'me', created_at: '2026-11-02T09:00:00Z' },
  version: 7,
  pending_changes: false,
}

const suggestion = (id: string, over: Partial<MicrosegSuggestion>): MicrosegSuggestion => ({
  id, policy_id: 'p1', kind: 'would_block', src_key: 'k', src_ip: '10.0.0.1', src_zone_id: 'web', dst_ip: '10.0.0.2',
  dst_zone_id: 'db', proto: 'tcp', dport: '22', hits: 4, first_seen: '2026-11-01T10:00:00Z', last_seen: '2026-11-02T10:00:00Z',
  status: 'pending', ...over,
})

export const SUGGESTIONS: MicrosegSuggestion[] = [
  suggestion('s1', {}),
  suggestion('b1', { kind: 'blocked', src_ip: '10.0.0.2', src_zone_id: 'db', dst_ip: '10.0.0.1', dst_zone_id: 'web', proto: 'udp', dport: '53', hits: 9 }),
]

/** The inventory route answer: web-01 in web, db-01 in db, lab in no zone. */
export const VMS = {
  data: {
    vms: [
      { vmid: 101, name: 'web-01', node: 'pve1', type: 'qemu', tags: ['zone-web'], ips: ['10.0.0.1'] },
      { vmid: 102, name: 'db-01', node: 'pve1', type: 'qemu', tags: ['zone-db'], ips: ['10.0.0.2'] },
      { vmid: 103, name: 'lab', node: 'pve1', type: 'lxc', tags: [], ips: ['10.0.0.3'] },
    ],
  },
}

const pair = (src: string, dst: string, protocol: string, port: number, bytes: number): LensPair => ({
  src_ip: src, dst_ip: dst, protocol, dst_port: port, bytes, packets: 1,
})

/** allowed, not covered with a would-block suggestion, not covered, blocked, unknown (unzoned), unknown (external). */
export const PAIRS: LensPair[] = [
  pair('10.0.0.1', '10.0.0.2', 'TCP', 5432, 4000),
  pair('10.0.0.1', '10.0.0.2', 'TCP', 22, 2000),
  pair('10.0.0.2', '10.0.0.1', 'TCP', 443, 1500),
  pair('10.0.0.2', '10.0.0.1', 'UDP', 53, 1000),
  pair('10.0.0.3', '10.0.0.2', 'TCP', 5432, 1000),
  pair('198.51.100.7', '10.0.0.1', 'TCP', 443, 500),
]

/** The lens the hook builds, with the English labels. */
export function makeLens(policy: MicrosegPolicy = POLICY, suggestions: MicrosegSuggestion[] = SUGGESTIONS): TrafficLens {
  const zonesById = new Map(policy.zones.map(z => [z.id, z]))
  const guests = VMS.data.vms.map(v => ({ vmid: v.vmid, name: v.name, tags: v.tags, ips: v.ips }))
  const resolve = buildResolver(policy.zones, policy.policy.tag_prefix, guests)
  const names: Record<string, string> = { [UNZONED_KEY]: 'Unzoned', [EXTERNAL_KEY]: 'Unknown / External', [OTHER_KEY]: 'Other' }
  return {
    connectionId: 'c1',
    policy,
    suggestions,
    zonesById,
    resolve,
    labelOf: key => names[key] ?? zonesById.get(key.replace(/^zone:/, ''))?.name ?? key,
    colorOf: key => groupColor(key, zonesById),
    verdictOf: p => pairVerdict(p, resolve, policy.flows, suggestions),
    rows: pairs => canonicalRows(pairs, p => pairVerdict(p, resolve, policy.flows, suggestions).status === 'allowed'),
  }
}

export const reply = (status: number, body: unknown) => ({
  ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body),
})
