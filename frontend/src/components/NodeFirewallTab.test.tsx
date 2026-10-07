/**
 * NodeFirewallTab loads its options, rules and security groups on mount
 * (fire-and-forget `void fw.loadFirewallData()` in the mount effect).
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import NodeFirewallTab from './NodeFirewallTab'

afterEach(cleanup)

// The policy tiles read the cluster's options; tests that need a value override this.
beforeEach(() => {
  server.use(http.get('*/api/v1/firewall/cluster/conn-1', () => HttpResponse.json({})))
})

describe('NodeFirewallTab', () => {
  it('fetches options, rules and groups on mount and renders them', async () => {
    const seen: string[] = []

    server.use(
      http.get('*/api/v1/firewall/nodes/conn-1/pve1', ({ request }) => {
        const type = new URL(request.url).searchParams.get('type')

        seen.push(type || '')

        if (type === 'options') return HttpResponse.json({ enable: 1, policy_in: 'DROP', policy_out: 'ACCEPT' })

        return HttpResponse.json([
          { pos: 0, type: 'in', action: 'ACCEPT', proto: 'tcp', dport: '22', enable: 1, comment: 'ssh-from-admin-lan' },
        ])
      }),
      http.get('*/api/v1/firewall/groups/conn-1', () => {
        seen.push('groups')

        return HttpResponse.json([])
      }),
    )

    renderWithProviders(<NodeFirewallTab connectionId="conn-1" node="pve1" />)

    expect(await screen.findByText('ssh-from-admin-lan')).toBeInTheDocument()
    await waitFor(() => expect(seen.sort()).toEqual(['groups', 'options', 'rules']))
  })

  it('shows the cluster policy, which the host follows, defaulting like PVE (#1065)', async () => {
    server.use(
      http.get('*/api/v1/firewall/nodes/conn-1/pve1', ({ request }) => {
        const type = new URL(request.url).searchParams.get('type')

        // node options never carry a policy in PVE; a stray one must not be shown
        if (type === 'options') return HttpResponse.json({ enable: 1, policy_in: 'ACCEPT' })

        return HttpResponse.json([])
      }),
      http.get('*/api/v1/firewall/groups/conn-1', () => HttpResponse.json([])),
      http.get('*/api/v1/firewall/cluster/conn-1', () => HttpResponse.json({ policy_out: 'REJECT' })),
    )

    renderWithProviders(<NodeFirewallTab connectionId="conn-1" node="pve1" />)

    expect(await screen.findByText('REJECT')).toBeInTheDocument()
    expect(screen.getByText('DROP')).toBeInTheDocument()
    expect(screen.queryByText('ACCEPT')).not.toBeInTheDocument()
  })

  it('shows the error when the rules request fails', async () => {
    server.use(
      http.get('*/api/v1/firewall/nodes/conn-1/pve1', ({ request }) => {
        const type = new URL(request.url).searchParams.get('type')

        if (type === 'options') return HttpResponse.json({ enable: 0 })

        return HttpResponse.error()
      }),
      http.get('*/api/v1/firewall/groups/conn-1', () => HttpResponse.json([])),
    )

    renderWithProviders(<NodeFirewallTab connectionId="conn-1" node="pve1" />)

    const alert = await screen.findByRole('alert')

    expect(alert.textContent).toMatch(/fetch/i)
    expect(screen.queryByText('ssh-from-admin-lan')).not.toBeInTheDocument()
  })
})
