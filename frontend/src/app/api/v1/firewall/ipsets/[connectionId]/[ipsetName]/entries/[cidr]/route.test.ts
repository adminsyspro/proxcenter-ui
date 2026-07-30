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

const deleteIPSetEntryMock = vi.fn<(conn: any, ipsetName: string, cidr: string) => Promise<any>>()

vi.mock('@/lib/firewall/pveDirect', () => ({ deleteIPSetEntry: deleteIPSetEntryMock }))

installFirewallRouteMocks()

// Next hands the raw (still encoded) path segment: a CIDR carries a slash.
const PARAMS = { connectionId: 'conn-1', ipsetName: 'blacklist', cidr: '10.0.0.0%2F8' }

beforeEach(resetFirewallRouteMocks)

describe('DELETE /api/v1/firewall/ipsets/[connectionId]/[ipsetName]/entries/[cidr]', () => {
  it('deletes through the orchestrator with the re-encoded CIDR and never touches PVE', async () => {
    orchestrator.delete.mockResolvedValue({ data: { status: 'deleted' }, status: 200 })

    const { DELETE } = handlersOf(await import('./route'))
    const res = await callRoute(DELETE, { params: PARAMS, method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ success: true })
    expect(orchestrator.delete).toHaveBeenCalledWith('/firewall/ipsets/conn-1/blacklist/entries/10.0.0.0%2F8')
    expect(deleteIPSetEntryMock).not.toHaveBeenCalled()
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('deletes via direct PVE when the orchestrator is unavailable, passing the decoded CIDR', async () => {
    orchestrator.delete.mockRejectedValue(unavailable())
    deleteIPSetEntryMock.mockResolvedValue({ status: 'deleted' })

    const { DELETE } = handlersOf(await import('./route'))
    const res = await callRoute(DELETE, { params: PARAMS, method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ success: true })
    // pveDirect escapes the CIDR itself — double-encoding would 404 on PVE
    expect(deleteIPSetEntryMock).toHaveBeenCalledWith(CONN, 'blacklist', '10.0.0.0/8')
  })

  it('propagates a non-unavailable orchestrator error as a 500 and never writes to PVE', async () => {
    orchestrator.delete.mockRejectedValue(new Error('Orchestrator request timeout'))

    const { DELETE } = handlersOf(await import('./route'))
    const res = await callRoute(DELETE, { params: PARAMS, method: 'DELETE' })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Orchestrator request timeout' })
    expect(deleteIPSetEntryMock).not.toHaveBeenCalled()
  })
})
