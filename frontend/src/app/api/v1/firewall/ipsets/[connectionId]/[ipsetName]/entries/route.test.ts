// Wiring tests for the IP-set entry create route (#616). Community installs
// have no orchestrator, so POST must fall back to direct PVE — only on
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

const addIPSetEntryMock = vi.fn<(conn: any, ipsetName: string, req: any) => Promise<any>>()

vi.mock('@/lib/firewall/pveDirect', () => ({ addIPSetEntry: addIPSetEntryMock }))

installFirewallRouteMocks()

const PARAMS = { connectionId: 'conn-1', ipsetName: 'blacklist' }

beforeEach(resetFirewallRouteMocks)

describe('POST /api/v1/firewall/ipsets/[connectionId]/[ipsetName]/entries', () => {
  const body = { cidr: '10.0.0.0/8', comment: 'internal', nomatch: false }

  it('creates through the orchestrator and keeps the 201 with its body', async () => {
    orchestrator.post.mockResolvedValue({ data: { status: 'created' }, status: 200 })

    const { POST } = handlersOf(await import('./route'))
    const res = await callRoute(POST, { params: PARAMS, body })

    expect(res.status).toBe(201)
    expect(await readJson<any>(res)).toEqual({ status: 'created' })
    expect(orchestrator.post).toHaveBeenCalledWith('/firewall/ipsets/conn-1/blacklist/entries', body)
    expect(addIPSetEntryMock).not.toHaveBeenCalled()
    // The Enterprise path must not pay for the connection lookup
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('creates via direct PVE when the orchestrator is unavailable, keeping the 201', async () => {
    orchestrator.post.mockRejectedValue(unavailable())
    addIPSetEntryMock.mockResolvedValue({ status: 'created' })

    const { POST } = handlersOf(await import('./route'))
    const res = await callRoute(POST, { params: PARAMS, body })

    expect(res.status).toBe(201)
    expect(await readJson<any>(res)).toEqual({ status: 'created' })
    expect(getConnectionByIdMock).toHaveBeenCalledWith('conn-1')
    // The raw ipset path param plus the parsed body, untouched
    expect(addIPSetEntryMock).toHaveBeenCalledWith(CONN, 'blacklist', body)
  })

  it('propagates a non-unavailable orchestrator error as a 500 and never writes to PVE', async () => {
    orchestrator.post.mockRejectedValue(new Error('Orchestrator 500: entry already exists'))

    const { POST } = handlersOf(await import('./route'))
    const res = await callRoute(POST, { params: PARAMS, body })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Orchestrator 500: entry already exists' })
    expect(addIPSetEntryMock).not.toHaveBeenCalled()
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('falls back to a generic message when the thrown value carries none', async () => {
    // A non-Error rejection has no .message: the 500 must still say something.
    orchestrator.post.mockRejectedValue({ code: 'ECONNRESET' })

    const { POST } = handlersOf(await import('./route'))
    const res = await callRoute(POST, { params: PARAMS, body })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Failed to add entry' })
    expect(addIPSetEntryMock).not.toHaveBeenCalled()
  })

  it('returns the ownership denial before reading the body or calling anything', async () => {
    verifyConnectionOwnershipMock.mockResolvedValue(denied(404, 'Connection not found'))

    const { POST } = handlersOf(await import('./route'))
    const res = await callRoute(POST, { params: { ...PARAMS, connectionId: 'conn-other' }, body })

    expect(res.status).toBe(404)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(orchestrator.post).not.toHaveBeenCalled()
    expect(addIPSetEntryMock).not.toHaveBeenCalled()
  })

  it('returns the RBAC denial without calling either backend', async () => {
    checkPermissionMock.mockResolvedValue(denied(403, 'Forbidden'))

    const { POST } = handlersOf(await import('./route'))
    const res = await callRoute(POST, { params: PARAMS, body })

    expect(res.status).toBe(403)
    expect(orchestrator.post).not.toHaveBeenCalled()
    expect(addIPSetEntryMock).not.toHaveBeenCalled()
  })
})
