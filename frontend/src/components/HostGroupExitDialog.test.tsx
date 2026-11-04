/**
 * roadmap#198: leaving the maintenance of a group: every node leaves HA
 * maintenance, then, when asked, the guests the group drain moved go back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import HostGroupExitDialog, { waitForGroupOut } from '@/components/HostGroupExitDialog'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }))
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => toast }))

const DRAINS = [{
  id: 'g', node: 'pve2,pve3', created_at: '2026-11-03T15:00:00Z', config: { nodes: ['pve2', 'pve3'] },
  guests: [
    { vmid: 105, status: 'completed', mode: 'live', source_node: 'pve2', target_node: 'pve1' },
    { vmid: 9975, status: 'completed', mode: 'ha', ha: true, source_node: 'pve3', target_node: 'pve1' },
  ],
}]

type Answer = { ok?: boolean; status?: number; body: any }
let routes: Record<string, Answer | (() => Answer)>
const calls: { url: string; method: string; body?: any }[] = []

beforeEach(() => {
  calls.length = 0
  Object.values(toast).forEach(f => f.mockClear())
  routes = {
    'GET /api/v1/orchestrator/host-drains': { body: { data: DRAINS } },
    'DELETE maintenance': { body: { success: true } },
    'GET maintenance': { body: { data: { maintenance: null } } },
    'POST /api/v1/orchestrator/host-drains': { body: { data: { id: 'r-1' } } },
  }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const key = url.includes('/maintenance') ? `${method} maintenance` : `${method} ${url.split('?')[0]}`
    const route = routes[key]
    const answer = typeof route === 'function' ? route() : route
    if (!answer) throw new Error(`unexpected ${key}`)

    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 })
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('HostGroupExitDialog', () => {
  it('takes every node out and brings the drain guests back once the group is out', async () => {
    const onClose = vi.fn()
    const onStarted = vi.fn()
    renderWithProviders(<HostGroupExitDialog connId="c1" nodes={['pve2', 'pve3']} onClose={onClose} onStarted={onStarted} waitOpts={{ pollMs: 1, timeoutMs: 100 }} />)

    const box = (await screen.findByTestId('host-group-bring-back')).querySelector('input')!
    expect(screen.getByText('Also bring back the 1 guest(s) the group maintenance moved')).toBeInTheDocument()
    fireEvent.click(box)
    fireEvent.click(screen.getByTestId('host-group-exit-confirm'))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(calls.filter(c => c.method === 'DELETE').map(c => c.url)).toEqual([
      '/api/v1/connections/c1/nodes/pve2/maintenance',
      '/api/v1/connections/c1/nodes/pve3/maintenance',
    ])
    const back = calls.find(c => c.method === 'POST')!
    expect(back.body).toEqual({ connection_id: 'c1', config: { vmids: [105], guest_targets: { 105: 'pve2' }, include_stopped: true, mem_ceiling_percent: 100 } })
    expect(onStarted).toHaveBeenCalledWith({ id: 'r-1' })
    expect(toast.success).toHaveBeenCalledWith('Return of 1 guest(s) started')
  })

  it('only leaves maintenance when the return is not asked', async () => {
    const onClose = vi.fn()
    renderWithProviders(<HostGroupExitDialog connId="c1" nodes={['pve2', 'pve3']} onClose={onClose} />)
    await screen.findByTestId('host-group-bring-back')
    fireEvent.click(screen.getByTestId('host-group-exit-confirm'))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(calls.some(c => c.method === 'POST')).toBe(false)
    expect(toast.success).toHaveBeenCalledWith('pve2, pve3 left maintenance')
  })

  it('reports the nodes that refused, and a group still in maintenance', async () => {
    routes['DELETE maintenance'] = { status: 500, body: { error: 'ssh down' } }
    const onClose = vi.fn()
    const view = renderWithProviders(<HostGroupExitDialog connId="c1" nodes={['pve2', 'pve3']} onClose={onClose} />)
    await screen.findByTestId('host-group-bring-back')
    fireEvent.click(screen.getByTestId('host-group-exit-confirm'))
    expect(await screen.findByText('pve2: ssh down ; pve3: ssh down')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    view.unmount()

    routes['DELETE maintenance'] = { body: { success: true } }
    routes['GET maintenance'] = { body: { data: { maintenance: 'maintenance' } } }
    renderWithProviders(<HostGroupExitDialog connId="c1" nodes={['pve2', 'pve3']} onClose={onClose} waitOpts={{ pollMs: 1, timeoutMs: 5 }} />)
    fireEvent.click((await screen.findByTestId('host-group-bring-back')).querySelector('input')!)
    fireEvent.click(screen.getByTestId('host-group-exit-confirm'))
    expect(await screen.findByText('A host of the group is still in maintenance: the guests were not brought back.')).toBeInTheDocument()
  })

  it('shows the refusal of the return drain, and nothing to bring back without a group drain', async () => {
    routes['POST /api/v1/orchestrator/host-drains'] = { status: 409, body: { error: 'a host drain is already running' } }
    renderWithProviders(<HostGroupExitDialog connId="c1" nodes={['pve2', 'pve3']} onClose={vi.fn()} waitOpts={{ pollMs: 1, timeoutMs: 100 }} />)
    fireEvent.click((await screen.findByTestId('host-group-bring-back')).querySelector('input')!)
    fireEvent.click(screen.getByTestId('host-group-exit-confirm'))
    expect(await screen.findByText('a host drain is already running')).toBeInTheDocument()
    cleanup()

    routes['GET /api/v1/orchestrator/host-drains'] = () => { throw new Error('down') }
    renderWithProviders(<HostGroupExitDialog connId="c1" nodes={['pve2', 'pve3']} onClose={vi.fn()} />)
    expect(await screen.findByText('No guest moved by the group maintenance to bring back')).toBeInTheDocument()
  })
})

describe('waitForGroupOut', () => {
  it('resolves true once no node is in maintenance, false at the deadline, treating errors as busy', async () => {
    let n = 0
    routes['GET maintenance'] = () => ({ body: { data: { maintenance: ++n > 3 ? null : 'maintenance' } } })
    expect(await waitForGroupOut('c1', ['pve2'], { pollMs: 1, timeoutMs: 1000 })).toBe(true)

    routes['GET maintenance'] = { status: 500, body: {} }
    expect(await waitForGroupOut('c1', ['pve2'], { pollMs: 1, timeoutMs: 5 })).toBe(false)
  })
})
