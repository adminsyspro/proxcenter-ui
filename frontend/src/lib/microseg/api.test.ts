import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  forgetSharedReads, isPlanStale, MicrosegApiError, MicrosegConflictError, microsegApi, microsegErrorKey, microsegErrorKeyOf,
  RUN_READ_SHARE_MS,
} from './api'
import { isAggregateDst, zoneEgress } from './types'

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
  forgetSharedReads()
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

  it('wraps a network failure as NETWORK but lets an abort through', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const err = await microsegApi('c1').getPolicy().catch(e => e)
    expect(err).toBeInstanceOf(MicrosegApiError)
    expect(err).toMatchObject({ status: 0, code: 'NETWORK', serverMessage: 'Failed to fetch' })
    expect(microsegErrorKeyOf(err)).toBe('microsegPilot.errors.NETWORK')
    const abort = new DOMException('aborted', 'AbortError')
    fetchMock.mockRejectedValue(abort)
    expect(await microsegApi('c1').getRun('r1').catch(e => e)).toBe(abort)
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

  it('creates, edits and deletes an exception like a flow: the version in the body, the id in the path', async () => {
    const exception = {
      id: 'e1', policy_id: 'p1', zone_id: 'zd', sources: [{ type: 'qemu', vmid: 100, name: 'web-1' }],
      destinations: [{ type: 'lxc', vmid: 200, name: 'db-1' }], services: [{ proto: 'tcp', dport: '5432' }], comment: 'backup', created_by: 'admin',
    }
    fetchMock.mockResolvedValue(reply(200, { version: 6, exception }))
    const api = microsegApi('c1')
    const input = {
      version: 5, zone_id: 'zd', sources: [{ type: 'qemu' as const, vmid: 100, name: 'web-1' }],
      destinations: [{ type: 'lxc' as const, vmid: 200, name: 'db-1' }], services: [{ proto: 'tcp', dport: '5432' }], comment: 'backup',
    }
    await expect(api.saveException(input)).resolves.toEqual({ version: 6, exception })
    expect(lastCall()).toEqual({ url: '/api/v1/firewall/microseg/c1/exceptions', method: 'POST', body: input })
    await api.saveException({ id: 'e 1', ...input })
    expect(lastCall()).toEqual({ url: '/api/v1/firewall/microseg/c1/exceptions/e%201', method: 'PUT', body: input })
    fetchMock.mockResolvedValue(reply(200, { version: 7 }))
    await expect(api.deleteException('e1', 6)).resolves.toEqual({ version: 7 })
    expect(lastCall()).toEqual({ url: '/api/v1/firewall/microseg/c1/exceptions/e1', method: 'DELETE', body: { version: 6 } })
  })

  it('reads a policy without exceptions (an older orchestrator) as an empty list, and keeps the ones it gets', async () => {
    const api = microsegApi('c1')
    fetchMock.mockResolvedValue(reply(200, { zones: [], flows: [], version: 2 }))
    expect((await api.getPolicy()).exceptions).toEqual([])
    expect((await api.discardDraft(2)).exceptions).toEqual([])
    fetchMock.mockResolvedValue(reply(200, { zones: [], flows: [], exceptions: null, version: 2 }))
    expect((await api.getPolicy()).exceptions).toEqual([])
    fetchMock.mockResolvedValue(reply(200, { zones: [], flows: [], exceptions: [{ id: 'e1' }], version: 2 }))
    expect((await api.getPolicy()).exceptions).toEqual([{ id: 'e1' }])
    expect((await api.discardDraft(2)).exceptions).toEqual([{ id: 'e1' }])
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
    expect(await api.getDrifts()).toEqual({ drifts: [{ kind: 'foreign_accept' }], computed: true })
    fetchMock.mockResolvedValue(reply(200, { drifts: [], computed: false }))
    expect(await api.getDrifts()).toEqual({ drifts: [], computed: false })
    fetchMock.mockResolvedValue(reply(200, { drifts: null, computed: true }))
    expect(await api.getDrifts()).toEqual({ drifts: [], computed: true })
    fetchMock.mockResolvedValue(reply(200, { checks: [{ id: 'cluster_firewall', status: 'pass' }] }))
    expect(await api.getPreflight()).toEqual([{ id: 'cluster_firewall', status: 'pass' }])
    fetchMock.mockResolvedValue(reply(200, { ok: true, was_held: false }))
    expect(await api.confirmWrites()).toEqual({ ok: true, was_held: false })
  })
})

