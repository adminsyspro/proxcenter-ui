import { describe, it, expect, vi, beforeEach } from 'vitest'

// The API token guard is covered by routeGuard.test.ts and writeContract.test.ts:
// pass-through so this file keeps testing the handler, as for a session caller.
vi.mock('@/lib/api-tokens/routeGuard', () => ({
  withPublicApiGuard: (_entryId: string, handler: any) => handler,
}))

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

// Next hands the path segment decoded once: the client's %2F is a slash here.
const PARAMS = { connectionId: 'conn-1', ipsetName: 'blacklist', cidr: '10.0.0.0/8' }

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

  it.each(['10.0.0.1%zz', '10.0.0.0%2F8'])('answers 400 on a CIDR still holding an escape (%s), before the orchestrator or PVE', async cidr => {
    const { DELETE } = handlersOf(await import('./route'))
    const res = await callRoute(DELETE, { params: { ...PARAMS, cidr }, method: 'DELETE' })

    expect(res.status).toBe(400)
    expect(await readJson<any>(res)).toEqual({ error: 'Malformed CIDR' })
    expect(orchestrator.delete).not.toHaveBeenCalled()
    expect(deleteIPSetEntryMock).not.toHaveBeenCalled()
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
