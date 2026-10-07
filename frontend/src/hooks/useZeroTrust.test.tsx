/**
 * The Zero Trust fetchers read the cluster policy and each guest's firewall
 * state. Both used to disagree with what PVE enforces (#1065): an unset
 * policy_in passed for ACCEPT, and a guest counted as protected on its NIC
 * flag alone. No automatic RTL cleanup is configured in this repo.
 */
import type { ReactNode } from 'react'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

vi.mock('./useRefreshInterval', () => ({ useRefreshInterval: () => 0 }))

import { useFirewallScores, useVMFirewallCoverage } from './useZeroTrust'

afterEach(cleanup)

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)

const CONN = { id: 'conn-1', name: 'PVE-PROD', type: 'pve' }

describe('useFirewallScores', () => {
  it('scores an unset cluster policy as the DROP / ACCEPT that PVE applies', async () => {
    server.use(
      http.get('*/api/v1/connections', () => HttpResponse.json({ data: [CONN] })),
      http.get('*/api/v1/firewall/cluster/conn-1', () => HttpResponse.json({ enable: 1 })),
    )

    const { result } = renderHook(() => useFirewallScores(), { wrapper })

    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data![0]).toMatchObject({ enabled: true, policyIn: 'DROP', policyOut: 'ACCEPT', score: 70 })
  })
})

describe('useVMFirewallCoverage', () => {
  it('counts a guest as firewalled only when its options and a NIC both have the firewall on', async () => {
    const guests = [
      { vmid: 1, node: 'pve1', type: 'qemu' },
      { vmid: 2, node: 'pve1', type: 'qemu' },
      { vmid: 3, node: 'pve1', type: 'lxc' },
    ]
    const nic = { 1: 'virtio=AA,bridge=vmbr0,firewall=1', 2: 'virtio=AB,bridge=vmbr0,firewall=1', 3: 'name=eth0,bridge=vmbr0' } as Record<number, string>
    const enable = { 1: 1, 2: 0, 3: 1 } as Record<number, number>

    server.use(
      http.get('*/api/v1/connections', () => HttpResponse.json({ data: [CONN] })),
      http.get('*/api/v1/vms', () => HttpResponse.json({ data: { vms: guests } })),
      http.get('*/api/v1/connections/conn-1/guests/:type/:node/:vmid/config', ({ params }) =>
        HttpResponse.json({ data: { net0: nic[Number(params.vmid)] } })),
      http.get('*/api/v1/firewall/vms/conn-1/:node/:type/:vmid', ({ params, request }) =>
        new URL(request.url).searchParams.get('type') === 'options'
          ? HttpResponse.json({ enable: enable[Number(params.vmid)] })
          : HttpResponse.json([])),
    )

    const { result } = renderHook(() => useVMFirewallCoverage(true), { wrapper })

    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data!.map((g: any) => [g.vmid, g.firewallEnabled])).toEqual([[1, true], [2, false], [3, false]])
  })
})
