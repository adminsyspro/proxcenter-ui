import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  CONN,
  checkPermissionMock,
  denied,
  getConnectionByIdMock,
  handlersOf,
  installFirewallRouteMocks,
  orchestrator,
  resetFirewallRouteMocks,
  unavailable,
  verifyConnectionOwnershipMock,
} from '@/__tests__/setup/firewall-route-mocks'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

// See the VM route test for the rationale: the orchestrator client and pveDirect
// are stubbed, the fallback helper is the real one (#616).
const getVMFirewallLogMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/firewall/pveDirect', () => ({
  getVMFirewallLog: getVMFirewallLogMock,
}))

installFirewallRouteMocks()

const PARAMS = { connectionId: 'conn-1', node: 'pve1', vmType: 'lxc', vmid: '204' }

const ENTRIES = [
  { n: 1, t: 'DROP: IN=fwbr204i0 SRC=10.0.0.9' },
  { n: 2, t: 'ACCEPT: IN=fwbr204i0 SRC=10.0.0.10' },
]

beforeEach(resetFirewallRouteMocks)

describe('GET /api/v1/firewall/vms/[connectionId]/[node]/[vmType]/[vmid]/log', () => {
  it('returns the orchestrator entries unwrapped and never touches PVE', async () => {
    orchestrator.get.mockResolvedValueOnce({ data: ENTRIES, status: 200 })

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: PARAMS, searchParams: { limit: '200' } })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual(ENTRIES)
    expect(orchestrator.get).toHaveBeenCalledWith('/firewall/vms/conn-1/pve1/lxc/204/log?limit=200')
    expect(getVMFirewallLogMock).not.toHaveBeenCalled()

    // The connection is loaded lazily inside the fallback closure: the
    // Enterprise path must not pay for a DB read + token decrypt.
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('defaults the limit to 50 when the query param is absent', async () => {
    orchestrator.get.mockResolvedValueOnce({ data: [], status: 200 })

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: PARAMS })

    expect(res.status).toBe(200)
    expect(orchestrator.get).toHaveBeenCalledWith('/firewall/vms/conn-1/pve1/lxc/204/log?limit=50')
  })

  it('falls back to getVMFirewallLog with the limit coerced to a number', async () => {
    orchestrator.get.mockRejectedValueOnce(unavailable())
    getVMFirewallLogMock.mockResolvedValueOnce(ENTRIES)

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: PARAMS, searchParams: { limit: '200' } })

    expect(res.status).toBe(200)
    expect(getConnectionByIdMock).toHaveBeenCalledWith('conn-1')

    // pveFetch builds `?limit=`, so the string from the query string must have
    // become a number here — 200, not '200'.
    expect(getVMFirewallLogMock).toHaveBeenCalledWith(CONN, 'pve1', 'lxc', '204', 200)

    // Bare array, exactly what the orchestrator would have returned.
    expect(await readJson<any>(res)).toEqual(ENTRIES)
  })

  it('passes the default limit of 50 down to PVE as well', async () => {
    orchestrator.get.mockRejectedValueOnce(unavailable())
    getVMFirewallLogMock.mockResolvedValueOnce([])

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: PARAMS })

    expect(res.status).toBe(200)
    expect(getVMFirewallLogMock).toHaveBeenCalledWith(CONN, 'pve1', 'lxc', '204', 50)
    expect(await readJson<any>(res)).toEqual([])
  })

  it('propagates a non-unavailable orchestrator error as a 500 without calling PVE', async () => {
    orchestrator.get.mockRejectedValueOnce(new Error('Orchestrator 403: enterprise license required'))

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: PARAMS })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Orchestrator 403: enterprise license required' })
    expect(getVMFirewallLogMock).not.toHaveBeenCalled()
  })

  it('stringifies a nullish failure that carries no message', async () => {
    // `e?.message || String(e)`: a nullish rejection short-circuits the optional
    // chain, so the 500 body must still say something rather than be `{}`.
    orchestrator.get.mockRejectedValueOnce(null)

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: PARAMS })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'null' })
    expect(getVMFirewallLogMock).not.toHaveBeenCalled()
  })

  it('stringifies a non-Error failure that carries no message', async () => {
    orchestrator.get.mockRejectedValueOnce({ status: 502 })

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: PARAMS })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: '[object Object]' })
    expect(getVMFirewallLogMock).not.toHaveBeenCalled()
  })

  it('returns the RBAC denial without calling either backend', async () => {
    checkPermissionMock.mockResolvedValueOnce(denied(403, 'Forbidden'))

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: PARAMS })

    expect(res.status).toBe(403)
    expect(checkPermissionMock).toHaveBeenCalledWith('node.view', 'connection', 'conn-1')
    expect(orchestrator.get).not.toHaveBeenCalled()
    expect(getVMFirewallLogMock).not.toHaveBeenCalled()
  })

  it('returns the ownership denial without calling either backend', async () => {
    verifyConnectionOwnershipMock.mockResolvedValueOnce(denied(404, 'Not found'))

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: PARAMS })

    expect(res.status).toBe(404)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(orchestrator.get).not.toHaveBeenCalled()
    expect(getVMFirewallLogMock).not.toHaveBeenCalled()
  })
})
