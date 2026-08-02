// Wiring tests for the security-group list/create route (#616): Community
// installs run without an orchestrator, so these handlers must fall back to
// direct PVE — but ONLY on ORCHESTRATOR_UNAVAILABLE, and without changing the
// bodies or status codes the UI already relies on.

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
} from '@/__tests__/setup/firewall-route-mocks'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

const getSecurityGroupsMock = vi.fn<(...args: any[]) => Promise<any>>()
const createSecurityGroupMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/firewall/pveDirect', () => ({
  getSecurityGroups: getSecurityGroupsMock,
  createSecurityGroup: createSecurityGroupMock,
}))

installFirewallRouteMocks()

const GROUPS = [
  { group: 'web', comment: 'HTTP', rules: [{ pos: 0, type: 'in', action: 'ACCEPT', enable: 1 }] },
  { group: 'db', rules: [] },
]

beforeEach(resetFirewallRouteMocks)

describe('GET /api/v1/firewall/groups/[connectionId]', () => {
  it('returns the orchestrator payload unwrapped and never touches PVE', async () => {
    orchestrator.get.mockResolvedValue({ data: GROUPS, status: 200 })

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: { connectionId: 'conn-1' } })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual(GROUPS)
    expect(orchestrator.get).toHaveBeenCalledWith('/firewall/groups/conn-1')
    expect(getSecurityGroupsMock).not.toHaveBeenCalled()
    // Enterprise path pays nothing: the connection is only loaded for PVE.
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('falls back to direct PVE with the resolved connection when the orchestrator is unreachable', async () => {
    orchestrator.get.mockRejectedValue(unavailable())
    getSecurityGroupsMock.mockResolvedValue(GROUPS)

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: { connectionId: 'conn-1' } })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual(GROUPS)
    expect(getConnectionByIdMock).toHaveBeenCalledWith('conn-1')
    expect(getSecurityGroupsMock).toHaveBeenCalledWith(CONN)
  })

  it('keeps the group list a bare array on both paths (a { data } wrapper empties the group picker)', async () => {
    orchestrator.get.mockResolvedValue({ data: GROUPS, status: 200 })

    const { GET } = handlersOf(await import('./route'))
    const viaOrchestrator = await readJson<any>(await callRoute(GET, { params: { connectionId: 'conn-1' } }))

    orchestrator.get.mockRejectedValue(unavailable())
    getSecurityGroupsMock.mockResolvedValue(GROUPS)

    const viaPve = await readJson<any>(await callRoute(GET, { params: { connectionId: 'conn-1' } }))

    for (const body of [viaOrchestrator, viaPve]) {
      expect(Array.isArray(body)).toBe(true)
      expect(body).toHaveLength(2)
      expect(body.data).toBeUndefined()
      expect(body[0].group).toBe('web')
      expect(body[0].rules).toEqual([{ pos: 0, type: 'in', action: 'ACCEPT', enable: 1 }])
    }
  })

  it('propagates a non-unavailable orchestrator error as a 500 without calling PVE', async () => {
    orchestrator.get.mockRejectedValue(new Error('Orchestrator 403: license required'))

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: { connectionId: 'conn-1' } })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Orchestrator 403: license required' })
    expect(getSecurityGroupsMock).not.toHaveBeenCalled()
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('returns the RBAC denial without calling either backend', async () => {
    checkPermissionMock.mockResolvedValue(denied(403, 'forbidden'))

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: { connectionId: 'conn-1' } })

    expect(res.status).toBe(403)
    expect(orchestrator.get).not.toHaveBeenCalled()
    expect(getSecurityGroupsMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/firewall/groups/[connectionId]', () => {
  const body = { group: 'web', comment: 'HTTP' }

  it('creates through the orchestrator and keeps the 201', async () => {
    orchestrator.post.mockResolvedValue({ data: { status: 'created' }, status: 200 })

    const { POST } = handlersOf(await import('./route'))
    const res = await callRoute(POST, { params: { connectionId: 'conn-1' }, body })

    expect(res.status).toBe(201)
    expect(await readJson<any>(res)).toEqual({ status: 'created' })
    expect(orchestrator.post).toHaveBeenCalledWith('/firewall/groups/conn-1', body)
    expect(createSecurityGroupMock).not.toHaveBeenCalled()
  })

  it('falls back to direct PVE with the parsed body and keeps the 201', async () => {
    orchestrator.post.mockRejectedValue(unavailable())
    createSecurityGroupMock.mockResolvedValue({ status: 'created' })

    const { POST } = handlersOf(await import('./route'))
    const res = await callRoute(POST, { params: { connectionId: 'conn-1' }, body })

    expect(res.status).toBe(201)
    expect(await readJson<any>(res)).toEqual({ status: 'created' })
    expect(createSecurityGroupMock).toHaveBeenCalledWith(CONN, body)
  })

  it('propagates a non-unavailable orchestrator error as a 500 without calling PVE', async () => {
    orchestrator.post.mockRejectedValue(new Error('Orchestrator 500: group exists'))

    const { POST } = handlersOf(await import('./route'))
    const res = await callRoute(POST, { params: { connectionId: 'conn-1' }, body })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Orchestrator 500: group exists' })
    expect(createSecurityGroupMock).not.toHaveBeenCalled()
  })
})