describe('microsegApi events', () => {
  it('builds the query of the event ring and fills the envelope', async () => {
    const api = microsegApi('c1')
    fetchMock.mockResolvedValue(reply(200, { events: [{ ts: '2026-11-03T10:00:00Z' }], truncated: true, oldest: '2026-11-03T10:00:00Z' }))
    expect(await api.getMicrosegEvents({ limit: 200, before: '2026-11-03T10:00:00+01:00', zone: 'web', verdict: 'would_block', q: '10.0.0.5' }))
      .toEqual({ events: [{ ts: '2026-11-03T10:00:00Z' }], truncated: true, oldest: '2026-11-03T10:00:00Z' })
    expect(lastCall().url).toBe('/api/v1/firewall/microseg/c1/events?limit=200&before=2026-11-03T10%3A00%3A00%2B01%3A00&zone=web&verdict=would_block&q=10.0.0.5')
    expect(lastCall().method).toBe('GET')
    fetchMock.mockResolvedValue(reply(200, { events: null }))
    expect(await api.getMicrosegEvents({ limit: 200 })).toEqual({ events: [], truncated: false, oldest: null })
    expect(lastCall().url).toBe('/api/v1/firewall/microseg/c1/events?limit=200')
    fetchMock.mockResolvedValue(reply(503, { code: 'NOT_LEADER', error: 'not the leader' }))
    expect(await api.getMicrosegEvents().catch(e => e)).toMatchObject({ status: 503, code: 'NOT_LEADER' })
  })
})

describe('microsegApi traffic history', () => {
  it('asks the persisted history for a window and a step, and fills the envelope', async () => {
    const api = microsegApi('c1')
    const body = { step: 300, from: '2026-11-03T09:00:00Z', to: '2026-11-03T10:00:00Z', buckets: [{ at: '2026-11-03T09:55:00Z', zone: 'db', src_zone: 'web', verdict: 'would_block', hits: 4 }] }
    fetchMock.mockResolvedValue(reply(200, body))
    expect(await api.getMicrosegTraffic({ from: body.from, to: body.to, step: 300 })).toEqual(body)
    expect(lastCall().url).toBe('/api/v1/firewall/microseg/c1/traffic?from=2026-11-03T09%3A00%3A00Z&to=2026-11-03T10%3A00%3A00Z&step=300')
    expect(lastCall().method).toBe('GET')
    fetchMock.mockResolvedValue(reply(200, { buckets: null }))
    expect(await api.getMicrosegTraffic({ from: body.from, to: body.to, step: 900 })).toEqual({ step: 900, from: body.from, to: body.to, buckets: [] })
    fetchMock.mockResolvedValue(reply(503, { code: 'NOT_LEADER', error: 'not the leader' }))
    expect(await api.getMicrosegTraffic({ from: body.from, to: body.to, step: 300 }).catch(e => e)).toMatchObject({ status: 503, code: 'NOT_LEADER' })
  })
})

