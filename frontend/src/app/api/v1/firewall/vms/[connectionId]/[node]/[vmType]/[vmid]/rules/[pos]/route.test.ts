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
const updateVMRuleMock = vi.fn<(...args: any[]) => Promise<any>>()
const deleteVMRuleMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/firewall/pveDirect', () => ({
  updateVMRule: updateVMRuleMock,
  deleteVMRule: deleteVMRuleMock,
}))

installFirewallRouteMocks()

const PARAMS = { connectionId: 'conn-1', node: 'pve1', vmType: 'qemu', vmid: '101', pos: '2' }

beforeEach(resetFirewallRouteMocks)

describe('PUT /api/v1/firewall/vms/[connectionId]/[node]/[vmType]/[vmid]/rules/[pos]', () => {
  const PATCH = { action: 'DROP', enable: 0 }

  it('returns the orchestrator body unwrapped and never touches PVE', async () => {
    orchestrator.put.mockResolvedValueOnce({ data: { status: 'updated' }, status: 200 })

    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: PARAMS, body: PATCH, method: 'PUT' })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ status: 'updated' })
    expect(orchestrator.put).toHaveBeenCalledWith('/firewall/vms/conn-1/pve1/qemu/101/rules/2', PATCH)
    expect(updateVMRuleMock).not.toHaveBeenCalled()

    // The connection is loaded lazily inside the fallback closure: the
    // Enterprise path must not pay for a DB read + token decrypt.
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('falls back to updateVMRule with the raw path params when the orchestrator is unreachable', async () => {
    orchestrator.put.mockRejectedValueOnce(unavailable())
    updateVMRuleMock.mockResolvedValueOnce({ status: 'updated' })

    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: PARAMS, body: PATCH, method: 'PUT' })

    expect(res.status).toBe(200)
    expect(getConnectionByIdMock).toHaveBeenCalledWith('conn-1')
    expect(updateVMRuleMock).toHaveBeenCalledWith(CONN, 'pve1', 'qemu', '101', '2', PATCH)
    expect(await readJson<any>(res)).toEqual({ status: 'updated' })
  })

  it('propagates a non-unavailable orchestrator error as a 500 without calling PVE', async () => {
    orchestrator.put.mockRejectedValueOnce(new Error('Orchestrator 500: rule pos out of range'))

    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: PARAMS, body: PATCH, method: 'PUT' })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Orchestrator 500: rule pos out of range' })
    expect(updateVMRuleMock).not.toHaveBeenCalled()
  })

  it('stringifies a failure that carries no message at all', async () => {
    // `e?.message || String(e)`: a nullish rejection short-circuits the optional
    // chain, so the 500 body must still say something rather than be `{}`.
    orchestrator.put.mockRejectedValueOnce(null)

    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: PARAMS, body: PATCH, method: 'PUT' })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'null' })
    expect(updateVMRuleMock).not.toHaveBeenCalled()
  })

  it('returns the RBAC denial without calling either backend', async () => {
    checkPermissionMock.mockResolvedValueOnce(denied(403, 'Forbidden'))

    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: PARAMS, body: PATCH, method: 'PUT' })

    expect(res.status).toBe(403)
    expect(checkPermissionMock).toHaveBeenCalledWith('node.manage', 'connection', 'conn-1')
    expect(orchestrator.put).not.toHaveBeenCalled()
    expect(updateVMRuleMock).not.toHaveBeenCalled()
  })

  it('returns the ownership denial without calling either backend', async () => {
    verifyConnectionOwnershipMock.mockResolvedValueOnce(denied(404, 'Not found'))

    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: PARAMS, body: PATCH, method: 'PUT' })

    expect(res.status).toBe(404)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(orchestrator.put).not.toHaveBeenCalled()
    expect(updateVMRuleMock).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/v1/firewall/vms/[connectionId]/[node]/[vmType]/[vmid]/rules/[pos]', () => {
  it('answers with its own literal body on the orchestrator path', async () => {
    orchestrator.delete.mockResolvedValueOnce({ data: { status: 'deleted' }, status: 200 })

    const { DELETE } = handlersOf(await import('./route'))
    const res = await callRoute(DELETE, { params: PARAMS, method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ status: 'deleted' })
    expect(orchestrator.delete).toHaveBeenCalledWith('/firewall/vms/conn-1/pve1/qemu/101/rules/2')
    expect(deleteVMRuleMock).not.toHaveBeenCalled()
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('falls back to deleteVMRule and keeps the same literal body', async () => {
    orchestrator.delete.mockRejectedValueOnce(unavailable())
    deleteVMRuleMock.mockResolvedValueOnce({ status: 'deleted' })

    const { DELETE } = handlersOf(await import('./route'))
    const res = await callRoute(DELETE, { params: PARAMS, method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(deleteVMRuleMock).toHaveBeenCalledWith(CONN, 'pve1', 'qemu', '101', '2')
    expect(await readJson<any>(res)).toEqual({ status: 'deleted' })
  })

  it('propagates a non-unavailable orchestrator error as a 500 without calling PVE', async () => {
    orchestrator.delete.mockRejectedValueOnce(new Error('Orchestrator 403: enterprise license required'))

    const { DELETE } = handlersOf(await import('./route'))
    const res = await callRoute(DELETE, { params: PARAMS, method: 'DELETE' })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Orchestrator 403: enterprise license required' })
    expect(deleteVMRuleMock).not.toHaveBeenCalled()
  })

  it('stringifies a failure that carries no message at all', async () => {
    // Non-nullish this time, so the optional chain resolves and it is the
    // `|| String(e)` arm that supplies the body.
    orchestrator.delete.mockRejectedValueOnce({ status: 502 })

    const { DELETE } = handlersOf(await import('./route'))
    const res = await callRoute(DELETE, { params: PARAMS, method: 'DELETE' })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: '[object Object]' })
    expect(deleteVMRuleMock).not.toHaveBeenCalled()
  })

  it('returns the RBAC denial without calling either backend', async () => {
    checkPermissionMock.mockResolvedValueOnce(denied(403, 'Forbidden'))

    const { DELETE } = handlersOf(await import('./route'))
    const res = await callRoute(DELETE, { params: PARAMS, method: 'DELETE' })

    expect(res.status).toBe(403)
    expect(orchestrator.delete).not.toHaveBeenCalled()
    expect(deleteVMRuleMock).not.toHaveBeenCalled()
  })

  it('returns the ownership denial without calling either backend', async () => {
    verifyConnectionOwnershipMock.mockResolvedValueOnce(denied(404, 'Not found'))

    const { DELETE } = handlersOf(await import('./route'))
    const res = await callRoute(DELETE, { params: PARAMS, method: 'DELETE' })

    expect(res.status).toBe(404)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(orchestrator.delete).not.toHaveBeenCalled()
    expect(deleteVMRuleMock).not.toHaveBeenCalled()
  })
})
