// dispatchAction never throws: a card no route maps is a 500 result, like a
// handler that throws, so the execute route answers it as a route refusal.
import { describe, expect, it } from 'vitest'

import { dispatchAction, routeFor, upidOf } from './dispatch'
import type { ActionCard } from './types'

const base: ActionCard = {
  actionId: 'a1',
  kind: 'maintenance',
  tier: 'disruptive',
  target: { connId: 'c1', cluster: 'PVE-PROD', node: 'pve2', name: 'pve2' },
  params: { mode: 'sideways' },
  preflight: { ok: true, checks: [] },
  expiresAt: Date.now() + 60_000,
  token: 't',
}

describe('dispatchAction', () => {
  it('turns a card no route maps into a 500 result instead of a throw', async () => {
    await expect(dispatchAction(base)).resolves.toEqual({ httpStatus: 500, body: { error: 'Unknown maintenance mode "sideways"' } })
  })

  it('refuses a guest kind without a guest target', () => {
    expect(() => routeFor({ ...base, kind: 'reboot', params: {} })).toThrow('A reboot card needs a guest target')
  })

  it('maps the guest routes with encoded segments', () => {
    const g = { ...base, kind: 'snapshot' as const, target: { ...base.target, node: 'pve1', vmid: 104, guestKind: 'qemu' as const, name: 'w' }, params: { name: 'n1' } }

    expect(routeFor(g)).toMatchObject({ method: 'POST', path: '/api/v1/guests/c1%3Aqemu%3Apve1%3A104/snapshots', params: { vmid: 'c1:qemu:pve1:104' }, body: { name: 'n1' } })
    expect(routeFor({ ...g, kind: 'backup_add', params: { jobId: 'job 1' } })).toMatchObject({ path: '/api/v1/connections/c1/backup-jobs/job%201/guests', body: { vmid: 104 } })
  })

  it('reads a task id from data or data.upid only', () => {
    expect(upidOf({ data: 'UPID:pve1:1' })).toBe('UPID:pve1:1')
    expect(upidOf({ data: { upid: 'UPID:pve1:2' } })).toBe('UPID:pve1:2')
    expect(upidOf({ data: 'not-a-task' })).toBeUndefined()
    expect(upidOf(null)).toBeUndefined()
  })
})