describe('microsegApi sFlow volume', () => {
  it('asks the totals or the steps of a window, an empty zone filter included, and fills the envelope', async () => {
    const api = microsegApi('c1')
    const body = { step: 300, from: '2026-11-20T09:00:00Z', to: '2026-11-20T10:00:00Z', covered: true, buckets: [{ at: '2026-11-20T09:55:00Z', src_zone: 'web', dst_zone: 'db', proto: 'tcp', port: 5432, bytes: 10, packets: 1 }] }
    fetchMock.mockResolvedValue(reply(200, body))
    expect(await api.getMicrosegVolume({ from: body.from, to: body.to, totals: true })).toEqual(body)
    expect(lastCall().url).toBe('/api/v1/firewall/microseg/c1/volume?from=2026-11-20T09%3A00%3A00Z&to=2026-11-20T10%3A00%3A00Z&totals=1')
    await api.getMicrosegVolume({ from: 'a', to: 'b', step: 900, group: 'pair', src_zone: '', dst_zone: 'db', proto: 'tcp', port: 22 })
    expect(lastCall().url).toBe('/api/v1/firewall/microseg/c1/volume?from=a&to=b&step=900&group=pair&src_zone=&dst_zone=db&proto=tcp&port=22')
    fetchMock.mockResolvedValue(reply(200, { buckets: null }))
    expect(await api.getMicrosegVolume({ from: 'a', to: 'b' })).toEqual({ step: 300, from: 'a', to: 'b', covered: false, buckets: [] })
    fetchMock.mockResolvedValue(reply(400, { code: 'TOO_MANY_BUCKETS', error: 'raise step' }))
    expect(await api.getMicrosegVolume({ from: 'a', to: 'b', step: 300 }).catch(e => e)).toMatchObject({ status: 400, code: 'TOO_MANY_BUCKETS' })
  })

  it('asks the same volume by pair of guests, narrowed to guests (0: no guest), and leaves out a bucket naming none', async () => {
    const api = microsegApi('c1')
    const pair = { at: '2026-11-20T09:55:00Z', src_zone: 'web', dst_zone: 'db', proto: 'tcp', port: 5432, bytes: 10, packets: 1, src_vmid: 101, dst_vmid: 0 }
    const { src_vmid: _src, dst_vmid: _dst, ...byZone } = pair
    fetchMock.mockResolvedValue(reply(200, { step: 300, from: 'a', to: 'b', covered: true, buckets: [pair, byZone] }))
    expect(await api.getMicrosegVolumeGuests({ from: 'a', to: 'b', totals: true })).toEqual({ step: 300, from: 'a', to: 'b', covered: true, buckets: [pair] })
    expect(lastCall().url).toBe('/api/v1/firewall/microseg/c1/volume?group=guest&from=a&to=b&totals=1')
    await api.getMicrosegVolumeGuests({ from: 'a', to: 'b', step: 900, src_vmid: 101, dst_vmid: 0 })
    expect(lastCall().url).toBe('/api/v1/firewall/microseg/c1/volume?group=guest&from=a&to=b&step=900&src_vmid=101&dst_vmid=0')
    fetchMock.mockResolvedValue(reply(200, null))
    expect(await api.getMicrosegVolumeGuests({ from: 'a', to: 'b' })).toEqual({ step: 300, from: 'a', to: 'b', covered: false, buckets: [] })
    fetchMock.mockResolvedValue(reply(400, { code: 'TOO_MANY_BUCKETS', error: 'raise step' }))
    expect(await api.getMicrosegVolumeGuests({ from: 'a', to: 'b', totals: true }).catch(e => e)).toMatchObject({ status: 400, code: 'TOO_MANY_BUCKETS' })
  })
})

