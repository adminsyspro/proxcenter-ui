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

// pveDirect is stubbed, the fallback helper (withPveFallback) is the real one:
// what is under test here is the wiring, i.e. which backend gets called and
// what body comes out (#616).
const getVMRulesMock = vi.fn<(...args: any[]) => Promise<any>>()
const getVMOptionsMock = vi.fn<(...args: any[]) => Promise<any>>()
const addVMRuleMock = vi.fn<(...args: any[]) => Promise<any>>()
const updateVMOptionsMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/firewall/pveDirect', () => ({
  getVMRules: getVMRulesMock,
  getVMOptions: getVMOptionsMock,
  addVMRule: addVMRuleMock,
  updateVMOptions: updateVMOptionsMock,
}))

installFirewallRouteMocks()

const PARAMS = { connectionId: 'conn-1', node: 'pve1', vmType: 'qemu', vmid: '101' }

const RULES = [
  { pos: 0, type: 'in', action: 'ACCEPT', enable: 1, dport: '22', proto: 'tcp' },
  { pos: 1, type: 'in', action: 'DROP', enable: '1', source: '10.0.0.0/8' },
]

beforeEach(resetFirewallRouteMocks)

describe('GET /api/v1/firewall/vms/[connectionId]/[node]/[vmType]/[vmid]', () => {
  it('returns the orchestrator rules unwrapped and never touches PVE', async () => {
    orchestrator.get.mockResolvedValueOnce({ data: RULES, status: 200 })

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: PARAMS, searchParams: { type: 'rules' } })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual(RULES)
    expect(orchestrator.get).toHaveBeenCalledWith('/firewall/vms/conn-1/pve1/qemu/101/rules')
    expect(getVMRulesMock).not.toHaveBeenCalled()

    // The connection is loaded lazily inside the fallback closure: the
    // Enterprise path must not pay for a DB read + token decrypt.
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('falls back to getVMRules with the raw path params when the orchestrator is unreachable', async () => {
    orchestrator.get.mockRejectedValueOnce(unavailable())
    getVMRulesMock.mockResolvedValueOnce(RULES)

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: PARAMS, searchParams: { type: 'rules' } })

    expect(res.status).toBe(200)
    expect(getVMRulesMock).toHaveBeenCalledWith(CONN, 'pve1', 'qemu', '101')

    // Bare array, exactly what the orchestrator would have returned
    expect(await readJson<any>(res)).toEqual(RULES)
  })

  it('keeps the fallback rules list intact through normalizeRules (no { data } wrapper)', async () => {
    orchestrator.get.mockRejectedValueOnce(unavailable())
    getVMRulesMock.mockResolvedValueOnce(RULES)

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: PARAMS, searchParams: { type: 'rules' } })

    // The component layer runs the body through normalizeRules, which does an
    // Array.isArray check: a { data: [...] } wrapper anywhere in the chain
    // would silently render an empty rules table instead of failing loudly.
    const { normalizeRules } = await import('@/components/firewall/shared')
    const normalized = normalizeRules(await readJson<any>(res))

    expect(normalized).toHaveLength(2)
    expect(normalized[0]).toMatchObject({ pos: 0, action: 'ACCEPT', enable: 1 })
    expect(normalized[1]).toMatchObject({ pos: 1, action: 'DROP', enable: 1 })
  })

  it('falls back to getVMOptions when type is options', async () => {
    orchestrator.get.mockRejectedValueOnce(unavailable())
    getVMOptionsMock.mockResolvedValueOnce({ enable: 1, policy_in: 'DROP' })

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: PARAMS, searchParams: { type: 'options' } })

    expect(res.status).toBe(200)
    expect(getVMOptionsMock).toHaveBeenCalledWith(CONN, 'pve1', 'qemu', '101')
    expect(getVMRulesMock).not.toHaveBeenCalled()
    expect(await readJson<any>(res)).toEqual({ enable: 1, policy_in: 'DROP' })
  })

  it('propagates a non-unavailable orchestrator error as a 500 without calling PVE', async () => {
    orchestrator.get.mockRejectedValueOnce(new Error('Orchestrator 403: enterprise license required'))

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: PARAMS, searchParams: { type: 'rules' } })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Orchestrator 403: enterprise license required' })
    expect(getVMRulesMock).not.toHaveBeenCalled()
  })

  it('returns the RBAC denial without calling either backend', async () => {
    checkPermissionMock.mockResolvedValueOnce(denied(403, 'Forbidden'))

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: PARAMS, searchParams: { type: 'rules' } })

    expect(res.status).toBe(403)
    expect(orchestrator.get).not.toHaveBeenCalled()
    expect(getVMRulesMock).not.toHaveBeenCalled()
  })

  it('returns the ownership denial without calling either backend', async () => {
    verifyConnectionOwnershipMock.mockResolvedValueOnce(denied(404, 'Not found'))

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: PARAMS, searchParams: { type: 'rules' } })

    expect(res.status).toBe(404)
    expect(orchestrator.get).not.toHaveBeenCalled()
    expect(getVMRulesMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/firewall/vms/[connectionId]/[node]/[vmType]/[vmid]', () => {
  const RULE = { type: 'in', action: 'ACCEPT', dport: '443', proto: 'tcp' }

  it('returns 201 with the orchestrator body and never touches PVE', async () => {
    orchestrator.post.mockResolvedValueOnce({ data: { status: 'created' }, status: 200 })

    const { POST } = handlersOf(await import('./route'))
    const res = await callRoute(POST, { params: PARAMS, body: RULE })

    expect(res.status).toBe(201)
    expect(await readJson<any>(res)).toEqual({ status: 'created' })
    expect(orchestrator.post).toHaveBeenCalledWith('/firewall/vms/conn-1/pve1/qemu/101/rules', RULE)
    expect(addVMRuleMock).not.toHaveBeenCalled()
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('falls back to addVMRule with the parsed body and still answers 201', async () => {
    orchestrator.post.mockRejectedValueOnce(unavailable())
    addVMRuleMock.mockResolvedValueOnce({ status: 'created' })

    const { POST } = handlersOf(await import('./route'))
    const res = await callRoute(POST, { params: PARAMS, body: RULE })

    expect(res.status).toBe(201)
    expect(addVMRuleMock).toHaveBeenCalledWith(CONN, 'pve1', 'qemu', '101', RULE)
    expect(await readJson<any>(res)).toEqual({ status: 'created' })
  })

  it('propagates a non-unavailable orchestrator error as a 500 without calling PVE', async () => {
    orchestrator.post.mockRejectedValueOnce(new Error('Orchestrator request timeout'))

    const { POST } = handlersOf(await import('./route'))
    const res = await callRoute(POST, { params: PARAMS, body: RULE })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Orchestrator request timeout' })
    expect(addVMRuleMock).not.toHaveBeenCalled()
  })
})

describe('PUT /api/v1/firewall/vms/[connectionId]/[node]/[vmType]/[vmid]', () => {
  it('falls back to updateVMOptions when the orchestrator is unreachable', async () => {
    orchestrator.put.mockRejectedValueOnce(unavailable())
    updateVMOptionsMock.mockResolvedValueOnce({ status: 'updated' })

    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: PARAMS, body: { enable: 1 }, method: 'PUT' })

    expect(res.status).toBe(200)
    expect(updateVMOptionsMock).toHaveBeenCalledWith(CONN, 'pve1', 'qemu', '101', { enable: 1 })
    expect(await readJson<any>(res)).toEqual({ status: 'updated' })
  })

  it('returns the orchestrator body unwrapped and never touches PVE', async () => {
    orchestrator.put.mockResolvedValueOnce({ data: { status: 'updated' }, status: 200 })

    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: PARAMS, body: { enable: 0 }, method: 'PUT' })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ status: 'updated' })
    expect(orchestrator.put).toHaveBeenCalledWith('/firewall/vms/conn-1/pve1/qemu/101/options', { enable: 0 })
    expect(updateVMOptionsMock).not.toHaveBeenCalled()
  })
})
