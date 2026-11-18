/**
 * The requests the Micro-segmentation tab issues on load for a policy of one cluster: exactly those it issued before
 * the shared policies, plus the one read of its group (GET clusters). No read of another cluster, no `connection=`
 * filter.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { screen } from '@/__tests__/setup/renderWithProviders'

import { BASE, fetchMock, mock, renderTab, reply, resetMocks } from './microsegTestKit'

beforeEach(() => {
  resetMocks()
  mock.routes['GET /clusters'] = () => reply(200, {
    clusters: [{ connection_id: 'c1', active: true, stop_cluster_disabled: false, policy_id: 'p1', created_at: '2026-11-01T10:00:00Z', activated_at: null }],
    max: 8,
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const requests = () => fetchMock.mock.calls.map(([url, init]) => `${(init as RequestInit | undefined)?.method ?? 'GET'} ${String(url)}`)

/** Waits until no request has been issued for a while: the load is over. */
async function settled() {
  let seen = -1
  while (seen !== fetchMock.mock.calls.length) {
    seen = fetchMock.mock.calls.length
    await new Promise(resolve => setTimeout(resolve, 400))
  }
}

describe('requests of the tab on load, one cluster', () => {
  it('issues the requests of a policy of one cluster plus exactly one GET clusters', async () => {
    renderTab()
    expect(await screen.findByRole('tab', { name: 'Overview' })).toBeTruthy()
    await settled()

    const issued = requests()
    // What the tab issued on this same load before the shared policies (taken from that code), each once.
    const before = [
      `GET ${BASE}/policy`,
      `GET ${BASE}/runs?limit=100`,
      `GET ${BASE}/status`,
      `GET ${BASE}/suggestions?status=pending&limit=200`,
      'GET /api/v1/vms?connId=c1',
    ]
    expect([...issued].sort()).toEqual([...before, `GET ${BASE}/clusters`].sort())
    for (const r of issued) {
      expect(r).not.toContain('connection=')
      if (r.includes('/firewall/microseg/')) expect(r.startsWith(`GET ${BASE}/`) || r.startsWith(`POST ${BASE}/`)).toBe(true)
      if (r.includes('connId=')) expect(r).toContain('connId=c1')
    }
  })
})
