import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { renderWithProviders, screen, waitFor, fireEvent } from '@/__tests__/setup/renderWithProviders'
import type { LogCollectionState } from '@/lib/logCollection/types'

import LogCollectionTab from './LogCollectionTab'

const limits = { min_queue_mb: 16, max_queue_mb: 4096, min_budget: 1000, max_budget: 300000 }

const apiState = (over: Partial<LogCollectionState> = {}): LogCollectionState => ({
  mode: 'api', receiver_host: '', receiver_port: 6344, queue_mb: 256, budget_lines_per_min: 30000,
  receiver_default: '10.42.0.40', ssh_enabled: true, has_policy: true, limits, nodes: [], run: null, busy: false, ...over,
})

const forwarderState = (over: Partial<LogCollectionState> = {}): LogCollectionState => apiState({
  mode: 'forwarder', receiver_host: '10.42.0.40',
  nodes: [
    { node: 'pve1', state: 'installed', variant: 'openfile', version: '1.5.2', connected: true, last_line_at: new Date(Date.now() - 4000).toISOString(), lag_seconds: 4, lines_per_min_15m: 1234.4, queue_bytes: 2048, dropped: 0 },
    { node: 'pve2', state: 'failed', error: 'copy the forwarder: exit status 1: disk full' },
    { node: 'pve3', state: 'installed', variant: 'adm', version: '1.5.2', silent: true, last_line_at: new Date(Date.now() - 600000).toISOString(), lag_seconds: 600, queue_bytes: 5 * 1024 * 1024, dropped: 42 },
  ],
  ...over,
})

