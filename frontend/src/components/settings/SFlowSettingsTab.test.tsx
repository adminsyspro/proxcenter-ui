import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

import { fireEvent, renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'

import SFlowSettingsTab, { type NodeAgent } from './SFlowSettingsTab'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const agent = (over: Partial<NodeAgent>): NodeAgent => ({
  node: 'pve1', ip: '10.0.0.1', connectionId: 'c1', connectionName: 'PROD', online: true, hasOvs: true, ovsVersion: '3.5.0',
  sflowConfigured: true, sflowTarget: '10.0.0.250:6343', sflowSampling: 512, bridges: ['vmbr1'], ...over,
})

const telemetry = (node: string, state: string, over: Record<string, unknown> = {}) => ({
  connection_id: 'c1', connection_name: 'PROD', node, agent_ip: node === 'pve1' ? '10.0.0.1' : '10.0.0.2', target: '10.0.0.250:6343', polling_interval: 30,
  sampling_rate: 512, configured_at: '2026-11-20T10:00:00Z', state, seconds_since_seen: state === 'receiving' ? 4 : -1, seconds_silent: 0,
  timeout_seconds: 90, grace_seconds: 300, flow_rate: 2, sample_count: 10, datagram_count: 20, counter_count: 10, detail: state === 'missing' ? 'No datagram from pve2' : '', ...over,
})

type Stub = { enabled?: boolean; agents?: NodeAgent[]; health?: unknown; post?: unknown; heard?: unknown[] }

function stub(over: Stub = {}) {
  const answer = (body: unknown, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body })
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('endpoint=status')) {
      return answer({ enabled: over.enabled ?? true, listen_address: '0.0.0.0:6343', agents: over.heard ?? [{ agent_ip: '10.0.0.1', node: '', last_seen: '2026-11-20T10:00:00Z', flow_rate: 2.5, sample_count: 1234, active: true, datagram_count: 50 }] })
    }
    if (url.includes('endpoint=health')) return answer(over.health ?? { evaluated_at: 'x', collector_enabled: true, agents: [], unmatched_agents: [], alerts_enabled: true, timeout_seconds: 90, grace_seconds: 300 })
    if (url === '/api/v1/orchestrator/sflow/agents' && init?.method === 'POST') return answer(over.post ?? { configured: 1, total: 1, results: [{ node: 'pve2', success: true }] })
    if (url === '/api/v1/orchestrator/sflow/agents') return answer({ data: over.agents ?? [agent({})] })
    return answer({}, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const render = () => renderWithProviders(
  <SWRConfig value={{ revalidateOnMount: true, dedupingInterval: 0, errorRetryCount: 0, refreshInterval: 0, provider: () => new Map() }}><SFlowSettingsTab /></SWRConfig>,
)

describe('Settings > sFlow', () => {
  it('lists the nodes of each cluster with their Open vSwitch, telemetry, collector, sampling and what the collector heard', async () => {
    stub({
      agents: [agent({}), agent({ node: 'pve2', ip: '10.0.0.2', sflowConfigured: false, sflowTarget: '', sflowSampling: 0 }), agent({ node: 'dr1', ip: '10.1.0.1', connectionName: 'DR', hasOvs: false, online: false })],
      health: { evaluated_at: 'x', collector_enabled: true, agents: [telemetry('pve1', 'receiving')], unmatched_agents: [], alerts_enabled: true, timeout_seconds: 90, grace_seconds: 300 },
    })
    render()
    const row = await screen.findByTestId('sflow-agent-pve1')
    expect(row.textContent).toContain('10.0.0.1')
    expect(row.textContent).toContain('OVS 3.5.0')
    expect(row.textContent).toContain('10.0.0.250:6343')
    expect(row.textContent).toContain('1:512')
    expect(row.textContent).toContain('2.5 f/s')
    expect(row.querySelector('img')).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('telemetry-pve1').dataset.state).toBe('receiving'))
    expect(screen.getByTestId('sflow-agent-dr1').textContent).toContain('No OVS')
    // Two clusters: a heading per cluster.
    expect(screen.getByText('PROD')).toBeTruthy()
    expect(screen.getByText('DR')).toBeTruthy()
    expect(screen.getByTestId('telemetry-summary-receiving')).toBeTruthy()
  })

  it('configures the nodes without sFlow from a dialog of one line per setting, and says the outcome', async () => {
    const fetchMock = stub({ agents: [agent({}), agent({ node: 'pve2', ip: '10.0.0.2', sflowConfigured: false, sflowTarget: '', sflowSampling: 0 })] })
    render()
    fireEvent.click(await screen.findByRole('button', { name: 'Configure sFlow on all nodes' }))
    const dialog = await screen.findByRole('dialog')
    const target = within(dialog).getByRole('textbox', { name: 'Collector Target' })
    fireEvent.change(target, { target: { value: '10.0.0.9:6343' } })
    expect(within(dialog).getByText('pve2 (10.0.0.2)')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Configure sFlow on all nodes' }))
    await waitFor(() => expect(screen.getByText('sFlow configured on 1 of 1 nodes')).toBeTruthy())
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(String(post[1]!.body))).toEqual({ nodes: [{ node: 'pve2', ip: '10.0.0.2', connectionId: 'c1' }], collectorTarget: '10.0.0.9:6343', samplingRate: 512 })
  })

  it('reconfigures one node from its row, and lists the failures of a run', async () => {
    stub({ post: { configured: 0, total: 1, results: [{ node: 'pve1', success: false, error: 'ovs-vsctl failed' }] } })
    render()
    fireEvent.click(await screen.findByRole('button', { name: 'Reconfigure sFlow' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('pve1 (10.0.0.1)')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Configure sFlow on all nodes' }))
    expect(await screen.findByText('pve1: ovs-vsctl failed')).toBeTruthy()
  })

  it('says the collector is off, the nodes whose telemetry is missing, and an agent no node is keyed on', async () => {
    stub({
      enabled: false,
      heard: [{ agent_ip: '10.9.9.9', node: '', last_seen: 'x', flow_rate: 0, sample_count: 0, active: true }],
    })
    render()
    expect(await screen.findByTestId('sflow-collector-off')).toBeTruthy()
    cleanup()

    stub({
      health: { evaluated_at: 'x', collector_enabled: true, agents: [telemetry('pve1', 'missing')], unmatched_agents: [], alerts_enabled: false, timeout_seconds: 90, grace_seconds: 300 },
      heard: [{ agent_ip: '10.9.9.9', node: '', last_seen: 'x', flow_rate: 0, sample_count: 0, active: true }],
    })
    render()
    expect((await screen.findByTestId('telemetry-missing-alert')).textContent).toContain('No datagram from pve2')
    expect(await screen.findByText(/10\.9\.9\.9/)).toBeTruthy()
  })

  it('says when no node can be reached, and verifies the reception again on demand', async () => {
    const fetchMock = stub({ agents: [] })
    render()
    expect(await screen.findByTestId('sflow-no-node')).toBeTruthy()
    cleanup()

    stub()
    render()
    fireEvent.click(await screen.findByText('Verify reception'))
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([u]) => u === '/api/v1/orchestrator/sflow/agents').length).toBeGreaterThan(1))
    expect(fetchMock).toBeTruthy()
  })
})
