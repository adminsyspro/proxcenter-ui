/**
 * useZoneEdits: every write of the zone panel and of the Policy sub-tab carries the draft version, reads the policy and
 * the status again on success, reads the policy again and rethrows on a VERSION_CONFLICT, and keeps the server's 400.
 */

import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { SWRConfig } from 'swr'
import type { ReactNode } from 'react'

import { MicrosegApiError } from '@/lib/microseg/api'
import type { MicrosegException } from '@/lib/microseg/types'
import { useMicrosegStatus } from '@/lib/microseg/useMicrosegStatus'
import enMessages from '@/messages/en.json'

import { exceptionDraft, type ExceptionDraft } from './exceptionModel'
import { calls, fetchMock, flow, mock, policy, reply, zone, REVISION_HEAD } from './microsegTestKit'
import { body, installFreshMocks } from './policyTestKit'
import { InboundRunFailedError } from './dialogParts'
import { useZoneEdits, zoneStateChanges, type ZoneEditsInput } from './useZoneEdits'

installFreshMocks()

const web = zone('zw', { name: 'web', state: 'disabled' })
const draft = policy({ zones: [web], last_revision: REVISION_HEAD })
const ref = { node: 'pve1', type: 'qemu' as const, vmid: 100 }
const values = { name: 'web', label: 'front', color: '#ef4444', isolate_members: true, state: 'disabled' as const, egress_state: 'off' as const, egress_mode: 'all' as const, gateway: '', gateway_services: [], exceptions: [], removed_exceptions: [] }
const app1 = { type: 'qemu' as const, vmid: 101, name: 'app-01' }
const db1 = { type: 'qemu' as const, vmid: 201, name: 'db-01' }
const stored = (id: string): MicrosegException => ({
  id, policy_id: 'p1', zone_id: 'zw', sources: [app1], destinations: [db1], services: [{ proto: 'tcp', dport: '5432' }], comment: '', created_by: 'me',
})
const [e1, e2, e3] = ['e1', 'e2', 'e3'].map(stored)
const withExceptions = { ...draft, exceptions: [e1, e2, e3] }
const flowValues = { src_zone_id: 'zw', src_cidr: '', dst_zone_id: 'zw', dst_cidr: '', proto: 'tcp', dport: '22', comment: '', origin: 'manual' }

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale='en' messages={enMessages as Record<string, unknown>}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
    </NextIntlClientProvider>
  )
}

function setup(over: Partial<ZoneEditsInput> = {}) {
  const reloadPolicy = vi.fn(async () => undefined)
  const startRun = vi.fn()
  // The status is read by the banner of the tab: a subscriber here shows the write reads it again.
  const view = renderHook(() => {
    useMicrosegStatus('c1', 0)
    return useZoneEdits({ connectionId: 'c1', policy: draft, reloadPolicy, startRun, ...over })
  }, { wrapper })
  return { ...view, reloadPolicy, startRun }
}

const refused = async (action: Promise<unknown>) => {
  try {
    await action
  } catch (e) {
    return e
  }
  throw new Error('the write did not fail')
}

