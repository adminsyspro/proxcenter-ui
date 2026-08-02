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
const addNodeRuleMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/firewall/pveDirect', () => ({
  addNodeRule: addNodeRuleMock,
}))

installFirewallRouteMocks()

const PARAMS = { connectionId: 'conn-1', node: 'pve1' }

const RULE = { type: 'in', action: 'ACCEPT', dport: '8006', proto: 'tcp', enable: 1 }

beforeEach(resetFirewallRouteMocks)

describe('POST /api/v1/firewall/nodes/[connectionId]/[node]/rules', () => {
  it('returns 201 with the orchestrator body and never touches PVE', async () => {
    orchestrator.post.mockResolvedValueOnce({ data: { status: 'created' }, status: 200 })

    const { POST } = handlersOf(await import('./route'))
    const res = await callRoute(POST, { params: PARAMS, body: RULE })

    expect(res.status).toBe(201)
    expect(await readJson<any>(res)).toEqual({ status: 'created' })
    expect(orchestrator.post).toHaveBeenCalledWith('/firewall/nodes/conn-1/pve1/rules', RULE)
    expect(addNodeRuleMock).not.toHaveBeenCalled()

    // The connection is loaded lazily inside the fallback closure: the
    // Enterprise path must not pay for a DB read + token decrypt.
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('falls back to addNodeRule with the raw node and the parsed body, still 201', async () => {
    orchestrator.post.mockRejectedValueOnce(unavailable())
    addNodeRuleMock.mockResolvedValueOnce({ status: 'created' })

    const { POST } = handlersOf(await import('./route'))
    const res = await callRoute(POST, { params: PARAMS, body: RULE })

    expect(res.status).toBe(201)
    expect(getConnectionByIdMock).toHaveBeenCalledWith('conn-1')
    expect(addNodeRuleMock).toHaveBeenCalledWith(CONN, 'pve1', RULE)
    expect(await readJson<any>(res)).toEqual({ status: 'created' })
  })

  it('propagates a non-unavailable orchestrator error as a 500 without calling PVE', async () => {
    orchestrator.post.mockRejectedValueOnce(new Error('Orchestrator 400: invalid rule'))

    const { POST } = handlersOf(await import('./route'))
    const res = await callRoute(POST, { params: PARAMS, body: RULE })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Orchestrator 400: invalid rule' })
    expect(addNodeRuleMock).not.toHaveBeenCalled()
  })

  it('falls back to a default message when the failure carries none', async () => {
    // The catch block reads `error.message` without optional chaining, so the
    // realistic no-message case is a bare object (rejected PVE body, Go error
    // payload) rather than null — that is what hits the `|| 'Failed to …'` arm.
    orchestrator.post.mockRejectedValueOnce({ status: 502 })

    const { POST } = handlersOf(await import('./route'))
    const res = await callRoute(POST, { params: PARAMS, body: RULE })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Failed to add node rule' })
    expect(addNodeRuleMock).not.toHaveBeenCalled()
  })

  it('returns the RBAC denial without calling either backend', async () => {
    checkPermissionMock.mockResolvedValueOnce(denied(403, 'Forbidden'))

    const { POST } = handlersOf(await import('./route'))
    const res = await callRoute(POST, { params: PARAMS, body: RULE })

    expect(res.status).toBe(403)
    expect(checkPermissionMock).toHaveBeenCalledWith('node.manage', 'connection', 'conn-1')
    expect(orchestrator.post).not.toHaveBeenCalled()
    expect(addNodeRuleMock).not.toHaveBeenCalled()
  })

  it('returns the ownership denial without calling either backend', async () => {
    verifyConnectionOwnershipMock.mockResolvedValueOnce(denied(404, 'Not found'))

    const { POST } = handlersOf(await import('./route'))
    const res = await callRoute(POST, { params: PARAMS, body: RULE })

    expect(res.status).toBe(404)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(orchestrator.post).not.toHaveBeenCalled()
    expect(addNodeRuleMock).not.toHaveBeenCalled()
  })
})
