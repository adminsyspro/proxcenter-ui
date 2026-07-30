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

// Same shape as the VM route test: pveDirect is stubbed, withPveFallback is the
// real one. What is under test is the wiring — which backend runs, with which
// arguments, and what body comes back out (#616).
const getNodeRulesMock = vi.fn<(...args: any[]) => Promise<any>>()
const getNodeOptionsMock = vi.fn<(...args: any[]) => Promise<any>>()
const updateNodeOptionsMock = vi.fn<(...args: any[]) => Promise<any>>()
const addNodeRuleMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/firewall/pveDirect', () => ({
  getNodeRules: getNodeRulesMock,
  getNodeOptions: getNodeOptionsMock,
  updateNodeOptions: updateNodeOptionsMock,
  addNodeRule: addNodeRuleMock,
}))

installFirewallRouteMocks()

const PARAMS = { connectionId: 'conn-1', node: 'pve1' }

const RULES = [
  { pos: 0, type: 'in', action: 'ACCEPT', enable: 1, dport: '8006', proto: 'tcp' },
  { pos: 1, type: 'in', action: 'DROP', enable: 1 },
]

const OPTIONS = { enable: 1, log_level_in: 'nolog', log_level_out: 'nolog' }

/**
 * The "failure with no message" case. This route's catch blocks read
 * `error.message` without optional chaining, so a thrown null would throw again
 * inside the catch; a bare object is the realistic shape (a rejected PVE body,
 * a Go error payload) and is what exercises the `|| 'Failed to …'` default.
 */
const NO_MESSAGE = { status: 502 }

beforeEach(resetFirewallRouteMocks)

describe('GET /api/v1/firewall/nodes/[connectionId]/[node]', () => {
  it('returns the orchestrator rules unwrapped and never touches PVE', async () => {
    orchestrator.get.mockResolvedValueOnce({ data: RULES, status: 200 })

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: PARAMS, searchParams: { type: 'rules' } })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual(RULES)
    expect(orchestrator.get).toHaveBeenCalledWith('/firewall/nodes/conn-1/pve1/rules')
    expect(getNodeRulesMock).not.toHaveBeenCalled()

    // The connection is loaded lazily inside the fallback closure: the
    // Enterprise path must not pay for a DB read + token decrypt.
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('defaults to the options endpoint when no type is given', async () => {
    orchestrator.get.mockResolvedValueOnce({ data: OPTIONS, status: 200 })

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: PARAMS })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual(OPTIONS)
    expect(orchestrator.get).toHaveBeenCalledWith('/firewall/nodes/conn-1/pve1/options')
  })

  it('falls back to getNodeRules with the raw path params when the orchestrator is unreachable', async () => {
    orchestrator.get.mockRejectedValueOnce(unavailable())
    getNodeRulesMock.mockResolvedValueOnce(RULES)

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: PARAMS, searchParams: { type: 'rules' } })

    expect(res.status).toBe(200)
    expect(getConnectionByIdMock).toHaveBeenCalledWith('conn-1')
    expect(getNodeRulesMock).toHaveBeenCalledWith(CONN, 'pve1')
    expect(getNodeOptionsMock).not.toHaveBeenCalled()

    // Bare array, exactly what the orchestrator would have returned: the
    // component layer runs it through normalizeRules, which Array.isArray-checks.
    expect(await readJson<any>(res)).toEqual(RULES)
  })

  it('falls back to getNodeOptions when the type is absent or not rules', async () => {
    orchestrator.get.mockRejectedValueOnce(unavailable())
    getNodeOptionsMock.mockResolvedValueOnce(OPTIONS)

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: PARAMS, searchParams: { type: 'options' } })

    expect(res.status).toBe(200)
    expect(getNodeOptionsMock).toHaveBeenCalledWith(CONN, 'pve1')
    expect(getNodeRulesMock).not.toHaveBeenCalled()
    expect(await readJson<any>(res)).toEqual(OPTIONS)
  })

  it('propagates a non-unavailable orchestrator error as a 500 without calling PVE', async () => {
    orchestrator.get.mockRejectedValueOnce(new Error('Orchestrator 403: enterprise license required'))

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: PARAMS, searchParams: { type: 'rules' } })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Orchestrator 403: enterprise license required' })
    expect(getNodeRulesMock).not.toHaveBeenCalled()
    expect(getNodeOptionsMock).not.toHaveBeenCalled()
  })

  it('falls back to a default message when the failure carries none', async () => {
    orchestrator.get.mockRejectedValueOnce(NO_MESSAGE)

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: PARAMS })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Failed to fetch node firewall' })
  })

  it('returns the RBAC denial without calling either backend', async () => {
    checkPermissionMock.mockResolvedValueOnce(denied(403, 'Forbidden'))

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: PARAMS, searchParams: { type: 'rules' } })

    expect(res.status).toBe(403)
    expect(checkPermissionMock).toHaveBeenCalledWith('node.view', 'connection', 'conn-1')
    expect(orchestrator.get).not.toHaveBeenCalled()
    expect(getNodeRulesMock).not.toHaveBeenCalled()
  })

  it('returns the ownership denial without calling either backend', async () => {
    verifyConnectionOwnershipMock.mockResolvedValueOnce(denied(404, 'Not found'))

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: PARAMS, searchParams: { type: 'rules' } })

    expect(res.status).toBe(404)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(orchestrator.get).not.toHaveBeenCalled()
    expect(getNodeRulesMock).not.toHaveBeenCalled()
  })
})