describe('microsegApi manual check', () => {
  it('posts an empty object to /check and returns the queued answer', async () => {
    fetchMock.mockResolvedValue(reply(202, { queued: true, requested_at: '2026-11-03T10:00:00Z' }))
    expect(await microsegApi('c1').checkNow()).toEqual({ queued: true, requested_at: '2026-11-03T10:00:00Z' })
    expect(lastCall()).toEqual({ url: '/api/v1/firewall/microseg/c1/check', method: 'POST', body: {} })
  })

  it('raises CHECK_PENDING on the 409 of a check already queued, with a message of its own', async () => {
    fetchMock.mockResolvedValue(reply(409, { code: 'CHECK_PENDING', error: 'a check is already queued' }))
    const err = await microsegApi('c1').checkNow().catch(e => e)
    expect(err).toBeInstanceOf(MicrosegApiError)
    expect(err).not.toBeInstanceOf(MicrosegConflictError)
    expect(err).toMatchObject({ status: 409, code: 'CHECK_PENDING' })
    expect(microsegErrorKeyOf(err)).toBe('microsegPilot.errors.CHECK_PENDING')
  })
})

describe('shared run reads', () => {
  it('sends one request for the reads of one run asked at once, and lets an aborted caller go alone', async () => {
    fetchMock.mockResolvedValue(reply(200, { id: 'r1', status: 'running' }))
    const api = microsegApi('c1')
    const controller = new AbortController()
    const aborted = api.getRun('r1', controller.signal).catch(e => e)
    controller.abort()
    const [a, b] = await Promise.all([api.getRun('r1'), microsegApi('c1').getRun('r1')])
    expect(a).toEqual({ id: 'r1', status: 'running' })
    expect(b).toBe(a)
    expect((await aborted).name).toBe('AbortError')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await api.getRun('r2')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reads the run again once the sharing time is over, after a success or a failure', async () => {
    vi.useFakeTimers()
    try {
      fetchMock.mockResolvedValueOnce(reply(502, { code: 'ORCHESTRATOR_ERROR', error: 'x' }))
      expect(await microsegApi('c1').getRun('r1').catch(e => e.code)).toBe('ORCHESTRATOR_ERROR')
      await vi.advanceTimersByTimeAsync(RUN_READ_SHARE_MS + 1)
      fetchMock.mockResolvedValue(reply(200, { id: 'r1' }))
      expect(await microsegApi('c1').getRun('r1')).toEqual({ id: 'r1' })
      await vi.advanceTimersByTimeAsync(RUN_READ_SHARE_MS + 1)
      await microsegApi('c1').getRun('r1')
      expect(fetchMock).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('isPlanStale', () => {
  it('is stale when the plan was computed from another draft version, or has none while the draft has one (Go omits version 0)', () => {
    expect(isPlanStale({ result: { version: 4 } as any }, 5)).toBe(true)
    expect(isPlanStale({ result: { version: 5 } as any }, 5)).toBe(false)
    expect(isPlanStale({ result: {} as any }, 5)).toBe(true)
    expect(isPlanStale({ result: {} as any }, 0)).toBe(false)
    expect(isPlanStale({ result: null }, 5)).toBe(false)
    expect(isPlanStale(null, 5)).toBe(false)
  })
})

describe('microsegApi resume refusal', () => {
  it('raises SOCLE_MISSING on the 409 of a resume without the management rules, with a message of its own and the server wording kept', async () => {
    fetchMock.mockResolvedValue(reply(409, { code: 'SOCLE_MISSING', error: 'SSH 22 rule is missing' }))
    const err = await microsegApi('c1').emergencyStop(false).catch(e => e)
    expect(lastCall()).toEqual({ url: '/api/v1/firewall/microseg/c1/emergency-stop', method: 'POST', body: { on: false } })
    expect(err).toBeInstanceOf(MicrosegApiError)
    expect(err).not.toBeInstanceOf(MicrosegConflictError)
    expect(err).toMatchObject({ status: 409, code: 'SOCLE_MISSING', serverMessage: 'SSH 22 rule is missing' })
    expect(microsegErrorKeyOf(err)).toBe('microsegPilot.errors.SOCLE_MISSING')
  })
})

describe('outbound filtering', () => {
  it('reads the outbound state of a zone: absent, or a zone neither observed nor enforced, is off', () => {
    expect(zoneEgress({ state: 'enforce' })).toBe('off')
    expect(zoneEgress({ state: 'disabled', egress_state: 'enforce' })).toBe('off')
    expect(zoneEgress({ state: 'observe', egress_state: 'observe' })).toBe('observe')
    expect(zoneEgress({ state: 'enforce', egress_state: 'enforce' })).toBe('enforce')
    expect(zoneEgress({ state: 'enforce', egress_state: 'off' })).toBe('off')
  })

  it('tells the aggregate destination from a zone or an address', () => {
    expect(isAggregateDst({ dst_key: '0.0.0.0/0' })).toBe(true)
    expect(isAggregateDst({ dst_key: '::/0' })).toBe(true)
    expect(isAggregateDst({ dst_key: '10.0.0.5' })).toBe(false)
    expect(isAggregateDst({ dst_key: 'z1' })).toBe(false)
    expect(isAggregateDst({})).toBe(false)
  })

  it('posts the outbound state with its version, and passes prefix_len and the direction filters', async () => {
    const api = microsegApi('c1')
    fetchMock.mockResolvedValue(reply(202, { run_id: 'r1' }))
    expect(await api.setZoneEgressState('z1', 'observe', 3)).toEqual({ run_id: 'r1' })
    expect(lastCall()).toMatchObject({ url: '/api/v1/firewall/microseg/c1/zones/z1/egress-state', method: 'POST', body: { state: 'observe', version: 3 } })
    fetchMock.mockResolvedValue(reply(200, { version: 4 }))
    await api.resolveSuggestions({ version: 4, ids: ['s1'], action: 'accept_cidr', prefix_len: 16 })
    expect(lastCall().body).toEqual({ version: 4, ids: ['s1'], action: 'accept_cidr', prefix_len: 16 })
    fetchMock.mockResolvedValue(reply(200, { suggestions: [], limit: 50, offset: 0 }))
    await api.listSuggestions({ direction: 'out', status: 'pending' })
    expect(lastCall().url).toBe('/api/v1/firewall/microseg/c1/suggestions?direction=out&status=pending')
    fetchMock.mockResolvedValue(reply(200, { buckets: [] }))
    await api.getMicrosegTraffic({ from: 'a', to: 'b', step: 300, direction: 'out' })
    expect(lastCall().url).toContain('&direction=out')
    await api.getMicrosegTraffic({ from: 'a', to: 'b', step: 300 })
    expect(lastCall().url).not.toContain('direction')
  })
})

describe('microsegApi clusters', () => {
  const answer = { clusters: [{ connection_id: 'c1', active: true, stop_cluster_disabled: false }], max: 8 }

  it('lists the clusters of the policy', async () => {
    fetchMock.mockResolvedValue(reply(200, answer))
    expect(await microsegApi('c1').listClusters()).toEqual(answer)
    expect(lastCall()).toMatchObject({ url: '/api/v1/firewall/microseg/c1/clusters', method: 'GET' })
  })

  it('associates a cluster with exactly its connection id', async () => {
    fetchMock.mockResolvedValue(reply(201, answer))
    expect(await microsegApi('c1').associateCluster('c2')).toEqual(answer)
    expect(lastCall()).toEqual({ url: '/api/v1/firewall/microseg/c1/clusters', method: 'POST', body: { connection_id: 'c2' } })
  })

  it('dissociates a cluster', async () => {
    fetchMock.mockResolvedValue(reply(200, answer))
    await microsegApi('c1').dissociateCluster('c 2')
    expect(lastCall()).toMatchObject({ url: '/api/v1/firewall/microseg/c1/clusters/c%202', method: 'DELETE' })
  })

  it.each(['CLUSTER_NOT_EMPTY', 'TOO_MANY_CLUSTERS', 'CLUSTER_UNREADABLE'])('has a message for %s', (code) => {
    expect(microsegErrorKey(code)).toBe(`microsegPilot.errors.${code}`)
  })
})