describe('useZoneEdits', () => {
  it('saves a zone with the draft version and its fixed fields, then reads the policy and the status again', async () => {
    mock.routes['PUT /zones/zw'] = () => reply(200, { version: 4, zone: web })
    const { result, reloadPolicy } = setup()
    await waitFor(() => expect(calls('GET /status')).toHaveLength(1))
    await act(() => result.current.saveZone(web, values))
    expect(body(calls('PUT /zones/zw')[0][1] as RequestInit)).toEqual({
      version: 3, name: 'web', label: 'front', color: '#ef4444', enforcement: 'guest', vnet_id: '', isolate_members: true, egress_mode: 'all', gateway: '',
    })
    expect(reloadPolicy).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(calls('GET /status')).toHaveLength(2))
  })

  it('creates a zone with POST when there is none to edit', async () => {
    mock.routes['POST /zones'] = () => reply(200, { version: 4, zone: web })
    const { result } = setup()
    await act(() => result.current.saveZone(null, values))
    expect(body(calls('POST /zones')[0][1] as RequestInit).version).toBe(3)
  })

  it('creates the flows to the gateway with a new zone, one per protocol, each with the version the write before returned', async () => {
    mock.routes['POST /zones'] = () => reply(200, { version: 4, zone: zone('zn', { name: 'app' }) })
    let v = 4
    mock.routes['POST /flows'] = () => reply(200, { version: ++v, flow: {} })
    const { result } = setup()
    await act(() => result.current.saveZone(null, { ...values, name: 'app', gateway: ' 10.30.0.1 ', gateway_services: ['dns', 'ping'] }))
    expect(body(calls('POST /zones')[0][1] as RequestInit).gateway).toBe('10.30.0.1')
    const sent = calls('POST /flows').map(c => body(c[1] as RequestInit))
    expect(sent.map(f => [f.version, f.src_zone_id, f.dst_cidr, f.proto, f.dport])).toEqual([
      [4, 'zn', '10.30.0.1/32', 'udp', '53'], [5, 'zn', '10.30.0.1/32', 'tcp', '53'], [6, 'zn', '10.30.0.1/32', 'icmp', ''],
    ])
    expect(sent[0].comment).toBe('Gateway of the zone')
  })

  it('creates a typed service as its own flow, once when a listed service names the same port', async () => {
    mock.routes['PUT /zones/zw'] = () => reply(200, { version: 4, zone: web })
    let v = 4
    mock.routes['POST /flows'] = () => reply(200, { version: ++v, flow: {} })
    const { result } = setup()
    await act(() => result.current.saveZone(web, { ...values, gateway: '10.30.0.1', gateway_services: ['ssh', 'tcp/22', 'tcp/8443'] }))
    expect(calls('POST /flows').map(c => [body(c[1] as RequestInit).proto, body(c[1] as RequestInit).dport])).toEqual([['tcp', '22'], ['tcp', '8443']])
  })

  it('creates no flow to the gateway the draft already allows, nor any without a gateway', async () => {
    const withDns = { ...draft, flows: [{ ...flow('f1'), src_zone_id: 'zw', src_cidr: '', dst_zone_id: '', dst_cidr: '10.30.0.1/32', proto: 'udp', dport: '53' }] }
    mock.routes['PUT /zones/zw'] = () => reply(200, { version: 4, zone: web })
    mock.routes['POST /flows'] = () => reply(200, { version: 5, flow: {} })
    const { result } = setup({ policy: withDns })
    await act(() => result.current.saveZone(web, { ...values, gateway: '10.30.0.1', gateway_services: ['dns'] }))
    expect(calls('POST /flows').map(c => [body(c[1] as RequestInit).proto, body(c[1] as RequestInit).dport])).toEqual([['tcp', '53']])
    await act(() => result.current.saveZone(web, { ...values, gateway: '', gateway_services: ['dns', 'ntp', 'ping'] }))
    expect(calls('POST /flows')).toHaveLength(1)
  })

  it('writes the exception of a new zone after the zone, with the version the zone write returned', async () => {
    mock.routes['POST /zones'] = () => reply(200, { version: 4, zone: zone('zn', { name: 'app' }) })
    mock.routes['POST /exceptions'] = () => reply(200, { version: 5, exception: {} })
    const { result } = setup()
    const exception = { sources: [app1], destinations: [db1], services: ['postgresql', 'tcp/5432', 'ping'], comment: '' }
    await act(() => result.current.saveZone(null, { ...values, name: 'app', exceptions: [exception] }))
    expect(calls('POST /zones')).toHaveLength(1)
    expect(calls('POST /exceptions').map(c => body(c[1] as RequestInit))).toEqual([{
      version: 4, zone_id: 'zn', sources: [app1], destinations: [db1], comment: '',
      // A service named twice is sent once; a ping is ICMP and ICMPv6.
      services: [{ proto: 'tcp', dport: '5432' }, { proto: 'icmp', dport: '' }, { proto: 'icmpv6', dport: '' }],
    }])
  })

  it('writes the exceptions after the flows to the gateway, each write with the version of the one before', async () => {
    mock.routes['POST /zones'] = () => reply(200, { version: 4, zone: zone('zn', { name: 'app' }) })
    let v = 4
    mock.routes['POST /flows'] = () => reply(200, { version: ++v, flow: {} })
    mock.routes['POST /exceptions'] = () => reply(200, { version: ++v, exception: {} })
    const { result } = setup()
    const one = { sources: [app1], destinations: [db1], services: ['ssh'], comment: '' }
    await act(() => result.current.saveZone(null, { ...values, name: 'app', gateway: '10.30.0.1', gateway_services: ['ntp'], exceptions: [one, { ...one, services: ['https'] }] }))
    expect(calls('POST /flows').map(c => body(c[1] as RequestInit).version)).toEqual([4])
    expect(calls('POST /exceptions').map(c => body(c[1] as RequestInit).version)).toEqual([5, 6])
  })

  it('writes no exception for a zone dialog that has none', async () => {
    mock.routes['POST /zones'] = () => reply(200, { version: 4, zone: zone('zn', { name: 'app' }) })
    mock.routes['PUT /zones/zw'] = () => reply(200, { version: 4, zone: web })
    const { result } = setup({ policy: withExceptions })
    await act(() => result.current.saveZone(null, { ...values, name: 'app' }))
    // The exceptions of the zone as they are stored: nothing to write.
    await act(() => result.current.saveZone(web, { ...values, exceptions: [exceptionDraft(e1), exceptionDraft(e2)] }))
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('/exceptions'))).toHaveLength(0)
  })

  it('deletes the removed exceptions, updates the changed ones and creates the new ones, before the state change', async () => {
    const observed = zone('zw', { name: 'web', state: 'observe' })
    mock.routes['PUT /zones/zw'] = () => reply(200, { version: 4, zone: observed })
    let v = 4
    mock.routes['DELETE /exceptions/e1'] = () => reply(200, { version: ++v })
    mock.routes['PUT /exceptions/e2'] = () => reply(200, { version: ++v, exception: {} })
    mock.routes['POST /exceptions'] = () => reply(200, { version: ++v, exception: {} })
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1' })
    const { result } = setup({ policy: withExceptions })
    const changed = { ...exceptionDraft(e2), sources: [...e2.sources, db1] }
    const created = { sources: [db1], destinations: [app1], services: ['all'], comment: '' }
    await act(() => result.current.saveZone(observed, { ...values, state: 'enforce', exceptions: [exceptionDraft(e3), changed, created], removed_exceptions: ['e1'] }))
    expect(body(calls('DELETE /exceptions/e1')[0][1] as RequestInit)).toEqual({ version: 4 })
    expect(body(calls('PUT /exceptions/e2')[0][1] as RequestInit)).toEqual({
      version: 5, zone_id: 'zw', sources: [app1, db1], destinations: [db1], services: [{ proto: 'tcp', dport: '5432' }], comment: '',
    })
    expect(body(calls('POST /exceptions')[0][1] as RequestInit)).toMatchObject({ version: 6, zone_id: 'zw', services: [{ proto: 'any', dport: '' }] })
    // The unchanged one is not written.
    expect(calls('PUT /exceptions/e3')).toHaveLength(0)
    expect(body(calls('POST /zones/zw/state')[0][1] as RequestInit)).toEqual({ version: 7, state: 'enforce' })
  })

  it('tries a save again after a step failed without creating an exception twice nor deleting one already gone', async () => {
    mock.routes['PUT /zones/zw'] = () => reply(200, { version: 4, zone: web })
    mock.routes['DELETE /exceptions/e1'] = () => reply(200, { version: 5 })
    let posts = 0
    // The first new exception is written, the second is refused once.
    mock.routes['POST /exceptions'] = () => {
      posts++
      if (posts === 1) return reply(200, { version: 6, exception: { ...stored('n1'), sources: [db1], destinations: [app1] } })
      return posts === 2 ? reply(400, { code: 'INVALID', error: 'refused' }) : reply(200, { version: 7, exception: stored('n2') })
    }
    const reloadPolicy = vi.fn(async () => undefined)
    const { result, rerender } = renderHook(
      ({ p }) => useZoneEdits({ connectionId: 'c1', policy: p, reloadPolicy, startRun: vi.fn() }),
      { wrapper, initialProps: { p: withExceptions } },
    )
    const first: ExceptionDraft = { sources: [db1], destinations: [app1], services: ['postgresql'], comment: '' }
    const second: ExceptionDraft = { sources: [db1], destinations: [app1], services: ['ssh'], comment: '' }
    const created = vi.fn()
    const form = { ...values, exceptions: [exceptionDraft(e2), first, second], removed_exceptions: ['e1'] }
    const error = await refused(result.current.saveZone(web, form, created))
    expect((error as MicrosegApiError).serverMessage).toBe('refused')
    expect(created.mock.calls).toEqual([[first, 'n1']])

    // The draft read again: e1 is gone, the first new exception is stored. The dialog gave it its id.
    const n1 = { ...stored('n1'), sources: [db1], destinations: [app1] }
    rerender({ p: { ...withExceptions, version: 6, exceptions: [e2, e3, n1] } })
    await act(() => result.current.saveZone(web, { ...form, exceptions: [exceptionDraft(e2), { ...first, id: 'n1' }, second] }, created))
    expect(calls('DELETE /exceptions/e1')).toHaveLength(1)
    expect(calls('PUT /exceptions/n1')).toHaveLength(0)
    expect(calls('POST /exceptions').map(c => body(c[1] as RequestInit).services)).toEqual([
      [{ proto: 'tcp', dport: '5432' }], [{ proto: 'tcp', dport: '22' }], [{ proto: 'tcp', dport: '22' }],
    ])
    expect(body(calls('POST /exceptions')[2][1] as RequestInit).version).toBe(4)
    expect(created.mock.calls[1]).toEqual([second, 'n2'])
  })

  it('never deletes an exception the dialog did not remove, even one it does not list', async () => {
    mock.routes['PUT /zones/zw'] = () => reply(200, { version: 4, zone: web })
    const { result } = setup({ policy: withExceptions })
    await act(() => result.current.saveZone(web, values))
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('/exceptions'))).toHaveLength(0)
  })

  it('saves and deletes one exception with the draft version, then reads the policy again', async () => {
    mock.routes['POST /exceptions'] = () => reply(200, { version: 4, exception: {} })
    mock.routes['PUT /exceptions/e1'] = () => reply(200, { version: 4, exception: {} })
    mock.routes['DELETE /exceptions/e1'] = () => reply(200, { version: 4 })
    const { result, reloadPolicy } = setup({ policy: withExceptions })
    await act(() => result.current.saveException('zw', { sources: [app1], destinations: [db1], services: ['ssh'], comment: 'why' }))
    expect(body(calls('POST /exceptions')[0][1] as RequestInit)).toEqual({
      version: 3, zone_id: 'zw', sources: [app1], destinations: [db1], services: [{ proto: 'tcp', dport: '22' }], comment: 'why',
    })
    await act(() => result.current.saveException('zw', { ...exceptionDraft(e1), services: ['ssh'] }))
    expect(body(calls('PUT /exceptions/e1')[0][1] as RequestInit)).toMatchObject({ version: 3, zone_id: 'zw', services: [{ proto: 'tcp', dport: '22' }] })
    await act(() => result.current.deleteException('e1'))
    expect(body(calls('DELETE /exceptions/e1')[0][1] as RequestInit)).toEqual({ version: 3 })
    expect(reloadPolicy).toHaveBeenCalledTimes(3)
  })

  it('reads the policy again and rethrows on a version conflict', async () => {
    mock.routes['PUT /zones/zw'] = () => reply(409, { code: 'VERSION_CONFLICT', error: 'stale' })
    const { result, reloadPolicy } = setup()
    const error = await refused(result.current.saveZone(web, values))
    expect((error as MicrosegApiError).code).toBe('VERSION_CONFLICT')
    expect(reloadPolicy).toHaveBeenCalledTimes(1)
  })

  it('rethrows a 400 with the server wording and reads the policy again anyway', async () => {
    mock.routes['DELETE /zones/zw'] = () => reply(400, { code: 'INVALID', error: 'zone in use' })
    const { result, reloadPolicy } = setup()
    const error = await refused(result.current.deleteZone(web))
    expect(error).toBeInstanceOf(MicrosegApiError)
    expect((error as MicrosegApiError).serverMessage).toBe('zone in use')
    expect(reloadPolicy).toHaveBeenCalledTimes(1)
  })

  it('reads the policy again when the state change after a successful zone write is refused with a 400', async () => {
    mock.routes['PUT /zones/zw'] = () => reply(200, { version: 4, zone: web })
    mock.routes['POST /zones/zw/egress-state'] = () => reply(400, { code: 'INVALID', error: 'zone disabled' })
    const { result, reloadPolicy } = setup()
    const observed = zone('zw', { name: 'web', state: 'observe' })
    const error = await refused(result.current.saveZone(observed, { ...values, state: 'observe', egress_state: 'observe' }))
    expect((error as MicrosegApiError).serverMessage).toBe('zone disabled')
    expect(calls('PUT /zones/zw')).toHaveLength(1)
    expect(reloadPolicy).toHaveBeenCalledTimes(1)
  })

  it('sends the inbound change, waits for its run, then the outbound change with the version read again', async () => {
    mock.routes['PUT /zones/zw'] = () => reply(200, { version: 4, zone: web })
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1' })
    let reads = 0
    mock.routes['GET /runs/r1'] = () => reply(200, { id: 'r1', status: ++reads < 2 ? 'running' : 'done' })
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [web], version: 6 }))
    mock.routes['POST /zones/zw/egress-state'] = () => reply(202, { run_id: 'r2' })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { result, startRun } = setup()
      await act(() => result.current.saveZone(web, { ...values, state: 'observe', egress_state: 'enforce' }))
      expect(reads).toBe(2)
      expect(body(calls('POST /zones/zw/state')[0][1] as RequestInit)).toEqual({ version: 4, state: 'observe' })
      expect(body(calls('POST /zones/zw/egress-state')[0][1] as RequestInit)).toEqual({ version: 6, state: 'enforce' })
      expect(startRun).toHaveBeenNthCalledWith(1, expect.objectContaining({ runId: 'r1', runningText: 'web: change to observation in progress' }))
      expect(startRun).toHaveBeenNthCalledWith(2, expect.objectContaining({ runId: 'r2', runningText: 'web: outbound blocking in progress' }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops after a failed inbound run: the outbound change is not sent', async () => {
    mock.routes['PUT /zones/zw'] = () => reply(200, { version: 4, zone: web })
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1' })
    mock.routes['GET /runs/r1'] = () => reply(200, { id: 'r1', status: 'failed', error: 'boom' })
    const { result, reloadPolicy } = setup()
    const error = await refused(result.current.saveZone(web, { ...values, state: 'observe', egress_state: 'observe' }))
    expect(error).toBeInstanceOf(InboundRunFailedError)
    expect((error as InboundRunFailedError).detail).toBe('boom')
    expect(calls('POST /zones/zw/egress-state')).toHaveLength(0)
    expect(reloadPolicy).toHaveBeenCalledTimes(1)
  })

  it('says which state changes a zone dialog asks for: none for the outbound of a zone set disabled', () => {
    const observed = zone('zw', { state: 'observe', egress_state: 'observe' })
    expect(zoneStateChanges(observed, { state: 'observe', egress_state: 'observe' })).toEqual({ inbound: null, outbound: null })
    expect(zoneStateChanges(observed, { state: 'disabled', egress_state: 'enforce' })).toEqual({ inbound: 'disabled', outbound: null })
    expect(zoneStateChanges(observed, { state: 'enforce', egress_state: 'enforce' })).toEqual({ inbound: 'enforce', outbound: 'enforce' })
    expect(zoneStateChanges(web, { state: 'observe', egress_state: 'off' })).toEqual({ inbound: 'observe', outbound: null })
  })

  it('deletes a zone and a flow with the version, and saves a flow', async () => {
    mock.routes['DELETE /zones/zw'] = () => reply(200, { version: 4 })
    mock.routes['DELETE /flows/f1'] = () => reply(200, { version: 4 })
    mock.routes['PUT /flows/f1'] = () => reply(200, { version: 4 })
    mock.routes['POST /flows'] = () => reply(200, { version: 4 })
    const { result, reloadPolicy } = setup()
    await act(() => result.current.deleteZone(web))
    await act(() => result.current.deleteFlow({ id: 'f1' } as never))
    await act(() => result.current.saveFlow({ id: 'f1' } as never, flowValues))
    await act(() => result.current.saveFlow(null, flowValues))
    expect(body(calls('DELETE /zones/zw')[0][1] as RequestInit)).toEqual({ version: 3 })
    expect(body(calls('DELETE /flows/f1')[0][1] as RequestInit)).toEqual({ version: 3 })
    expect(body(calls('PUT /flows/f1')[0][1] as RequestInit)).toEqual({ version: 3, ...flowValues })
    expect(body(calls('POST /flows')[0][1] as RequestInit)).toEqual({ version: 3, ...flowValues })
    expect(reloadPolicy).toHaveBeenCalledTimes(4)
  })

  it('starts a state change with the version and follows its run', async () => {
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r9' })
    const { result, startRun } = setup()
    await act(() => result.current.setZoneState(web, 'observe'))
    expect(body(calls('POST /zones/zw/state')[0][1] as RequestInit)).toEqual({ version: 3, state: 'observe' })
    expect(startRun).toHaveBeenCalledWith(expect.objectContaining({ runId: 'r9', kind: 'zoneState', label: 'web' }))
  })

  it('queues a member change, one at a time, and keeps a failure', async () => {
    mock.routes['POST /members'] = () => reply(409, { code: 'BUSY', error: 'busy' })
    const { result, reloadPolicy } = setup()
    act(() => result.current.changeMember(ref, ''))
    expect(result.current.memberBusy).toBe(true)
    act(() => result.current.changeMember(ref, 'zw'))
    await waitFor(() => expect(result.current.memberBusy).toBe(false))
    expect(calls('POST /members')).toHaveLength(1)
    expect(body(calls('POST /members')[0][1] as RequestInit)).toEqual({ version: 3, zone_id: '', guests: [ref] })
    expect((result.current.memberError as MicrosegApiError).code).toBe('BUSY')
    expect(reloadPolicy).toHaveBeenCalledTimes(1)
    act(() => result.current.clearMemberError())
    expect(result.current.memberError).toBeNull()
  })

  it('keeps a member by clearing its pending change, then reads the policy again', async () => {
    mock.routes['POST /members'] = () => reply(200, { version: 4 })
    const { result, reloadPolicy } = setup()
    act(() => result.current.keepMember(ref))
    await waitFor(() => expect(result.current.memberBusy).toBe(false))
    expect(body(calls('POST /members')[0][1] as RequestInit)).toEqual({ version: 3, clear: [{ type: 'qemu', vmid: 100 }] })
    expect(reloadPolicy).toHaveBeenCalled()
    expect(result.current.memberError).toBeNull()
  })

  it('reads the policy again and keeps the error when keeping a member hits a version conflict', async () => {
    mock.routes['POST /members'] = () => reply(409, { code: 'VERSION_CONFLICT', error: 'stale' })
    const { result, reloadPolicy } = setup()
    act(() => result.current.keepMember(ref))
    await waitFor(() => expect(result.current.memberBusy).toBe(false))
    expect((result.current.memberError as MicrosegApiError).code).toBe('VERSION_CONFLICT')
    expect(reloadPolicy).toHaveBeenCalled()
  })

  it('exposes the readiness window and the pending changes of the draft', () => {
    const { result } = setup({ policy: policy({ ...draft, pending_changes: true, last_revision: null, zones: [web] }) })
    expect(result.current.readyAfterHours).toBe(24)
    expect(result.current.pendingChanges).toMatchObject({ pending: true, count: 1 })
  })
})
