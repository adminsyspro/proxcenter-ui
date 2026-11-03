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
import { useMicrosegStatus } from '@/lib/microseg/useMicrosegStatus'
import enMessages from '@/messages/en.json'

import { calls, mock, policy, reply, zone, REVISION_HEAD } from './microsegTestKit'
import { body, installFreshMocks } from './policyTestKit'
import { useZoneEdits, type ZoneEditsInput } from './useZoneEdits'

installFreshMocks()

const web = zone('zw', { name: 'web', state: 'disabled' })
const draft = policy({ zones: [web], last_revision: REVISION_HEAD })
const ref = { node: 'pve1', type: 'qemu' as const, vmid: 100 }
const values = { name: 'web', label: 'front', color: '#ef4444', isolate_members: true }
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
      version: 3, name: 'web', label: 'front', color: '#ef4444', enforcement: 'guest', vnet_id: '', isolate_members: true,
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

  it('reads the policy again and rethrows on a version conflict', async () => {
    mock.routes['PUT /zones/zw'] = () => reply(409, { code: 'VERSION_CONFLICT', error: 'stale' })
    const { result, reloadPolicy } = setup()
    const error = await refused(result.current.saveZone(web, values))
    expect((error as MicrosegApiError).code).toBe('VERSION_CONFLICT')
    expect(reloadPolicy).toHaveBeenCalledTimes(1)
  })

  it('rethrows a 400 with the server wording and reads nothing again', async () => {
    mock.routes['DELETE /zones/zw'] = () => reply(400, { code: 'INVALID', error: 'zone in use' })
    const { result, reloadPolicy } = setup()
    const error = await refused(result.current.deleteZone(web))
    expect(error).toBeInstanceOf(MicrosegApiError)
    expect((error as MicrosegApiError).serverMessage).toBe('zone in use')
    expect(reloadPolicy).not.toHaveBeenCalled()
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
    expect(reloadPolicy).not.toHaveBeenCalled()
    act(() => result.current.clearMemberError())
    expect(result.current.memberError).toBeNull()
  })

  it('exposes the readiness window and the pending changes of the draft', () => {
    const { result } = setup({ policy: policy({ ...draft, pending_changes: true, last_revision: null, zones: [web] }) })
    expect(result.current.readyAfterHours).toBe(24)
    expect(result.current.pendingChanges).toEqual({ pending: true, count: 1 })
  })
})
