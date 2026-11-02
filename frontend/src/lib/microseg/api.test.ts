import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  isPlanStale, MicrosegApiError, MicrosegConflictError, microsegApi, microsegErrorKey, microsegErrorKeyOf,
} from './api'

const fetchMock = vi.fn()
const reply = (status: number, body?: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)),
})
const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
  return { url, method: init.method, body: init.body ? JSON.parse(init.body as string) : undefined }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('microsegApi errors', () => {
  it('throws MicrosegConflictError on 409 VERSION_CONFLICT', async () => {
    fetchMock.mockResolvedValue(reply(409, { code: 'VERSION_CONFLICT', error: 'version conflict' }))
    const err = await microsegApi('c1').saveZone({ version: 3, name: 'web', enforcement: 'guest' }).catch(e => e)
    expect(err).toBeInstanceOf(MicrosegConflictError)
    expect(err).toBeInstanceOf(MicrosegApiError)
    expect(err).toMatchObject({ status: 409, code: 'VERSION_CONFLICT', serverMessage: 'version conflict' })
  })

  it.each([
    [409, 'BUSY'], [409, 'ZONE_NAME_TAKEN'], [409, 'IN_USE'], [400, 'INVALID'], [413, 'INVALID'],
    [403, 'FEATURE_REQUIRED'], [503, 'NOT_LEADER'], [503, 'ENGINE_STOPPED'], [502, 'PVE_ERROR'],
  ])('throws a MicrosegApiError carrying the code on %i %s', async (status, code) => {
    fetchMock.mockResolvedValue(reply(status, { code, error: 'nope' }))
    const err = await microsegApi('c1').getPolicy().catch(e => e)
    expect(err).toBeInstanceOf(MicrosegApiError)
    expect(err).not.toBeInstanceOf(MicrosegConflictError)
    expect(err).toMatchObject({ status, code, serverMessage: 'nope', message: 'nope' })
  })

  it('derives a code from the status when the body has none', async () => {
    fetchMock.mockResolvedValue(reply(404, { error: 'Not found' }))
    expect(await microsegApi('c1').getRun('r1').catch(e => e)).toMatchObject({ status: 404, code: 'NOT_FOUND' })
    fetchMock.mockResolvedValue(reply(401, 'not json'))
    expect(await microsegApi('c1').getStatus().catch(e => e)).toMatchObject({ status: 401, code: 'UNAUTHORIZED' })
  })

  it('maps codes to i18n keys with a generic fallback', () => {
    expect(microsegErrorKey('VERSION_CONFLICT')).toBe('microsegPilot.errors.VERSION_CONFLICT')
    expect(microsegErrorKey('ORCHESTRATOR_TIMEOUT')).toBe('microsegPilot.errors.ORCHESTRATOR_TIMEOUT')
    expect(microsegErrorKey('SOMETHING_NEW')).toBe('microsegPilot.errors.generic')
    expect(microsegErrorKey(undefined)).toBe('microsegPilot.errors.generic')
    expect(microsegErrorKeyOf(new MicrosegApiError(409, 'BUSY'))).toBe('microsegPilot.errors.BUSY')
    expect(microsegErrorKeyOf(new Error('boom'))).toBe('microsegPilot.errors.generic')
  })
})

