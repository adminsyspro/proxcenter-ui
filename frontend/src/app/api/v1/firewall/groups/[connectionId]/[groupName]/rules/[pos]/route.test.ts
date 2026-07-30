// Wiring tests for the security-group rule update/delete route (#616). Both
// handlers answer { success: true } whatever the backend returns, so what
// matters here is which backend runs and with which arguments — `pos` reaches
// pveDirect as the raw path param.

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

const updateSecurityGroupRuleMock = vi.fn<(...args: any[]) => Promise<any>>()
const deleteSecurityGroupRuleMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/firewall/pveDirect', () => ({
  updateSecurityGroupRule: updateSecurityGroupRuleMock,
  deleteSecurityGroupRule: deleteSecurityGroupRuleMock,
}))

installFirewallRouteMocks()

const PARAMS = { connectionId: 'conn-1', groupName: 'web', pos: '3' }

beforeEach(resetFirewallRouteMocks)

describe('PUT /api/v1/firewall/groups/[connectionId]/[groupName]/rules/[pos]', () => {
  const body = { action: 'DROP', enable: 0, moveto: 1 }

  it('updates through the orchestrator and never touches PVE', async () => {
    orchestrator.put.mockResolvedValue({ data: { status: 'updated' }, status: 200 })

    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: PARAMS, body, method: 'PUT' })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ success: true })
    expect(orchestrator.put).toHaveBeenCalledWith('/firewall/groups/conn-1/web/rules/3', body)
    expect(updateSecurityGroupRuleMock).not.toHaveBeenCalled()
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('falls back to direct PVE with the group, the raw pos and the parsed body', async () => {
    orchestrator.put.mockRejectedValue(unavailable())
    updateSecurityGroupRuleMock.mockResolvedValue({ status: 'updated' })

    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: PARAMS, body, method: 'PUT' })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ success: true })
    expect(getConnectionByIdMock).toHaveBeenCalledWith('conn-1')
    expect(updateSecurityGroupRuleMock).toHaveBeenCalledWith(CONN, 'web', '3', body)
  })

  it('propagates a non-unavailable orchestrator error as a 500 without calling PVE', async () => {
    orchestrator.put.mockRejectedValue(new Error('Orchestrator request timeout'))

    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: PARAMS, body, method: 'PUT' })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Orchestrator request timeout' })
    expect(updateSecurityGroupRuleMock).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/v1/firewall/groups/[connectionId]/[groupName]/rules/[pos]', () => {
  it('deletes through the orchestrator and never touches PVE', async () => {
    orchestrator.delete.mockResolvedValue({ data: { status: 'deleted' }, status: 200 })

    const { DELETE } = handlersOf(await import('./route'))
    const res = await callRoute(DELETE, { params: PARAMS, method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ success: true })
    expect(orchestrator.delete).toHaveBeenCalledWith('/firewall/groups/conn-1/web/rules/3')
    expect(deleteSecurityGroupRuleMock).not.toHaveBeenCalled()
  })

  it('falls back to direct PVE with the group and the raw pos', async () => {
    orchestrator.delete.mockRejectedValue(unavailable())
    deleteSecurityGroupRuleMock.mockResolvedValue({ status: 'deleted' })

    const { DELETE } = handlersOf(await import('./route'))
    const res = await callRoute(DELETE, { params: PARAMS, method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ success: true })
    expect(deleteSecurityGroupRuleMock).toHaveBeenCalledWith(CONN, 'web', '3')
  })

  it('propagates a non-unavailable orchestrator error as a 500 without calling PVE', async () => {
    orchestrator.delete.mockRejectedValue(new Error('Orchestrator 404: rule gone'))

    const { DELETE } = handlersOf(await import('./route'))
    const res = await callRoute(DELETE, { params: PARAMS, method: 'DELETE' })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Orchestrator 404: rule gone' })
    expect(deleteSecurityGroupRuleMock).not.toHaveBeenCalled()
  })
})
