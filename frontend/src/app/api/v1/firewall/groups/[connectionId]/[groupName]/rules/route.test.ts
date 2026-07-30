// Wiring tests for the security-group rule create route (#616). Community
// installs have no orchestrator, so POST must fall back to direct PVE — only on
// ORCHESTRATOR_UNAVAILABLE — while keeping the 201 and the created body the UI
// already relies on.

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

const addSecurityGroupRuleMock = vi.fn<(conn: any, groupName: string, req: any) => Promise<any>>()

vi.mock('@/lib/firewall/pveDirect', () => ({ addSecurityGroupRule: addSecurityGroupRuleMock }))

installFirewallRouteMocks()

const PARAMS = { connectionId: 'conn-1', groupName: 'web' }

beforeEach(resetFirewallRouteMocks)

describe('POST /api/v1/firewall/groups/[connectionId]/[groupName]/rules', () => {
  const body = { type: 'in', action: 'ACCEPT', dport: '443', enable: 1 }

  it('creates through the orchestrator and keeps the 201 with its body', async () => {
    orchestrator.post.mockResolvedValue({ data: { status: 'created' }, status: 200 })

    const { POST } = handlersOf(await import('./route'))
    const res = await callRoute(POST, { params: PARAMS, body })

    expect(res.status).toBe(201)
    expect(await readJson<any>(res)).toEqual({ status: 'created' })
    expect(orchestrator.post).toHaveBeenCalledWith('/firewall/groups/conn-1/web/rules', body)
    expect(addSecurityGroupRuleMock).not.toHaveBeenCalled()
    // The Enterprise path must not pay for the connection lookup
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('creates via direct PVE when the orchestrator is unavailable, keeping the 201', async () => {
    orchestrator.post.mockRejectedValue(unavailable())
    addSecurityGroupRuleMock.mockResolvedValue({ status: 'created' })

    const { POST } = handlersOf(await import('./route'))
    const res = await callRoute(POST, { params: PARAMS, body })

    expect(res.status).toBe(201)
    expect(await readJson<any>(res)).toEqual({ status: 'created' })
    expect(getConnectionByIdMock).toHaveBeenCalledWith('conn-1')
    // The raw group path param plus the parsed body, untouched
    expect(addSecurityGroupRuleMock).toHaveBeenCalledWith(CONN, 'web', body)
  })

  it('propagates a non-unavailable orchestrator error as a 500 and never writes to PVE', async () => {
    orchestrator.post.mockRejectedValue(new Error('Orchestrator 400: invalid dport'))

    const { POST } = handlersOf(await import('./route'))
    const res = await callRoute(POST, { params: PARAMS, body })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Orchestrator 400: invalid dport' })
    expect(addSecurityGroupRuleMock).not.toHaveBeenCalled()
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('falls back to a generic message when the thrown value carries none', async () => {
    // A non-Error rejection has no .message: the 500 must still say something.
    orchestrator.post.mockRejectedValue({ code: 'ECONNRESET' })

    const { POST } = handlersOf(await import('./route'))
    const res = await callRoute(POST, { params: PARAMS, body })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Failed to add rule' })
    expect(addSecurityGroupRuleMock).not.toHaveBeenCalled()
  })

  it('returns the ownership denial before reading the body or calling anything', async () => {
    verifyConnectionOwnershipMock.mockResolvedValue(denied(404, 'Connection not found'))

    const { POST } = handlersOf(await import('./route'))
    const res = await callRoute(POST, { params: { ...PARAMS, connectionId: 'conn-other' }, body })

    expect(res.status).toBe(404)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(orchestrator.post).not.toHaveBeenCalled()
    expect(addSecurityGroupRuleMock).not.toHaveBeenCalled()
  })

  it('returns the RBAC denial without calling either backend', async () => {
    checkPermissionMock.mockResolvedValue(denied(403, 'Forbidden'))

    const { POST } = handlersOf(await import('./route'))
    const res = await callRoute(POST, { params: PARAMS, body })

    expect(res.status).toBe(403)
    expect(orchestrator.post).not.toHaveBeenCalled()
    expect(addSecurityGroupRuleMock).not.toHaveBeenCalled()
  })
})