type Call = { method: string; url: string; body?: any }
let calls: Call[]
let states: LogCollectionState[]
let answers: Record<string, () => Response>

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  calls = []
  states = [apiState()]
  answers = {}
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const path = String(url).replace('/api/v1/connections/c1/log-collection', '') || '/'

    calls.push({ method, url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const answer = answers[`${method} ${path}`]

    if (answer) return answer()
    // Each read takes the next state, the last one staying.
    if (method === 'GET') return json(200, states.length > 1 ? states.shift() : states[0])

    return json(200, {})
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

const writes = () => calls.filter(c => c.method !== 'GET')

async function renderTab() {
  renderWithProviders(<LogCollectionTab connectionId='c1' active pollMs={20} />)
  await waitFor(() => expect(screen.getByTestId('log-collection-mode')).toBeInTheDocument())
}

const pick = (mode: 'api' | 'forwarder') => fireEvent.click(screen.getByTestId(`log-collection-mode-${mode}`))
const unfold = () => fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' }))

describe('LogCollectionTab', () => {
  it('shows the API mode and no forwarder', async () => {
    await renderTab()

    expect(screen.getByTestId('log-collection-mode-api')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('No forwarder on the nodes: the firewall logs of the VMs and containers are read through the Proxmox API.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/api/v1/connections/c1/log-collection' })
    expect(screen.getByText('VM firewall log collection')).toBeInTheDocument()
  })

  it('recommends the forwarder for a high log volume, on the line of the mode', async () => {
    await renderTab()

    expect(within(screen.getByTestId('log-collection-mode')).getByText('Forwarder recommended for a high log volume.')).toBeInTheDocument()
  })

  it('cannot choose the forwarder without SSH access, and says why on the line', async () => {
    states = [apiState({ ssh_enabled: false })]
    await renderTab()

    expect(screen.getByTestId('log-collection-mode-forwarder')).toBeDisabled()
    expect(within(screen.getByTestId('log-collection-mode')).getByText('Enable SSH access on this connection to choose the forwarder.')).toBeInTheDocument()
    expect(screen.queryByText('Forwarder recommended for a high log volume.')).toBeNull()
  })

  it('cannot choose the forwarder on a cluster with no applied policy', async () => {
    states = [apiState({ has_policy: false })]
    await renderTab()

    expect(screen.getByTestId('log-collection-mode-forwarder')).toBeDisabled()
    expect(screen.getByText('Apply a micro-segmentation policy on this cluster to choose the forwarder.')).toBeInTheDocument()
  })

  it('folds the receiver, the queue and the budget under Advanced settings', async () => {
    await renderTab()

    expect(screen.queryByTestId('log-collection-receiver')).toBeNull()
    expect(screen.queryByTestId('log-collection-queue')).toBeNull()
    expect(screen.queryByTestId('log-collection-budget')).toBeNull()
    expect(screen.getByRole('button', { name: 'Advanced settings' })).toHaveAttribute('aria-expanded', 'false')

    unfold()
    expect(screen.getByRole('button', { name: 'Advanced settings' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('log-collection-receiver')).toBeInTheDocument()
    expect(screen.getByTestId('log-collection-queue')).toBeInTheDocument()
    expect(screen.getByTestId('log-collection-budget')).toBeInTheDocument()
  })

  it('shows the advanced settings by itself when one of them is not the default', async () => {
    states = [forwarderState({ queue_mb: 512 })]
    await renderTab()

    expect(screen.getByTestId('log-collection-queue')).toBeInTheDocument()
  })

  it('proposes the receiver address and asks before installing', async () => {
    answers['PUT /'] = () => json(202, { run_id: 'run-1' })
    await renderTab()
    pick('forwarder')
    unfold()

    expect((screen.getByLabelText('Address') as HTMLInputElement).value).toBe('10.42.0.40')
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByText('Install the log forwarder?')).toBeInTheDocument()
    expect(writes()).toEqual([])

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(writes()).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Install' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toMatchObject({
      method: 'PUT',
      body: { mode: 'forwarder', receiver_host: '10.42.0.40', receiver_port: 6344, queue_mb: 256, budget_lines_per_min: 30000 },
    })
  })

  it('does not send settings that are not valid', async () => {
    await renderTab()
    pick('forwarder')
    unfold()
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'a;reboot' } })

    expect(screen.getByText('An IP address or a host name.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
  })

  it('lists the nodes that are not ready when the preflight fails, and changes nothing', async () => {
    answers['PUT /'] = () => json(409, {
      code: 'PREFLIGHT_FAILED', error: 'the preflight failed on pve2',
      checks: [
        { node: 'pve1', ok: true },
        { node: 'pve2', ok: false, problems: [{ code: 'host_key_unconfirmed' }, { code: 'sudo_missing', detail: 'logfwd-install' }] },
      ],
    })
    await renderTab()
    pick('forwarder')
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Install' }))

    const alert = await screen.findByTestId('log-collection-preflight')

    expect(within(alert).getByText('Nothing was changed: 1 node is not ready.')).toBeInTheDocument()
    expect(within(alert).getByText(/pve2/)).toBeInTheDocument()
    expect(within(alert).getByText(/its SSH host key is not confirmed \(Settings, SSH Commands, /)).toBeInTheDocument()
    expect(within(alert).getByText(/logfwd-install/)).toBeInTheDocument()
    expect(within(alert).queryByText(/pve1/)).not.toBeInTheDocument()
  })

  it('says a refusal in words', async () => {
    answers['PUT /'] = () => json(409, { code: 'BUSY', error: 'an installation or a removal is already running on the cluster' })
    await renderTab()
    pick('forwarder')
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Install' }))

    expect(await screen.findByText('An installation or a removal is already running on this cluster.')).toBeInTheDocument()
  })

  it('follows a run node by node until it ends', async () => {
    const running = forwarderState({
      busy: true,
      nodes: [{ node: 'pve1', state: 'installing' }],
      run: { id: 'run-1', kind: 'install', status: 'running', started_at: new Date().toISOString(), nodes: [{ node: 'pve1', step: 'binary', done: false }] },
    })
    const done = forwarderState({
      nodes: [{ node: 'pve1', state: 'installed', version: '1.5.2', connected: true }],
      run: { id: 'run-1', kind: 'install', status: 'done', started_at: new Date().toISOString(), nodes: [{ node: 'pve1', step: 'done', done: true }] },
    })

    states = [running, running, done]
    await renderTab()

    expect(await screen.findByText('Installation running')).toBeInTheDocument()
    expect(screen.getByText(/pve1 · copying the program/)).toBeInTheDocument()
    // Nothing else can be started meanwhile.
    expect(screen.getByTestId('log-collection-mode-api')).toBeDisabled()

    await waitFor(() => expect(screen.queryByText('Installation running')).not.toBeInTheDocument())
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(calls.filter(c => c.method === 'GET').length).toBeGreaterThanOrEqual(3)
  })

  it('shows each node on one line with its glyph, and its trouble under a chevron', async () => {
    states = [forwarderState()]
    await renderTab()

    const row = (node: string) => screen.getByTestId(`log-forwarder-${node}`)

    expect(within(row('pve1')).getByTestId('log-forwarder-glyph-pve1-dot')).toHaveAttribute('data-status', 'online')
    expect(within(row('pve1')).getByText('Running')).toBeInTheDocument()
    expect(within(row('pve1')).getByText('1.5.2')).toBeInTheDocument()
    expect(within(row('pve1')).getByText('1,234')).toBeInTheDocument()

    expect(within(row('pve2')).getByTestId('log-forwarder-glyph-pve2-dot')).toHaveAttribute('data-status', 'offline')
    expect(within(row('pve2')).getByText('Failed')).toBeInTheDocument()
    expect(screen.queryByText(/disk full/)).not.toBeInTheDocument()
    fireEvent.click(within(row('pve2')).getByRole('button', { name: 'Details' }))
    expect(await screen.findByText('Last error: copy the forwarder: exit status 1: disk full')).toBeInTheDocument()

    expect(within(row('pve3')).getByText('Silent')).toBeInTheDocument()
    expect(within(row('pve3')).getByText('adm group')).toBeInTheDocument()
    expect(within(row('pve3')).getByText('42')).toBeInTheDocument()
  })

  it('retries a failed node', async () => {
    states = [forwarderState()]
    answers['POST /nodes/pve2/retry'] = () => json(202, { run_id: 'run-2' })
    await renderTab()
    fireEvent.click(within(screen.getByTestId('log-forwarder-pve2')).getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toMatchObject({ method: 'POST', url: '/api/v1/connections/c1/log-collection/nodes/pve2/retry' })
    expect(within(screen.getByTestId('log-forwarder-pve1')).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('lets a node left installing by an interrupted run be retried, but not while a run is in flight', async () => {
    states = [forwarderState({ busy: false, nodes: [{ node: 'pve1', state: 'installing' }] })]
    await renderTab()
    expect(within(screen.getByTestId('log-forwarder-pve1')).getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    cleanup()

    states = [forwarderState({
      busy: true,
      nodes: [{ node: 'pve1', state: 'installing' }],
      run: { id: 'run-1', kind: 'install', status: 'running', started_at: new Date().toISOString(), nodes: [{ node: 'pve1', step: 'binary', done: false }] },
    })]
    await renderTab()
    expect(within(screen.getByTestId('log-forwarder-pve1')).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('offers to take away a node that left the cluster, and says why', async () => {
    states = [forwarderState({ nodes: [{ node: 'pve-old', state: 'installed', left: true }] })]
    answers['POST /nodes/pve-old/retry'] = () => json(202, { run_id: 'run-9' })
    await renderTab()
    const row = screen.getByTestId('log-forwarder-pve-old')

    fireEvent.click(within(row).getByRole('button', { name: 'Details' }))
    expect(await screen.findByText(/no longer a node of the Proxmox cluster/)).toBeInTheDocument()
    fireEvent.click(within(row).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(writes()[0]).toMatchObject({ method: 'POST', url: '/api/v1/connections/c1/log-collection/nodes/pve-old/retry' }))
  })

  it('offers to install a node of the cluster that has no forwarder', async () => {
    states = [forwarderState({ nodes: [{ node: 'pve4', state: 'missing' }] })]
    answers['POST /nodes/pve4/retry'] = () => json(202, { run_id: 'run-3' })
    await renderTab()

    expect(within(screen.getByTestId('log-forwarder-pve4')).getByText('Not installed')).toBeInTheDocument()
    fireEvent.click(within(screen.getByTestId('log-forwarder-pve4')).getByRole('button', { name: 'Install' }))
    await waitFor(() => expect(writes()[0]?.url).toBe('/api/v1/connections/c1/log-collection/nodes/pve4/retry'))
  })

  it('asks before going back to the API read', async () => {
    states = [forwarderState()]
    answers['PUT /'] = () => json(202, { run_id: 'run-4' })
    await renderTab()
    pick('api')
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByText('Go back to the API read?')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(writes()[0]?.body?.mode).toBe('api'))
  })

  it('does not say the settings are applied when the change started a run on the nodes', async () => {
    const removing = forwarderState({
      mode: 'api',
      busy: true,
      run: { id: 'run-4', kind: 'uninstall', status: 'running', started_at: new Date().toISOString(), nodes: [{ node: 'pve1', step: 'stop', done: false }] },
    })

    states = [forwarderState()]
    answers['PUT /'] = () => {
      states = [removing]

      return json(202, { run_id: 'run-4' })
    }
    await renderTab()
    pick('api')
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }))

    expect(await screen.findByTestId('log-collection-run')).toBeInTheDocument()
    expect(screen.queryByText('Settings applied.')).not.toBeInTheDocument()
  })

  it('applies a budget change without asking: no node is touched', async () => {
    states = [forwarderState()]
    await renderTab()
    unfold()
    fireEvent.change(screen.getByLabelText('Ingestion budget per node'), { target: { value: '50000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(writes()[0].body).toMatchObject({ mode: 'forwarder', budget_lines_per_min: 50000 })
    expect(await screen.findByText('Settings applied.')).toBeInTheDocument()
  })

  it('checks the nodes on demand', async () => {
    states = [forwarderState()]
    await renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Check the nodes' }))

    await waitFor(() => expect(writes()[0]).toMatchObject({ method: 'POST', url: '/api/v1/connections/c1/log-collection/check' }))
  })

  it('reads nothing while its tab is not shown', async () => {
    renderWithProviders(<LogCollectionTab connectionId='c1' active={false} />)
    await new Promise(resolve => setTimeout(resolve, 30))

    expect(calls).toEqual([])
  })

  it('says when the state cannot be read', async () => {
    answers['GET /'] = () => json(503, { code: 'ORCHESTRATOR_UNAVAILABLE', error: 'The orchestrator did not answer' })
    renderWithProviders(<LogCollectionTab connectionId='c1' active />)

    expect(await screen.findByText('The orchestrator did not answer.')).toBeInTheDocument()
  })
})
