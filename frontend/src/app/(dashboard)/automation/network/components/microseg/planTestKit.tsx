/**
 * Shared fixtures of the plan dialog tests: plan and apply runs as GET /runs/{id}
 * answers them, and the tab opened on its "View plan" button.
 */

import { screen, fireEvent } from '@/__tests__/setup/renderWithProviders'
import type { GuestRef, MicrosegRun, MicrosegRunResult, StepRef } from '@/lib/microseg/types'

import { GUESTS_ROUTE, mock, policy, renderTab, reply, resetMocks, zone, REVISION_HEAD } from './microsegTestKit'
import { vm } from './policyTestKit'

export const g101: GuestRef = { node: 'pve1', type: 'qemu', vmid: 101 }
export const g200: GuestRef = { node: 'pve2', type: 'lxc', vmid: 200 }

export const step = (index: number, kind: string, summary: string, guest?: GuestRef, error?: string): StepRef => ({
  index, kind, object: `obj${index}`, summary, ...(guest ? { guest } : {}), ...(error ? { error } : {}),
})

/** The default plan: two cluster steps, three steps on one guest, one on another. */
export const PLAN_STEPS: StepRef[] = [
  step(0, 'ipset.create', 'Create ipset pcz-web'),
  step(1, 'group.create', 'Create security group pcz-web'),
  step(2, 'guest.tags', 'Tag web1 with zone-web', g101),
  step(3, 'guest.nic', 'Turn the NIC firewall on for web1', g101),
  step(4, 'guest.group', 'Attach web1 to pcz-web', g101),
  step(5, 'guest.tags', 'Tag db1 with zone-db', g200),
]

export const planResult = (over: Partial<MicrosegRunResult> = {}): MicrosegRunResult => ({
  guests: 2, members: 2, steps: PLAN_STEPS.length, drifts: 0, plan: PLAN_STEPS, version: 3, ...over,
})

export const planRun = (over: Partial<MicrosegRunResult> = {}, status: MicrosegRun['status'] = 'done'): MicrosegRun => ({
  id: 'p1', policy_id: 'p1', kind: 'plan', status, started_at: '2026-11-02T10:00:00Z', duration_ms: 10, api_calls: 3, writes: 0,
  result: status === 'running' ? null : planResult(over), error: '',
})

export const applyRun = (over: Partial<MicrosegRunResult> = {}, status: MicrosegRun['status'] = 'done'): MicrosegRun => ({
  ...planRun(over, status), id: 'a1', kind: 'apply', writes: 6,
})

export const VMS = [vm(101, 'web1', ['zone-web']), vm(200, 'db1', ['zone-db'], { node: 'pve2', type: 'lxc', status: 'stopped' })]

/** Healthy defaults of a draft with unapplied changes, a plan route and the guests. */
export function resetPlanMocks(plan: MicrosegRun = planRun()) {
  resetMocks()
  mock.routes['GET /policy'] = () => reply(200, policy({ zones: [zone('a')], last_revision: REVISION_HEAD, pending_changes: true }))
  mock.routes['POST /plan'] = () => reply(202, { run_id: 'p1' })
  mock.routes['GET /runs/p1'] = () => reply(200, plan)
  mock.routes[`GET ${GUESTS_ROUTE}`] = () => reply(200, { data: { vms: VMS } })
}

/** Renders the tab and opens the plan window from the pending changes bar. */
export async function openPlanDialog() {
  renderTab()
  fireEvent.click(await screen.findByRole('button', { name: 'View plan' }))
  return screen.findByRole('dialog', { name: 'Micro-segmentation plan' })
}

