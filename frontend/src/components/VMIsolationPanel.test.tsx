/**
 * VMIsolationPanel: the per-row settings button opens the VM detail (status +
 * simulation fetched), and a successful isolation reloads the VM list.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import VMIsolationPanel from './VMIsolationPanel'

afterEach(cleanup)

const BASE = '*/api/v1/firewall/microseg/conn-1'

const VM = {
  vmid: 101, name: 'web-01', node: 'pve1', type: 'qemu', status: 'running', network: 'vlan10',
  networks: ['vlan10'], firewall_enabled: false, is_isolated: false, missing_base_sgs: [], applied_sgs: [],
}

const STATE = { firewall_enabled: false, policy_in: 'ACCEPT', policy_out: 'ACCEPT', is_isolated: false, applied_sgs: [] }

function seed(counter: { list: number; isolate: unknown[] }) {
  server.use(
    http.get(`${BASE}/vms`, () => {
      counter.list++

      return HttpResponse.json({ total_vms: 1, isolated_vms: 0, unprotected_vms: 1, vms: [VM] })
    }),
    http.get(`${BASE}/vm/pve1/qemu/101`, () =>
      HttpResponse.json({
        vmid: 101, name: 'web-01', node: 'pve1', firewall_enabled: false, policy_in: 'ACCEPT', policy_out: 'ACCEPT',
        networks: [{ interface: 'net0', bridge: 'vmbr0', ip_address: '10.0.10.5', network: 'vlan10', gateway: '10.0.10.1', base_sg: 'sg-base-vlan10', firewall: false }],
        is_isolated: false, applied_base_sgs: [], applied_sgs: [], direct_rules: 0, recommendations: [],
      }),
    ),
    http.get(`${BASE}/vm/pve1/qemu/101/simulate`, () =>
      HttpResponse.json({
        vmid: 101, name: 'web-01', current_state: STATE, simulated_state: { ...STATE, is_isolated: true },
        allowed_flows: [], blocked_flows: [], affected_vms: [], warnings: [], required_actions: [],
      }),
    ),
    http.post(`${BASE}/vm/pve1/qemu/101/isolate`, async ({ request }) => {
      counter.isolate.push(await request.json())

      return HttpResponse.json({ ok: true })
    }),
  )
}

describe('VMIsolationPanel', () => {
  it('opens the detail from the row settings button and reloads the list after isolating', async () => {
    const counter = { list: 0, isolate: [] as unknown[] }

    seed(counter)
    renderWithProviders(<VMIsolationPanel connectionId="conn-1" />)

    expect(await screen.findByText('web-01')).toBeInTheDocument()
    expect(counter.list).toBe(1)

    fireEvent.click(document.querySelector('.ri-settings-3-line')!.closest('button')!)

    const isolate = await screen.findByRole('button', { name: /Enable isolation \(1 interface\)/ })

    fireEvent.click(isolate)

    await waitFor(() => expect(counter.list).toBe(2))
    expect(counter.isolate).toEqual([
      {
        enable_firewall: true, set_policy_in_drop: true, set_policy_out_drop: false,
        apply_base_sgs: true, additional_sgs: ['sg-base-vlan10'], enable_nic_fw: true,
      },
    ])
    expect(await screen.findByText('VM web-01 isolated in standard mode (1 SG applied)')).toBeInTheDocument()
  })
})
