import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  CONN,
  getConnectionByIdMock,
  handlersOf,
  installFirewallRouteMocks,
  orchestrator,
  resetFirewallRouteMocks,
  unavailable,
  verifyConnectionOwnershipMock,
} from '@/__tests__/setup/firewall-route-mocks'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

// getFirewallStatus aggregates a dozen PVE calls, so the fallback is asserted
// at the pveDirect boundary rather than on pveFetch (#616).
const getFirewallStatusMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/firewall/pveDirect', () => ({ getFirewallStatus: getFirewallStatusMock }))

installFirewallRouteMocks()

const STATUS = {
  cluster_enabled: true,
  status: 'enabled/running',
  total_aliases: 2,
  total_ipsets: 1,
  total_groups: 0,
  total_cluster_rules: 4,
  protected_nodes: 1,
  total_nodes: 1,
  protected_vms: 3,
  total_vms: 5,
}

beforeEach(() => {
  resetFirewallRouteMocks()
  getFirewallStatusMock.mockResolvedValue(STATUS)
})

describe('GET /api/v1/firewall?connectionId=', () => {
  it('returns the orchestrator status unwrapped and never touches PVE', async () => {
    orchestrator.get.mockResolvedValue({ data: STATUS, status: 200 })

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { searchParams: { connectionId: 'conn-1' } })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual(STATUS)
    expect(orchestrator.get).toHaveBeenCalledWith('/firewall/status/conn-1')
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
    expect(getFirewallStatusMock).not.toHaveBeenCalled()
  })

  it('computes the status from PVE when the orchestrator is unavailable', async () => {
    orchestrator.get.mockRejectedValue(unavailable())

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { searchParams: { connectionId: 'conn-1' } })

    expect(res.status).toBe(200)

    // Bare object, not { data: ... }: the firewall toggle reads
    // cluster_enabled off the response root.
    expect(await readJson(res)).toEqual(STATUS)
    expect(getConnectionByIdMock).toHaveBeenCalledWith('conn-1')
    expect(getFirewallStatusMock).toHaveBeenCalledWith(CONN)
  })

  it('propagates a non-unavailable orchestrator error as a 500 without touching PVE', async () => {
    orchestrator.get.mockRejectedValue(new Error('Orchestrator 403: feature not licensed'))

    const { GET } = handlersOf(await import('./route'))
    const res = await callRoute(GET, { searchParams: { connectionId: 'conn-1' } })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Orchestrator 403: feature not licensed' })
    expect(getFirewallStatusMock).not.toHaveBeenCalled()
  })

  it('rejects a missing or malformed connectionId before any lookup', async () => {
    const { GET } = handlersOf(await import('./route'))

    const missing = await callRoute(GET, {})

    expect(missing.status).toBe(400)
    expect(await readJson<any>(missing)).toEqual({ error: 'connectionId is required' })

    const malformed = await callRoute(GET, { searchParams: { connectionId: '../../etc/passwd' } })

    expect(malformed.status).toBe(400)
    expect(await readJson<any>(malformed)).toEqual({ error: 'Invalid connectionId format' })
    expect(verifyConnectionOwnershipMock).not.toHaveBeenCalled()
    expect(orchestrator.get).not.toHaveBeenCalled()
  })
})
