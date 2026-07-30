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

// pveDirect is stubbed rather than pveFetch so the assertions can pin down
// which helper the Community fallback reaches for, and with which arguments
// (#616). The bare-shape contract of the helpers themselves is pveDirect's
// own test's job.
const getAliasesMock = vi.fn<(...args: any[]) => Promise<any>>()
const createAliasMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/firewall/pveDirect', () => ({
  getAliases: getAliasesMock,
  createAlias: createAliasMock,
}))

installFirewallRouteMocks()

const ALIASES = [
  { name: 'web-servers', cidr: '10.0.10.0/24', comment: 'front tier' },
  { name: 'db-servers', cidr: '10.0.20.0/24' },
]

beforeEach(resetFirewallRouteMocks)

describe('GET /api/v1/firewall/aliases/[connectionId]', () => {
  it('returns the orchestrator list unwrapped and never touches PVE', async () => {
    orchestrator.get.mockResolvedValue({ data: ALIASES, status: 200 })

    const { GET } = handlersOf(await import('./route'))

    const res = await callRoute(GET, { params: { connectionId: 'conn-1' } })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual(ALIASES)
    expect(orchestrator.get).toHaveBeenCalledWith('/firewall/aliases/conn-1')
    expect(checkPermissionMock).toHaveBeenCalledWith('node.view', 'connection', 'conn-1')
    expect(getAliasesMock).not.toHaveBeenCalled()

    // The Enterprise path must not pay for the connection lookup: the
    // credentials are only loaded once the fallback actually needs them.
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('falls back to direct PVE when the orchestrator is unavailable (Community, #616)', async () => {
    orchestrator.get.mockRejectedValue(unavailable())
    getAliasesMock.mockResolvedValue(ALIASES)

    const { GET } = handlersOf(await import('./route'))

    const res = await callRoute(GET, { params: { connectionId: 'conn-1' } })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual(ALIASES)
    expect(getConnectionByIdMock).toHaveBeenCalledWith('conn-1')
    expect(getAliasesMock).toHaveBeenCalledWith(CONN)
  })

  it('keeps the fallback list a bare array — a { data } wrapper would empty the UI', async () => {
    orchestrator.get.mockRejectedValue(unavailable())
    getAliasesMock.mockResolvedValue(ALIASES)

    const { GET } = handlersOf(await import('./route'))

    const res = await callRoute(GET, { params: { connectionId: 'conn-1' } })
    const body = await readJson<any>(res)

    // normalizeRules in components/firewall/shared.tsx does an Array.isArray
    // check, so a wrapper here renders as an empty alias list instead of
    // failing loudly — the exact bug class #616 fixes.
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(2)
    expect(body[0].name).toBe('web-servers')
  })

  it('propagates a non-unavailable orchestrator error as a 500 and never touches PVE', async () => {
    orchestrator.get.mockRejectedValue(new Error('Orchestrator 403: feature not licensed'))

    const { GET } = handlersOf(await import('./route'))

    const res = await callRoute(GET, { params: { connectionId: 'conn-1' } })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Orchestrator 403: feature not licensed' })
    expect(getAliasesMock).not.toHaveBeenCalled()
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('answers a generic message when the rejection carries no message', async () => {
    // A non-Error rejection (the orchestrator client can reject with a bare
    // response-shaped object) has no .message, so the route must not answer
    // `{ error: undefined }`.
    orchestrator.get.mockRejectedValue({ status: 502 })

    const { GET } = handlersOf(await import('./route'))

    const res = await callRoute(GET, { params: { connectionId: 'conn-1' } })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Failed to fetch aliases' })
  })

  it('surfaces a failing PVE fallback as a 500 instead of an empty list', async () => {
    orchestrator.get.mockRejectedValue(unavailable())
    getAliasesMock.mockRejectedValue(new Error('PVE 401: authentication failure'))

    const { GET } = handlersOf(await import('./route'))

    const res = await callRoute(GET, { params: { connectionId: 'conn-1' } })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'PVE 401: authentication failure' })
  })

  it('returns the denied Response from RBAC before calling anything', async () => {
    checkPermissionMock.mockResolvedValue(denied(403, 'Forbidden'))

    const { GET } = handlersOf(await import('./route'))

    const res = await callRoute(GET, { params: { connectionId: 'conn-1' } })

    expect(res.status).toBe(403)
    expect(orchestrator.get).not.toHaveBeenCalled()
    expect(getAliasesMock).not.toHaveBeenCalled()
  })

  it('returns the denied Response from the ownership check before calling anything', async () => {
    verifyConnectionOwnershipMock.mockResolvedValue(denied(404, 'Not found'))

    const { GET } = handlersOf(await import('./route'))

    const res = await callRoute(GET, { params: { connectionId: 'conn-other' } })

    expect(res.status).toBe(404)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(orchestrator.get).not.toHaveBeenCalled()
    expect(getAliasesMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/firewall/aliases/[connectionId]', () => {
  const body = { name: 'web-servers', cidr: '10.0.10.0/24', comment: 'front tier' }

  it('creates through the orchestrator and keeps the 201 with its body', async () => {
    orchestrator.post.mockResolvedValue({ data: { status: 'created' }, status: 200 })

    const { POST } = handlersOf(await import('./route'))

    const res = await callRoute(POST, { params: { connectionId: 'conn-1' }, body })

    expect(res.status).toBe(201)
    expect(await readJson(res)).toEqual({ status: 'created' })
    expect(orchestrator.post).toHaveBeenCalledWith('/firewall/aliases/conn-1', body)

    // A write goes through the manage permission, not the view one.
    expect(checkPermissionMock).toHaveBeenCalledWith('node.manage', 'connection', 'conn-1')
    expect(createAliasMock).not.toHaveBeenCalled()
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('creates via direct PVE when the orchestrator is unavailable, keeping the 201', async () => {
    orchestrator.post.mockRejectedValue(unavailable())
    createAliasMock.mockResolvedValue({ status: 'created' })

    const { POST } = handlersOf(await import('./route'))

    const res = await callRoute(POST, { params: { connectionId: 'conn-1' }, body })

    expect(res.status).toBe(201)
    expect(await readJson(res)).toEqual({ status: 'created' })
    expect(getConnectionByIdMock).toHaveBeenCalledWith('conn-1')
    expect(createAliasMock).toHaveBeenCalledWith(CONN, body)
  })

  it('propagates a non-unavailable orchestrator error as a 500 and never writes to PVE', async () => {
    orchestrator.post.mockRejectedValue(new Error('Orchestrator 500: alias already exists'))

    const { POST } = handlersOf(await import('./route'))

    const res = await callRoute(POST, { params: { connectionId: 'conn-1' }, body })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Orchestrator 500: alias already exists' })
    expect(createAliasMock).not.toHaveBeenCalled()
  })

  it('answers a generic message when the rejection carries no message', async () => {
    orchestrator.post.mockRejectedValue('connection reset')

    const { POST } = handlersOf(await import('./route'))

    const res = await callRoute(POST, { params: { connectionId: 'conn-1' }, body })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Failed to create alias' })
  })

  it('returns the denied Response from RBAC without writing anywhere', async () => {
    checkPermissionMock.mockResolvedValue(denied(403, 'Forbidden'))

    const { POST } = handlersOf(await import('./route'))

    const res = await callRoute(POST, { params: { connectionId: 'conn-1' }, body })

    expect(res.status).toBe(403)
    expect(orchestrator.post).not.toHaveBeenCalled()
    expect(createAliasMock).not.toHaveBeenCalled()
  })

  it('returns the denied Response from the ownership check without writing anywhere', async () => {
    verifyConnectionOwnershipMock.mockResolvedValue(denied(404, 'Not found'))

    const { POST } = handlersOf(await import('./route'))

    const res = await callRoute(POST, { params: { connectionId: 'conn-other' }, body })

    expect(res.status).toBe(404)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(orchestrator.post).not.toHaveBeenCalled()
    expect(createAliasMock).not.toHaveBeenCalled()
  })
})
