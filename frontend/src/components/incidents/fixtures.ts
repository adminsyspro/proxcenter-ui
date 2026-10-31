import type { IncidentView } from '@/lib/incidents/types'

/** An incident as the register sends it, with overrides. */
export function makeIncident(over: Partial<IncidentView> = {}): IncidentView {
  return {
    id: 'i1',
    title: 'Node pve1 down',
    root_cause: '',
    impact: '',
    created_by: 'alice',
    created_at: '2026-10-27T10:00:00.000Z',
    updated_at: '2026-10-27T10:00:00.000Z',
    status: 'open',
    severity: 'critical',
    started_at: '2026-10-27T10:00:00.000Z',
    alerts: [
      { id: 'a1', type: 'node_down', resource: 'pve1', message: 'Node pve1 is down', first_seen_at: '2026-10-27T10:00:00.000Z', resolved_at: null },
      { id: 'a2', type: 'vm_down', resource: 'vm-100', message: 'VM 100 is down', first_seen_at: '2026-10-27T10:01:00.000Z', resolved_at: null },
    ],
    comments: [],
    actions: [],
    alert_count: 2,
    comment_count: 0,
    ...over,
  }
}
