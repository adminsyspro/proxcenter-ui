/**
 * ClusterSdnVNetFirewallPanel loads the VNets on mount (fire-and-forget async
 * IIFE in the mount effect), selects the first one and fetches its rules.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import ClusterSdnVNetFirewallPanel from './ClusterSdnVNetFirewallPanel'

afterEach(cleanup)

describe('ClusterSdnVNetFirewallPanel', () => {
  it('loads the VNets on mount then fetches the rules of the first one', async () => {
    const ruleRequests: string[] = []

    server.use(
      http.get('*/api/v1/connections/conn-1/sdn/vnets', () =>
        HttpResponse.json({ data: { vnets: [{ vnet: 'vnet 10', alias: 'prod' }, { vnet: 'vnet20' }] } }),
      ),
      http.get('*/api/v1/connections/conn-1/sdn/vnets/:vnet/firewall/rules', ({ request }) => {
        ruleRequests.push(new URL(request.url).pathname)

        return HttpResponse.json({ data: { rules: [] } })
      }),
    )

    renderWithProviders(<ClusterSdnVNetFirewallPanel connId="conn-1" />)

    expect(await screen.findByText('vnet 10 (prod)')).toBeInTheDocument()
    await waitFor(() =>
      expect(ruleRequests).toEqual(['/api/v1/connections/conn-1/sdn/vnets/vnet%2010/firewall/rules']),
    )
  })

  it('shows the empty-VNets notice when the cluster has none', async () => {
    server.use(http.get('*/api/v1/connections/conn-1/sdn/vnets', () => HttpResponse.json({ data: { vnets: [] } })))

    renderWithProviders(<ClusterSdnVNetFirewallPanel connId="conn-1" />)

    expect(await screen.findByText(/No VNets configured/)).toBeInTheDocument()
  })
})
