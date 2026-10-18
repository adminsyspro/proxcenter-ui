/**
 * The per-guest Site Recovery actions (ui#943): what each one sends, how a
 * refusal keeps the orchestrator's own reason, and how a guest's DR state
 * is read off its plan.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  GuestActionError,
  cancelGuestFailback,
  countGuestsFailedOver,
  cutoverGuestFailback,
  failoverGuest,
  guestStateOf,
  startGuestFailback,
} from './emergencyActions'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function ok(payload: unknown = {}) {
  return { ok: true, status: 200, json: async () => payload }
}

function fail(status: number, payload: unknown = {}) {
  return { ok: false, status, statusText: 'Conflict', json: async () => payload }
}

describe('guest DR state read off the plan', () => {
  const plan = {
    guests: [
      { vm_id: 100, state: 'failed_over', execution_id: 'exec-1' },
      { vm_id: 101, state: 'failing_back', execution_id: 'exec-2' },
      { vm_id: 102, state: 'failed_over', execution_id: '' },
    ],
  }

  it('returns the state and the execution acting on the guest', () => {
    expect(guestStateOf(plan, 101)).toEqual({ state: 'failing_back', executionId: 'exec-2' })
  })

  it('answers null for a guest that simply replicates, and for a plan without states', () => {
    expect(guestStateOf(plan, 103)).toBeNull()
    expect(guestStateOf({}, 100)).toBeNull()
    expect(guestStateOf(null, 100)).toBeNull()
  })

  it('counts the guests on the DR site: failed over or failing back, not one still failing over', () => {
    expect(countGuestsFailedOver(plan)).toBe(3)
    expect(countGuestsFailedOver({ guests: [{ vm_id: 1, state: 'failing_over' }] })).toBe(0)
    expect(countGuestsFailedOver(undefined)).toBe(0)
  })
})

describe('per-guest actions', () => {
  it('fails one guest over from the latest state when no restore point is picked', async () => {
    fetchMock.mockResolvedValue(ok({ id: 'exec-1', type: 'failover', scope_vmid: 9943 }))

    const exec = await failoverGuest('plan-1', 9943)

    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/orchestrator/replication/plans/plan-1/guests/9943/failover')
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({})
    expect(exec.scope_vmid).toBe(9943)
  })

  it('sends the chosen restore point with the failover', async () => {
    fetchMock.mockResolvedValue(ok({}))

    await failoverGuest('plan-1', 9943, 'mirror-20261014100809')

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ restore_point: 'mirror-20261014100809' })
  })

  it('starts, cuts over and cancels the failback of one guest on its own routes, without a body', async () => {
    fetchMock.mockResolvedValue(ok({}))

    await startGuestFailback('plan-1', 9943)
    await cutoverGuestFailback('plan-1', 9943)
    await cancelGuestFailback('plan-1', 9943)

    expect(fetchMock.mock.calls.map(c => c[0])).toEqual([
      '/api/v1/orchestrator/replication/plans/plan-1/guests/9943/failback',
      '/api/v1/orchestrator/replication/plans/plan-1/guests/9943/failback-cutover',
      '/api/v1/orchestrator/replication/plans/plan-1/guests/9943/failback-cancel',
    ])
    for (const call of fetchMock.mock.calls) expect(call[1].body).toBeUndefined()
  })

  it('surfaces the orchestrator refusal as it comes, with its status', async () => {
    fetchMock.mockResolvedValue(fail(409, { error: 'an execution is already running on this guest, wait for it to finish' }))

    await expect(failoverGuest('plan-1', 9943)).rejects.toMatchObject({
      message: 'an execution is already running on this guest, wait for it to finish',
      status: 409,
    })
    await expect(failoverGuest('plan-1', 9943)).rejects.toBeInstanceOf(GuestActionError)
  })

  it('falls back to a generic message when the refusal carries none', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error', json: async () => { throw new Error('not json') } })

    await expect(startGuestFailback('plan-1', 9943)).rejects.toThrow('Failed to start the guest failback')
  })
})