describe('microsegApi requests', () => {
  it('treats 202 {run_id} as a success for plan, apply, state, restore and remove', async () => {
    fetchMock.mockResolvedValue(reply(202, { run_id: 'r1' }))
    const api = microsegApi('c 1')
    expect(await api.startPlan()).toEqual({ run_id: 'r1' })
    expect(lastCall()).toMatchObject({ url: '/api/v1/firewall/microseg/c%201/plan', method: 'POST', body: undefined })
    expect(await api.startApply(7)).toEqual({ run_id: 'r1' })
    expect(lastCall()).toMatchObject({ url: '/api/v1/firewall/microseg/c%201/apply', method: 'POST', body: { version: 7 } })
    expect(await api.setZoneState('z1', 'observe', 7)).toEqual({ run_id: 'r1' })
    expect(lastCall()).toMatchObject({ url: '/api/v1/firewall/microseg/c%201/zones/z1/state', body: { version: 7, state: 'observe' } })
    expect(await api.restoreRevision('rev1', 7)).toEqual({ run_id: 'r1' })
    expect(lastCall()).toMatchObject({ url: '/api/v1/firewall/microseg/c%201/revisions/rev1/restore', body: { version: 7 } })
    expect(await api.startRemove()).toEqual({ run_id: 'r1' })
    expect(lastCall()).toMatchObject({ url: '/api/v1/firewall/microseg/c%201/remove', method: 'POST' })
  })

  it('accepts 200 and 202 for the emergency stop and sends on', async () => {
    const api = microsegApi('c1')
    fetchMock.mockResolvedValue(reply(200, { accepted: true, applied_by: 'self', on: true }))
    expect(await api.emergencyStop(true)).toEqual({ accepted: true, applied_by: 'self', on: true })
    expect(lastCall()).toMatchObject({ url: '/api/v1/firewall/microseg/c1/emergency-stop', method: 'POST', body: { on: true } })
    fetchMock.mockResolvedValue(reply(202, { accepted: true, applied_by: 'leader', on: false }))
    expect(await api.emergencyStop(false)).toEqual({ accepted: true, applied_by: 'leader', on: false })
    expect(lastCall().body).toEqual({ on: false })
  })

  it('creates or edits a zone with the version in the body and the id in the path', async () => {
    fetchMock.mockResolvedValue(reply(200, { version: 4, zone: { id: 'z1' } }))
    const api = microsegApi('c1')
    await api.saveZone({ version: 3, name: 'web', enforcement: 'guest', label: 'Web' })
    expect(lastCall()).toMatchObject({ url: '/api/v1/firewall/microseg/c1/zones', method: 'POST', body: { version: 3, name: 'web', enforcement: 'guest', label: 'Web' } })
    await api.saveZone({ id: 'z1', version: 4, name: 'web', enforcement: 'vnet', vnet_id: 'v1' })
    expect(lastCall()).toMatchObject({ url: '/api/v1/firewall/microseg/c1/zones/z1', method: 'PUT', body: { version: 4, name: 'web', enforcement: 'vnet', vnet_id: 'v1' } })
    expect(lastCall().body).not.toHaveProperty('id')
  })

  it('sends the version on the deletes and on the flow writes', async () => {
    fetchMock.mockResolvedValue(reply(200, { version: 5 }))
    const api = microsegApi('c1')
    await api.deleteZone('z1', 4)
    expect(lastCall()).toMatchObject({ url: '/api/v1/firewall/microseg/c1/zones/z1', method: 'DELETE', body: { version: 4 } })
    await api.deleteFlow('f1', 5)
    expect(lastCall()).toMatchObject({ url: '/api/v1/firewall/microseg/c1/flows/f1', method: 'DELETE', body: { version: 5 } })
    await api.saveFlow({ version: 5, proto: 'tcp', src_zone_id: 'a', dst_zone_id: 'b', dport: '443' })
    expect(lastCall()).toMatchObject({ url: '/api/v1/firewall/microseg/c1/flows', method: 'POST', body: { version: 5, proto: 'tcp', src_zone_id: 'a', dst_zone_id: 'b', dport: '443' } })
    await api.saveFlow({ id: 'f1', version: 5, proto: 'udp' })
    expect(lastCall()).toMatchObject({ url: '/api/v1/firewall/microseg/c1/flows/f1', method: 'PUT' })
  })

  it('sends members with an empty zone_id to remove, resolve with ids and action', async () => {
    fetchMock.mockResolvedValue(reply(200, { version: 6 }))
    const api = microsegApi('c1')
    await api.setMembers({ version: 5, zone_id: '', guests: [{ node: 'pve1', type: 'qemu', vmid: 100 }] })
    expect(lastCall()).toMatchObject({ url: '/api/v1/firewall/microseg/c1/members', body: { version: 5, zone_id: '', guests: [{ node: 'pve1', type: 'qemu', vmid: 100 }] } })
    await api.resolveSuggestions({ version: 6, ids: ['s1'], action: 'accept_cidr' })
    expect(lastCall()).toMatchObject({ url: '/api/v1/firewall/microseg/c1/suggestions/resolve', body: { version: 6, ids: ['s1'], action: 'accept_cidr' } })
    await api.savePolicy({ version: 6, tag_prefix: 'zone-', settings: { write_cap: 10 } })
    expect(lastCall()).toMatchObject({ url: '/api/v1/firewall/microseg/c1/policy', method: 'PUT', body: { version: 6, tag_prefix: 'zone-', settings: { write_cap: 10 } } })
  })

  it('builds the list queries and unwraps the envelopes', async () => {
    const api = microsegApi('c1')
    fetchMock.mockResolvedValue(reply(200, { runs: [], limit: 20, offset: 40 }))
    expect(await api.listRuns({ limit: 20, offset: 40 })).toEqual({ runs: [], limit: 20, offset: 40 })
    expect(lastCall().url).toBe('/api/v1/firewall/microseg/c1/runs?limit=20&offset=40')
    fetchMock.mockResolvedValue(reply(200, { suggestions: [], limit: 50, offset: 0 }))
    await api.listSuggestions({ kind: 'would_block', status: 'pending', zone: 'z1' })
    expect(lastCall().url).toBe('/api/v1/firewall/microseg/c1/suggestions?kind=would_block&status=pending&zone=z1')
    fetchMock.mockResolvedValue(reply(200, { revisions: [{ id: 'r' }] }))
    expect(await api.listRevisions(1)).toEqual([{ id: 'r' }])
    expect(lastCall().url).toBe('/api/v1/firewall/microseg/c1/revisions?limit=1')
    fetchMock.mockResolvedValue(reply(200, { drifts: [{ kind: 'foreign_accept' }] }))
    expect(await api.getDrifts()).toEqual([{ kind: 'foreign_accept' }])
    fetchMock.mockResolvedValue(reply(200, { checks: [{ id: 'cluster_firewall', status: 'pass' }] }))
    expect(await api.getPreflight()).toEqual([{ id: 'cluster_firewall', status: 'pass' }])
    fetchMock.mockResolvedValue(reply(200, { ok: true, was_held: false }))
    expect(await api.confirmWrites()).toEqual({ ok: true, was_held: false })
  })
})

describe('isPlanStale', () => {
  it('is stale only when the plan was computed from another draft version', () => {
    expect(isPlanStale({ result: { version: 4 } as any }, 5)).toBe(true)
    expect(isPlanStale({ result: { version: 5 } as any }, 5)).toBe(false)
    expect(isPlanStale({ result: {} as any }, 5)).toBe(false)
    expect(isPlanStale({ result: null }, 5)).toBe(false)
    expect(isPlanStale(null, 5)).toBe(false)
  })
})
