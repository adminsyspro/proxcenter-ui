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
const toggleVMNICFirewallMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/firewall/pveDirect', () => ({
  toggleVMNICFirewall: toggleVMNICFirewallMock,
}))

installFirewallRouteMocks()

const PARAMS = { connectionId: 'conn-1', node: 'pve1', vmType: 'qemu', vmid: '101' }

beforeEach(resetFirewallRouteMocks)

describe('PUT /api/v1/firewall/vms/[connectionId]/[node]/[vmType]/[vmid]/nic-firewall', () => {
  it('forwards the whole body to the orchestrator and never touches PVE', async () => {
    orchestrator.put.mockResolvedValueOnce({ data: { status: 'updated' }, status: 200 })

    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: PARAMS, body: { enable: true }, method: 'PUT' })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ status: 'updated' })
    expect(orchestrator.put).toHaveBeenCalledWith(
      '/firewall/vms/conn-1/pve1/qemu/101/nic-firewall',
      { enable: true },
    )
    expect(toggleVMNICFirewallMock).not.toHaveBeenCalled()

    // The connection is loaded lazily inside the fallback closure: the
    // Enterprise path must not pay for a DB read + token decrypt.
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('falls back to toggleVMNICFirewall with body.enable unwrapped', async () => {
    orchestrator.put.mockRejectedValueOnce(unavailable())
    toggleVMNICFirewallMock.mockResolvedValueOnce({ status: 'updated' })

    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: PARAMS, body: { enable: true }, method: 'PUT' })

    expect(res.status).toBe(200)
    expect(getConnectionByIdMock).toHaveBeenCalledWith('conn-1')

    // The PVE helper takes the boolean, not the request body: passing the whole
    // object would make every call read as truthy.
    expect(toggleVMNICFirewallMock).toHaveBeenCalledWith(CONN, 'pve1', 'qemu', '101', true)
    expect(await readJson<any>(res)).toEqual({ status: 'updated' })
  })

  it('forwards enable: false as false when disabling the NIC firewall', async () => {
    orchestrator.put.mockRejectedValueOnce(unavailable())
    toggleVMNICFirewallMock.mockResolvedValueOnce({ status: 'updated' })

    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: PARAMS, body: { enable: false }, method: 'PUT' })

    expect(res.status).toBe(200)
    expect(toggleVMNICFirewallMock).toHaveBeenCalledWith(CONN, 'pve1', 'qemu', '101', false)
  })

  it('propagates a non-unavailable orchestrator error as a 500 without calling PVE', async () => {
    orchestrator.put.mockRejectedValueOnce(new Error('Orchestrator 500: VM 101 is locked'))

    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: PARAMS, body: { enable: true }, method: 'PUT' })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Orchestrator 500: VM 101 is locked' })
    expect(toggleVMNICFirewallMock).not.toHaveBeenCalled()
  })

  it('stringifies a nullish failure that carries no message', async () => {
    // `e?.message || String(e)`: a nullish rejection short-circuits the optional
    // chain, so the 500 body must still say something rather than be `{}`.
    orchestrator.put.mockRejectedValueOnce(null)

    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: PARAMS, body: { enable: true }, method: 'PUT' })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'null' })
    expect(toggleVMNICFirewallMock).not.toHaveBeenCalled()
  })

  it('stringifies a non-Error failure that carries no message', async () => {
    orchestrator.put.mockRejectedValueOnce({ status: 502 })

    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: PARAMS, body: { enable: true }, method: 'PUT' })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: '[object Object]' })
    expect(toggleVMNICFirewallMock).not.toHaveBeenCalled()
  })

  it('returns the RBAC denial without calling either backend', async () => {
    checkPermissionMock.mockResolvedValueOnce(denied(403, 'Forbidden'))

    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: PARAMS, body: { enable: true }, method: 'PUT' })

    expect(res.status).toBe(403)
    expect(checkPermissionMock).toHaveBeenCalledWith('node.manage', 'connection', 'conn-1')
    expect(orchestrator.put).not.toHaveBeenCalled()
    expect(toggleVMNICFirewallMock).not.toHaveBeenCalled()
  })

  it('returns the ownership denial without calling either backend', async () => {
    verifyConnectionOwnershipMock.mockResolvedValueOnce(denied(404, 'Not found'))

    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: PARAMS, body: { enable: true }, method: 'PUT' })

    expect(res.status).toBe(404)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(orchestrator.put).not.toHaveBeenCalled()
    expect(toggleVMNICFirewallMock).not.toHaveBeenCalled()
  })
})