describe('PUT /api/v1/firewall/nodes/[connectionId]/[node]', () => {
  const BODY = { enable: 1, log_level_in: 'info' }

  it('returns the orchestrator body unwrapped and never touches PVE', async () => {
    orchestrator.put.mockResolvedValueOnce({ data: { status: 'updated' }, status: 200 })

    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: PARAMS, body: BODY, method: 'PUT' })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ status: 'updated' })
    expect(orchestrator.put).toHaveBeenCalledWith('/firewall/nodes/conn-1/pve1/options', BODY)
    expect(updateNodeOptionsMock).not.toHaveBeenCalled()
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('falls back to updateNodeOptions with the parsed body when the orchestrator is unreachable', async () => {
    orchestrator.put.mockRejectedValueOnce(unavailable())
    updateNodeOptionsMock.mockResolvedValueOnce({ status: 'updated' })

    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: PARAMS, body: BODY, method: 'PUT' })

    expect(res.status).toBe(200)
    expect(updateNodeOptionsMock).toHaveBeenCalledWith(CONN, 'pve1', BODY)
    expect(await readJson<any>(res)).toEqual({ status: 'updated' })
  })

  it('propagates a non-unavailable orchestrator error as a 500 without calling PVE', async () => {
    orchestrator.put.mockRejectedValueOnce(new Error('Orchestrator request timeout'))

    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: PARAMS, body: BODY, method: 'PUT' })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Orchestrator request timeout' })
    expect(updateNodeOptionsMock).not.toHaveBeenCalled()
  })

  it('falls back to a default message when the failure carries none', async () => {
    orchestrator.put.mockRejectedValueOnce(NO_MESSAGE)

    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: PARAMS, body: BODY, method: 'PUT' })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Failed to update node options' })
  })

  it('returns the RBAC denial without reading the body or calling either backend', async () => {
    checkPermissionMock.mockResolvedValueOnce(denied(403, 'Forbidden'))

    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: PARAMS, body: BODY, method: 'PUT' })

    expect(res.status).toBe(403)
    expect(checkPermissionMock).toHaveBeenCalledWith('node.manage', 'connection', 'conn-1')
    expect(orchestrator.put).not.toHaveBeenCalled()
    expect(updateNodeOptionsMock).not.toHaveBeenCalled()
  })

  it('returns the ownership denial without calling either backend', async () => {
    verifyConnectionOwnershipMock.mockResolvedValueOnce(denied(404, 'Not found'))

    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: PARAMS, body: BODY, method: 'PUT' })

    expect(res.status).toBe(404)
    expect(orchestrator.put).not.toHaveBeenCalled()
    expect(updateNodeOptionsMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/firewall/nodes/[connectionId]/[node]', () => {
  const RULE = { type: 'in', action: 'ACCEPT', dport: '22', proto: 'tcp' }

  it('returns 201 with the orchestrator body and never touches PVE', async () => {
    orchestrator.post.mockResolvedValueOnce({ data: { status: 'created' }, status: 200 })

    const { POST } = handlersOf(await import('./route'))
    const res = await callRoute(POST, { params: PARAMS, body: RULE })

    expect(res.status).toBe(201)
    expect(await readJson<any>(res)).toEqual({ status: 'created' })
    expect(orchestrator.post).toHaveBeenCalledWith('/firewall/nodes/conn-1/pve1/rules', RULE)
    expect(addNodeRuleMock).not.toHaveBeenCalled()
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('falls back to addNodeRule with the parsed body and still answers 201', async () => {
    orchestrator.post.mockRejectedValueOnce(unavailable())
    addNodeRuleMock.mockResolvedValueOnce({ status: 'created' })

    const { POST } = handlersOf(await import('./route'))
    const res = await callRoute(POST, { params: PARAMS, body: RULE })

    expect(res.status).toBe(201)
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
    orchestrator.post.mockRejectedValueOnce(NO_MESSAGE)

    const { POST } = handlersOf(await import('./route'))
    const res = await callRoute(POST, { params: PARAMS, body: RULE })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Failed to add node rule' })
  })

  it('returns the RBAC denial without calling either backend', async () => {
    checkPermissionMock.mockResolvedValueOnce(denied(403, 'Forbidden'))

    const { POST } = handlersOf(await import('./route'))
    const res = await callRoute(POST, { params: PARAMS, body: RULE })

    expect(res.status).toBe(403)
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
