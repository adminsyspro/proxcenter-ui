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

const getIPSetsMock = vi.fn<(conn: any) => Promise<any>>()
const createIPSetMock = vi.fn<(conn: any, req: any) => Promise<any>>()

vi.mock('@/lib/firewall/pveDirect', () => ({
  getIPSets: getIPSetsMock,
  createIPSet: createIPSetMock,
}))

installFirewallRouteMocks()

beforeEach(resetFirewallRouteMocks)

describe('GET /api/v1/firewall/ipsets/[connectionId]', () => {
  it('returns the orchestrator list unwrapped and never touches PVE', async () => {
    orchestrator.get.mockResolvedValue({
      data: [{ name: 'blacklist', comment: 'blocked', members: [{ cidr: '10.0.0.0/8' }] }],
      status: 200,
    })

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: { connectionId: 'conn-1' } })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual([
      { name: 'blacklist', comment: 'blocked', members: [{ cidr: '10.0.0.0/8' }] },
    ])
    expect(orchestrator.get).toHaveBeenCalledWith('/firewall/ipsets/conn-1')
    expect(getIPSetsMock).not.toHaveBeenCalled()
    // The Enterprise path must not pay for the connection lookup
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('falls back to direct PVE when the orchestrator is unavailable (Community, #616)', async () => {
    orchestrator.get.mockRejectedValue(unavailable())
    getIPSetsMock.mockResolvedValue([{ name: 'blacklist', members: [] }])

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: { connectionId: 'conn-1' } })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual([{ name: 'blacklist', members: [] }])
    expect(getIPSetsMock).toHaveBeenCalledWith(CONN)
    expect(getConnectionByIdMock).toHaveBeenCalledWith('conn-1')
  })

  it('keeps the fallback list a bare array — a { data } wrapper would empty the UI', async () => {
    orchestrator.get.mockRejectedValue(unavailable())
    getIPSetsMock.mockResolvedValue([{ name: 'a' }, { name: 'b' }, { name: 'c' }])

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: { connectionId: 'conn-1' } })

    const body = await readJson<any>(res)

    // normalizeRules in components/firewall/shared.tsx does an Array.isArray
    // check: a wrapped list silently renders as empty.
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(3)
  })

  it('propagates a non-unavailable orchestrator error as a 500 and never touches PVE', async () => {
    orchestrator.get.mockRejectedValue(new Error('Orchestrator 403: license required'))

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: { connectionId: 'conn-1' } })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Orchestrator 403: license required' })
    expect(getIPSetsMock).not.toHaveBeenCalled()
  })

  it('returns the denied Response from RBAC before calling anything', async () => {
    checkPermissionMock.mockResolvedValue(denied(403, 'Forbidden'))

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: { connectionId: 'conn-1' } })

    expect(res.status).toBe(403)
    expect(orchestrator.get).not.toHaveBeenCalled()
    expect(getIPSetsMock).not.toHaveBeenCalled()
  })

  it('returns the denied Response from the ownership check before calling anything', async () => {
    verifyConnectionOwnershipMock.mockResolvedValue(denied(404, 'Not found'))

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { params: { connectionId: 'conn-other' } })

    expect(res.status).toBe(404)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(orchestrator.get).not.toHaveBeenCalled()
    expect(getIPSetsMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/firewall/ipsets/[connectionId]', () => {
  const body = { name: 'blacklist', comment: 'blocked' }

  it('creates through the orchestrator and keeps the 201 with its body', async () => {
    orchestrator.post.mockResolvedValue({ data: { status: 'created' }, status: 200 })

    const { POST } = handlersOf(await import('./route'))
    const res = await callRoute(POST, { params: { connectionId: 'conn-1' }, body })

    expect(res.status).toBe(201)
    expect(await readJson<any>(res)).toEqual({ status: 'created' })
    expect(orchestrator.post).toHaveBeenCalledWith('/firewall/ipsets/conn-1', body)
    expect(createIPSetMock).not.toHaveBeenCalled()
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('creates via direct PVE when the orchestrator is unavailable, keeping the 201', async () => {
    orchestrator.post.mockRejectedValue(unavailable())
    createIPSetMock.mockResolvedValue({ status: 'created' })

    const { POST } = handlersOf(await import('./route'))
    const res = await callRoute(POST, { params: { connectionId: 'conn-1' }, body })

    expect(res.status).toBe(201)
    expect(await readJson<any>(res)).toEqual({ status: 'created' })
    expect(createIPSetMock).toHaveBeenCalledWith(CONN, body)
  })

  it('propagates a non-unavailable orchestrator error as a 500 and never writes to PVE', async () => {
    orchestrator.post.mockRejectedValue(new Error('Orchestrator 500: ipset already exists'))

    const { POST } = handlersOf(await import('./route'))
    const res = await callRoute(POST, { params: { connectionId: 'conn-1' }, body })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Orchestrator 500: ipset already exists' })
    expect(createIPSetMock).not.toHaveBeenCalled()
  })
})
