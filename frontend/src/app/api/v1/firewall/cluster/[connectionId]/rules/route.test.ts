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

// pveDirect is stubbed rather than pveFetch: the form encoding of a rule is
// pveDirect's own test's subject, while this file pins down that the route
// reaches for addClusterRule with the parsed body when the orchestrator is
// missing (#616).
const addClusterRuleMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/firewall/pveDirect', () => ({
  addClusterRule: addClusterRuleMock,
}))

installFirewallRouteMocks()

const RULE = { type: 'in', action: 'ACCEPT', proto: 'tcp', dport: '8006', comment: 'PVE web UI' }

beforeEach(() => {
  resetFirewallRouteMocks()
  addClusterRuleMock.mockResolvedValue({ status: 'created' })
})

describe('POST /api/v1/firewall/cluster/[connectionId]/rules', () => {
  it('keeps the 201 and the orchestrator body when the orchestrator answers', async () => {
    orchestrator.post.mockResolvedValue({ data: { status: 'created' }, status: 200 })

    const { POST } = handlersOf(await import('./route'))

    const res = await callRoute(POST, { params: { connectionId: 'conn-1' }, body: RULE })

    expect(res.status).toBe(201)
    expect(await readJson(res)).toEqual({ status: 'created' })
    expect(orchestrator.post).toHaveBeenCalledWith('/firewall/cluster/conn-1/rules', RULE)
    expect(checkPermissionMock).toHaveBeenCalledWith('node.manage', 'connection', 'conn-1')
    expect(addClusterRuleMock).not.toHaveBeenCalled()

    // Lazy connection load: the Enterprise path never reads the credentials.
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('adds the rule through direct PVE when the orchestrator is unavailable, keeping the 201', async () => {
    orchestrator.post.mockRejectedValue(unavailable())

    const { POST } = handlersOf(await import('./route'))

    const res = await callRoute(POST, { params: { connectionId: 'conn-1' }, body: RULE })

    expect(res.status).toBe(201)
    expect(await readJson(res)).toEqual({ status: 'created' })
    expect(getConnectionByIdMock).toHaveBeenCalledWith('conn-1')
    expect(addClusterRuleMock).toHaveBeenCalledWith(CONN, RULE)
  })

  it('forwards the body untouched, including an explicit enable: 0', async () => {
    orchestrator.post.mockRejectedValue(unavailable())

    const { POST } = handlersOf(await import('./route'))

    const disabled = { ...RULE, enable: 0 }
    const res = await callRoute(POST, { params: { connectionId: 'conn-1' }, body: disabled })

    expect(res.status).toBe(201)

    // The route must not normalise the rule: pveDirect owns the absent → 1
    // default, so a rule deliberately created disabled stays disabled.
    expect(addClusterRuleMock).toHaveBeenCalledWith(CONN, disabled)
  })

  it('propagates a non-unavailable orchestrator error as a 500 and never writes to PVE', async () => {
    orchestrator.post.mockRejectedValue(new Error('Orchestrator 403: feature not licensed'))

    const { POST } = handlersOf(await import('./route'))

    const res = await callRoute(POST, { params: { connectionId: 'conn-1' }, body: RULE })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Orchestrator 403: feature not licensed' })
    expect(addClusterRuleMock).not.toHaveBeenCalled()
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('answers a generic message when the rejection carries no message', async () => {
    // A non-Error rejection has no .message, so the route must not answer
    // `{ error: undefined }`.
    orchestrator.post.mockRejectedValue({ status: 502 })

    const { POST } = handlersOf(await import('./route'))

    const res = await callRoute(POST, { params: { connectionId: 'conn-1' }, body: RULE })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Failed to add cluster rule' })
  })

  it('surfaces a failing PVE fallback as a 500 rather than a fake 201', async () => {
    orchestrator.post.mockRejectedValue(unavailable())
    addClusterRuleMock.mockRejectedValue(new Error('PVE 500: rule parse error'))

    const { POST } = handlersOf(await import('./route'))

    const res = await callRoute(POST, { params: { connectionId: 'conn-1' }, body: RULE })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'PVE 500: rule parse error' })
  })

  it('returns the denied Response from RBAC without writing anywhere', async () => {
    checkPermissionMock.mockResolvedValue(denied(403, 'Forbidden'))

    const { POST } = handlersOf(await import('./route'))

    const res = await callRoute(POST, { params: { connectionId: 'conn-1' }, body: RULE })

    expect(res.status).toBe(403)
    expect(orchestrator.post).not.toHaveBeenCalled()
    expect(addClusterRuleMock).not.toHaveBeenCalled()
  })

  it('returns the denied Response from the ownership check without writing anywhere', async () => {
    verifyConnectionOwnershipMock.mockResolvedValue(denied(404, 'Not found'))

    const { POST } = handlersOf(await import('./route'))

    const res = await callRoute(POST, { params: { connectionId: 'conn-other' }, body: RULE })

    expect(res.status).toBe(404)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(orchestrator.post).not.toHaveBeenCalled()
    expect(addClusterRuleMock).not.toHaveBeenCalled()
  })
})
