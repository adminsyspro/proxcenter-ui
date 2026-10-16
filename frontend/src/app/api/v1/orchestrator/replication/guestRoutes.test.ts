/**
 * The four per-guest Site Recovery routes (ui#943) share one body: permission,
 * tenant scope, the orchestrator call, an audit row and the upstream-error
 * passthrough. These tests pin what each route sends, what reaches the audit
 * log, and that a refusal keeps the orchestrator's own sentence.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ action: vi.fn(), permission: vi.fn(), audit: vi.fn(), scope: vi.fn() }))

vi.mock('@/lib/rbac', () => ({ checkPermission: mocks.permission, PERMISSIONS: { AUTOMATION_MANAGE: 'automation.manage' } }))
vi.mock('@/lib/audit', () => ({ audit: mocks.audit }))
vi.mock('@/lib/orchestrator/planTenantScope', () => ({ checkPlanTenantScope: mocks.scope }))
vi.mock('@/lib/orchestrator/client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/orchestrator/client')>()

  return {
    ...actual,
    getOrchestratorClient: () => ({
      guestFailover: mocks.action,
      guestFailback: mocks.action,
      guestFailbackCutover: mocks.action,
      guestFailbackCancel: mocks.action,
    }),
  }
})

import { POST as failover } from './plans/[id]/guests/[vmid]/failover/route'
import { POST as failback } from './plans/[id]/guests/[vmid]/failback/route'
import { POST as cutover } from './plans/[id]/guests/[vmid]/failback-cutover/route'
import { POST as cancel } from './plans/[id]/guests/[vmid]/failback-cancel/route'

const params = (vmid = '9943') => ({ params: Promise.resolve({ id: 'plan-1', vmid }) })
const request = (body?: unknown) => new NextRequest('http://localhost', { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.permission.mockResolvedValue(null)
  mocks.audit.mockResolvedValue('audit-1')
  mocks.scope.mockResolvedValue({ denied: null, plan: { id: 'plan-1', name: 'i943-plan', vms: [{ vm_id: 9943, vm_name: 'i943-a' }] } })
})

describe('per-guest failover route', () => {
  it('relays the restore point to the orchestrator and audits the guest by name', async () => {
    mocks.action.mockResolvedValue({ data: { id: 'exec-1', scope_vmid: 9943 } })

    const response = await failover(request({ restore_point: 'mirror-20261014100809' }), params())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: 'exec-1', scope_vmid: 9943 })
    expect(mocks.action).toHaveBeenCalledWith('plan-1', 9943, { restore_point: 'mirror-20261014100809' })
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'dr.guest_failover',
      category: 'vms',
      resourceType: 'recovery_plan_guest',
      resourceId: 'plan-1:9943',
      resourceName: 'i943-a (i943-plan)',
      status: 'success',
      details: expect.objectContaining({ plan_id: 'plan-1', vm_id: 9943, restore_point: 'mirror-20261014100809' }),
    }))
  })

  it('relays and audits the restore point only: a forged body cannot rewrite the audit row', async () => {
    mocks.action.mockResolvedValue({ data: { id: 'exec-1' } })

    await failover(request({ restore_point: 'mirror-1', plan_id: 'forged', plan_name: 'forged', vm_id: 1, extra: 'x'.repeat(10_000) }), params())

    expect(mocks.action).toHaveBeenCalledWith('plan-1', 9943, { restore_point: 'mirror-1' })
    const details = mocks.audit.mock.calls[0][0].details
    expect(details).toEqual({ restore_point: 'mirror-1', plan_id: 'plan-1', plan_name: 'i943-plan', vm_id: 9943 })
  })

  it('sends no body without a restore point, and bounds its length', async () => {
    mocks.action.mockResolvedValue({ data: {} })

    await failover(request({ restore_point: 42 }), params())
    expect(mocks.action).toHaveBeenLastCalledWith('plan-1', 9943, undefined)

    await failover(request({ restore_point: 'm'.repeat(500) }), params())
    expect(mocks.action.mock.calls.at(-1)?.[2].restore_point).toHaveLength(128)
  })

  it('refuses a guest that is not a VMID before calling anything', async () => {
    const response = await failover(request({}), params('abc'))

    expect(response.status).toBe(400)
    expect(mocks.action).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('keeps the orchestrator refusal and audits the failure', async () => {
    mocks.action.mockRejectedValue(new Error('Orchestrator 409: {"error":"this guest is failed over: use the failback to bring it back to the source site"}'))

    const response = await failover(request({}), params())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'this guest is failed over: use the failback to bring it back to the source site' })
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'dr.guest_failover', status: 'failure', details: expect.objectContaining({ http_status: 409 }) }))
  })

  it('denies without the automation permission, calling nothing', async () => {
    const { NextResponse } = await import('next/server')

    mocks.permission.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))

    const response = await failover(request({}), params())

    expect(response.status).toBe(403)
    expect(mocks.action).not.toHaveBeenCalled()
  })

  it('hides a plan outside the tenant', async () => {
    const { NextResponse } = await import('next/server')

    mocks.scope.mockResolvedValue({ denied: NextResponse.json({ error: 'Not found' }, { status: 404 }), plan: null })

    const response = await failover(request({}), params())

    expect(response.status).toBe(404)
    expect(mocks.action).not.toHaveBeenCalled()
  })
})

describe.each([
  ['failback', failback, 'dr.guest_failback'],
  ['failback-cutover', cutover, 'dr.guest_failback_cutover'],
  ['failback-cancel', cancel, 'dr.guest_failback_cancel'],
] as const)('per-guest %s route', (_name, route, auditAction) => {
  it('calls the orchestrator for that guest and audits it', async () => {
    mocks.action.mockResolvedValue({ data: { plan_id: 'plan-1', vm_id: 9943 } })

    const response = await route(request(), params())

    expect(response.status).toBe(200)
    expect(mocks.action).toHaveBeenCalledWith('plan-1', 9943)
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: auditAction, resourceId: 'plan-1:9943', status: 'success' }))
  })

  it('passes a 409 through with its reason', async () => {
    mocks.action.mockRejectedValue(new Error('Orchestrator 409: {"error":"no active failback for this plan"}'))

    const response = await route(request(), params())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'no active failback for this plan' })
  })
})
