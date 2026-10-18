/**
 * FlowsTab, sFlow agents card (roadmap#52, ui#1066): the Telemetry column
 * follows the collector's verdict, a silent node gets the diagnostics box,
 * an agent heard under an unknown address is listed, and "Verify reception"
 * asks the orchestrator again. The charts are covered elsewhere.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

vi.mock('next/dynamic', () => ({ default: () => () => null }))

import FlowsTab from './FlowsTab'

const NODES = [
  { node: 'pve2', ip: '10.0.0.2', connectionId: 'c1', connectionName: 'DR', online: true, hasOvs: true, ovsVersion: '3.5.0', sflowConfigured: true, sflowTarget: '10.0.0.9:6343', sflowSampling: 512, bridges: ['vmbr1'] },
  { node: 'pve3', ip: '10.0.0.3', connectionId: 'c1', connectionName: 'DR', online: true, hasOvs: true, ovsVersion: '3.5.0', sflowConfigured: true, sflowTarget: '10.0.0.9:6343', sflowSampling: 512, bridges: ['vmbr1'] },
  { node: 'pve4', ip: '10.0.0.4', connectionId: 'c1', connectionName: 'DR', online: true, hasOvs: true, ovsVersion: '3.5.0', sflowConfigured: true, sflowTarget: '10.0.0.9:6343', sflowSampling: 512, bridges: ['vmbr1'] },
]

function agent(node: string, ip: string, state: string, extra: Record<string, unknown> = {}) {
  return {
    connection_id: 'c1', connection_name: 'DR', node, agent_ip: ip, target: '10.0.0.9:6343',
    polling_interval: 30, sampling_rate: 512, configured_at: '2026-10-16T10:00:00Z', state,
    seconds_since_seen: -1, seconds_silent: 0, timeout_seconds: 120, grace_seconds: 300,
    flow_rate: 0, sample_count: 0, datagram_count: 0, counter_count: 0, detail: `${node} detail`,
    ...extra,
  }
}

const HEALTH = {
  evaluated_at: '2026-10-16T12:00:00Z',
  collector_enabled: true,
  agents: [
    agent('pve2', '10.0.0.2', 'receiving', { last_seen: '2026-10-16T11:59:50Z', seconds_since_seen: 10, datagram_count: 4 }),
    agent('pve3', '10.0.0.3', 'missing', { detail: 'No sFlow datagram from 10.0.0.3 for 2m 25s' }),
    agent('pve4', '10.0.0.4', 'identity_unknown', { detail: 'Never heard, while 172.16.0.4 is' }),
  ],
  unmatched_agents: [],
  alerts_enabled: false,
  timeout_seconds: 120,
  grace_seconds: 300,
}

const STATUS = {
  enabled: true,
  listen_address: '0.0.0.0:6343',
  agents: [
    { agent_ip: '10.0.0.2', node: 'pve2', last_seen: '2026-10-16T11:59:50Z', flow_rate: 0, sample_count: 0, active: true, datagram_count: 4 },
    { agent_ip: '172.16.0.4', node: '', last_seen: '2026-10-16T11:59:55Z', flow_rate: 0, sample_count: 12, active: true },
  ],
  total_flows: 0, flow_rate: 0, active_vms: 0,
}

function answer(data: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => data }
}

let health: unknown = HEALTH
let status: unknown = STATUS
const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input)
  if (url.startsWith('/api/v1/orchestrator/sflow/agents')) return answer({ data: NODES })
  const endpoint = new URLSearchParams(url.split('?')[1] ?? '').get('endpoint')
  if (endpoint === 'health') return health instanceof Error ? answer({}, false) : answer(health)
  if (endpoint === 'status') return answer(status)
  return answer([])
})

const healthCalls = () => fetchMock.mock.calls.filter(c => String(c[0]).includes('endpoint=health')).length

beforeEach(() => {
  health = HEALTH
  status = STATUS
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function renderTab() {
  renderWithProviders(<FlowsTab />)
  await screen.findByTestId('last-received-pve2')
}

describe('FlowsTab sFlow agents card', () => {
  it('paints each node with the collector verdict and counts the states in the header', async () => {
    await renderTab()

    const rowOf = (node: string) => screen.getByTestId(`last-received-${node}`).closest('tr') as HTMLElement
    expect(within(rowOf('pve2')).getByText('Receiving')).toBeTruthy()
    expect(within(rowOf('pve3')).getByText('Telemetry missing')).toBeTruthy()
    expect(within(rowOf('pve4')).getByText('Agent address unknown')).toBeTruthy()

    expect(screen.getByTestId('telemetry-summary-receiving').textContent).toBe('1 receiving')
    expect(screen.getByTestId('telemetry-summary-missing').textContent).toBe('1 telemetry missing')
    expect(screen.getByTestId('telemetry-summary-identity_unknown')).toBeTruthy()
  })

  it('shows when a node last sent, or never, with the elapsed time and the datagram count', async () => {
    await renderTab()

    expect(screen.getByTestId('last-received-pve2').textContent).toContain('10 s ago')
    expect(screen.getByTestId('last-received-pve3').textContent).toBe('never')
    expect(screen.getByText('4 datagrams')).toBeTruthy()
  })

  it('lists the silent and unidentified nodes with their diagnostics, and says when alerts are off', async () => {
    await renderTab()

    const box = screen.getByTestId('telemetry-missing-alert')
    expect(within(box).getByText('1 configured node sends no telemetry')).toBeTruthy()
    expect(box.textContent).toContain('pve3 (10.0.0.3): No sFlow datagram from 10.0.0.3 for 2m 25s')
    expect(box.textContent).toContain('pve4 (10.0.0.4): Never heard, while 172.16.0.4 is')
    expect(within(box).getByText(/Telemetry alerts are switched off/)).toBeTruthy()
  })

  it('names the active agents heard under an address no node is listed under', async () => {
    await renderTab()

    expect(screen.getByText('Samples received from addresses no node is listed under')).toBeTruthy()
    expect(screen.getByText(/^172\.16\.0\.4: these sFlow agents report/)).toBeTruthy()
  })

  it('asks the orchestrator again on "Verify reception"', async () => {
    await renderTab()
    const before = healthCalls()

    fireEvent.click(screen.getByText('Verify reception').closest('button') as HTMLElement)

    await waitFor(() => expect(healthCalls()).toBe(before + 1))
  })

  it('keeps the table when the health route fails: configured nodes stay neutral', async () => {
    health = new Error('older orchestrator')
    await renderTab()

    expect(screen.getAllByText('Configured')).toHaveLength(3)
    expect(screen.queryByTestId('telemetry-missing-alert')).toBeNull()
    expect(screen.getByTestId('last-received-pve2').textContent).not.toBe('never')
  })

  it('offers no reception check while the collector is off', async () => {
    status = { ...STATUS, enabled: false }
    await renderTab()

    expect(screen.queryByText('Verify reception')).toBeNull()
    expect(screen.queryByTestId('telemetry-missing-alert')).toBeNull()
  })
})
