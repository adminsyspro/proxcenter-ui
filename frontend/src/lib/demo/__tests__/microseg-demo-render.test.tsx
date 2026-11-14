/**
 * The Micro-segmentation tab, fed by the demo mocks instead of the test kit: the map draws the five zones with their
 * members, and nothing is drawn above the sub-tabs, which the demo policy has no reason to fill.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

import { renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import DashboardTab from '@/app/(dashboard)/automation/network/components/DashboardTab'
import MicrosegTab from '@/app/(dashboard)/automation/network/components/microseg/MicrosegTab'

import { demoResponse } from '../demo-api'

vi.mock('@xyflow/react/dist/style.css', () => ({}))
vi.mock('@xyflow/react', async () => (await import('@/app/(dashboard)/automation/network/components/microseg/xyflowTestMock')).xyflowMock)

const previousDemoMode = process.env.DEMO_MODE

beforeEach(() => {
  process.env.DEMO_MODE = 'true'
  window.localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const res = await demoResponse(new Request(`http://localhost${url}`, init))

    return res ?? new Response('{}', { status: 404 })
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  process.env.DEMO_MODE = previousDemoMode
})

describe('Micro-segmentation tab on the demo data', () => {
  it('draws the zones with their members and no strip above the sub-tabs', async () => {
    renderWithProviders(
      <SWRConfig value={{ revalidateOnMount: true, dedupingInterval: 0, errorRetryCount: 0, refreshInterval: 0 }}>
        <MicrosegTab connectionId="demo-pve-cluster-001" />
      </SWRConfig>,
    )

    const web = await screen.findByTestId('node-zone:demo-zone-web')

    for (const [zone, count] of [['web', '5 members'], ['app', '6 members'], ['db', '5 members'], ['monitoring', '3 members'], ['infra', '3 members']]) {
      const node = await screen.findByTestId(`node-zone:demo-zone-${zone}`)

      expect(within(node).getByText(zone)).toBeTruthy()
      await waitFor(() => expect(within(node).getByText(count)).toBeTruthy())
    }

    const row = document.querySelector('.MuiTabs-root')!.parentElement as HTMLElement

    expect(row.parentElement!.firstElementChild).toBe(row)
    expect(web).toBeTruthy()
  })
})

describe('Dashboard of the network page on the demo data', () => {
  it('fills its chips, its traffic figures, its services and its time chart from the demo answers', async () => {
    renderWithProviders(
      <SWRConfig value={{ revalidateOnMount: true, dedupingInterval: 0, errorRetryCount: 0, refreshInterval: 0, provider: () => new Map() }}>
        <DashboardTab
          securityGroups={[]}
          clusterOptions={{ enable: 1, policy_in: 'DROP' }}
          clusterRules={[]}
          aliases={[]}
          ipsets={[]}
          firewallMode='cluster'
          currentOptions={{ enable: 1, policy_in: 'DROP' }}
          selectedConnection='demo-pve-cluster-001'
          totalRules={0}
          totalIPSetEntries={0}
          nodesList={[]}
          reload={() => {}}
          onNavigateTab={() => {}}
          onNavigateRulesSubTab={() => {}}
        />
      </SWRConfig>,
    )

    // Three zones enforce inbound; the db zone blocks its outbound.
    await waitFor(() => expect(screen.getByTestId('chip-zones').textContent).toBe('Zones enforced 3 / 5 · outbound 1 / 5'))
    // The guest coverage is read: a count of running guests, not the "-" of a figure not measured.
    await waitFor(() => expect(screen.getByTestId('chip-guests').textContent).toMatch(/^Guests protected \d+ \/ \d+ running$/))
    // The observed flows: would be blocked in the observed zones, blocked in the enforced ones, inbound and outbound.
    await waitFor(() => expect(screen.getByTestId('tile-would-block-value').textContent).toBe('10 flows'))
    expect(screen.getByTestId('tile-blocked-value').textContent).toBe('3 flows')
    expect(screen.getByTestId('tile-blocked').textContent).toContain('outbound from db')
    const services = within(await screen.findByTestId('services-table')).getAllByRole('row').slice(1)

    expect(services.length).toBeGreaterThanOrEqual(6)
    expect(services[0].textContent).toContain('HTTPS')
    // The time chart has the history of the zones to draw.
    await waitFor(() => expect(within(screen.getByTestId('timeline')).getAllByTestId(/^area-/).length).toBeGreaterThan(1))
    // The "To do" list counts the guests the coverage reports without firewall.
    expect(await screen.findByText(/guests without firewall/)).toBeTruthy()
  })
})

