import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  CONN,
  getConnectionByIdMock,
  handlersOf,
  installFirewallRouteMocks,
  orchestrator,
  resetFirewallRouteMocks,
  unavailable,
} from '@/__tests__/setup/firewall-route-mocks'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

// See the VM route test for the rationale: the orchestrator client and pveDirect
// are stubbed, the fallback helper is the real one (#616).
const updateNodeRuleMock = vi.fn<(...args: any[]) => Promise<any>>()
const deleteNodeRuleMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/firewall/pveDirect', () => ({
  updateNodeRule: updateNodeRuleMock,
  deleteNodeRule: deleteNodeRuleMock,
}))

installFirewallRouteMocks()

const PARAMS = { connectionId: 'conn-1', node: 'pve1', pos: '3' }

beforeEach(resetFirewallRouteMocks)

describe('PUT /api/v1/firewall/nodes/[connectionId]/[node]/rules/[pos]', () => {
  const MOVE = { moveto: 0 }

  it('returns the orchestrator body unwrapped and never touches PVE', async () => {
    orchestrator.put.mockResolvedValueOnce({ data: { status: 'updated' }, status: 200 })

    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: PARAMS, body: MOVE, method: 'PUT' })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ status: 'updated' })
    expect(orchestrator.put).toHaveBeenCalledWith('/firewall/nodes/conn-1/pve1/rules/3', MOVE)
    expect(updateNodeRuleMock).not.toHaveBeenCalled()
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('falls back to updateNodeRule with the raw pos when the orchestrator is unreachable', async () => {
    orchestrator.put.mockRejectedValueOnce(unavailable())
    updateNodeRuleMock.mockResolvedValueOnce({ status: 'updated' })

    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: PARAMS, body: MOVE, method: 'PUT' })

    expect(res.status).toBe(200)
    expect(updateNodeRuleMock).toHaveBeenCalledWith(CONN, 'pve1', '3', MOVE)
    expect(await readJson<any>(res)).toEqual({ status: 'updated' })
  })

  it('propagates a non-unavailable orchestrator error as a 500 without calling PVE', async () => {
    orchestrator.put.mockRejectedValueOnce(new Error('Orchestrator 500: rule pos out of range'))

    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: PARAMS, body: MOVE, method: 'PUT' })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Orchestrator 500: rule pos out of range' })
    expect(updateNodeRuleMock).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/v1/firewall/nodes/[connectionId]/[node]/rules/[pos]', () => {
  it('answers with its own literal body on the orchestrator path', async () => {
    orchestrator.delete.mockResolvedValueOnce({ data: { status: 'deleted' }, status: 200 })

    const { DELETE } = handlersOf(await import('./route'))
    const res = await callRoute(DELETE, { params: PARAMS, method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ status: 'deleted' })
    expect(orchestrator.delete).toHaveBeenCalledWith('/firewall/nodes/conn-1/pve1/rules/3')
    expect(deleteNodeRuleMock).not.toHaveBeenCalled()
  })

  it('falls back to deleteNodeRule and keeps the same literal body', async () => {
    orchestrator.delete.mockRejectedValueOnce(unavailable())
    deleteNodeRuleMock.mockResolvedValueOnce({ status: 'deleted' })

    const { DELETE } = handlersOf(await import('./route'))
    const res = await callRoute(DELETE, { params: PARAMS, method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(deleteNodeRuleMock).toHaveBeenCalledWith(CONN, 'pve1', '3')
    expect(await readJson<any>(res)).toEqual({ status: 'deleted' })
  })

  it('propagates a non-unavailable orchestrator error as a 500 without calling PVE', async () => {
    orchestrator.delete.mockRejectedValueOnce(new Error('Orchestrator 403: enterprise license required'))

    const { DELETE } = handlersOf(await import('./route'))
    const res = await callRoute(DELETE, { params: PARAMS, method: 'DELETE' })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Orchestrator 403: enterprise license required' })
    expect(deleteNodeRuleMock).not.toHaveBeenCalled()
  })
})
