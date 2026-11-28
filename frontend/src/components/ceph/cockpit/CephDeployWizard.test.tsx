import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen, waitFor, within } from '@/__tests__/setup/renderWithProviders'

/*
   ui#1450: the Ceph deploy wizard. Check the nodes, install the packages where
   they are missing (pveceph over SSH), initialize (PVE API), add monitors,
   then point to the OSDs and the first pool.
*/

const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => toast }))
const waitMock = vi.fn()
vi.mock('@/lib/proxmox/waitForTaskClient', () => ({ waitForPveTask: (...a: unknown[]) => waitMock(...a) }))

import CephDeployWizard from './CephDeployWizard'

const fetchMock = vi.fn()
const json = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data })
const node = (name: string, ceph: string, over: Record<string, unknown> = {}) => ({
  node: name, online: true, address: `10.42.0.${name.slice(-1)}`, ceph, pveVersion: '9.2.26', repository: 'no-subscription', ssh: 'ok', ...over,
})
const CANDIDATES = [{ id: 'c2', name: 'LAB' }]

let preflight: unknown
let installLog: { status: string; logs: string }

function routes() {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/v1/connections/c2/ceph/preflight') return json({ data: preflight })
    if (url.endsWith('/ceph/install') && init?.method === 'POST') return json({ data: { started: true } })
    if (url.endsWith('/ceph/install')) return json({ data: installLog })
    if (url === '/api/v1/connections/c2/ceph/init') return json({ data: { upid: 'UPID:pve1:1:2:3:cephcreatemon:mon.pve1:x:', node: 'pve1', hasCeph: true } })
    if (url.endsWith('/ceph/create')) return json({ data: { upid: 'UPID:pve2:1:2:3:cephcreatemon:mon.pve2:x:', node: 'pve2' } })
    throw new Error(`unexpected ${url}`)
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  waitMock.mockReset()
  waitMock.mockResolvedValue({ outcome: 'ok' })
  preflight = { nodes: [node('pve1', 'installed'), node('pve2', 'installed'), node('pve3', 'installed')], releases: ['tentacle', 'squid'] }
  installLog = { status: 'COMPLETED', logs: 'installed ceph tentacle successfully!' }
  routes()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const posts = () => fetchMock.mock.calls.filter(([, i]) => i?.method === 'POST').map(([u, i]) => [u, JSON.parse(String(i.body))])

function open(onInitialized = vi.fn()) {
  renderWithProviders(<CephDeployWizard open candidates={CANDIDATES} onClose={vi.fn()} onInitialized={onInitialized} onOpenCluster={vi.fn()} />)
  return within(screen.getByRole('dialog'))
}

describe('CephDeployWizard', () => {
  it('lists the nodes, skips the install when every node has the packages, initializes and adds monitors', async () => {
    const onInitialized = vi.fn()
    const d = open(onInitialized)
    expect(await d.findByText('pve3')).toBeInTheDocument()
    fireEvent.click(d.getByRole('button', { name: 'Next' }))

    expect(await d.findByLabelText('Public network')).toHaveValue('10.42.0.0/24')
    fireEvent.click(d.getByRole('button', { name: 'Initialize' }))
    await waitFor(() => expect(onInitialized).toHaveBeenCalledWith('c2'))
    expect(posts()[0]).toEqual(['/api/v1/connections/c2/ceph/init', { node: 'pve1', network: '10.42.0.0/24', size: 3, minSize: 2, allowSingleCopy: false }])

    fireEvent.click(await d.findByRole('button', { name: 'Create monitors' }))
    expect(await d.findByText('Ceph is running on LAB.')).toBeInTheDocument()
    expect(posts().slice(1).map(([u, b]) => [u, b.kind])).toEqual([
      ['/api/v1/connections/c2/nodes/pve2/ceph/create', 'mon'],
      ['/api/v1/connections/c2/nodes/pve2/ceph/create', 'mgr'],
      ['/api/v1/connections/c2/nodes/pve3/ceph/create', 'mon'],
      ['/api/v1/connections/c2/nodes/pve3/ceph/create', 'mgr'],
    ])
  })

  it('installs the packages on the nodes without them', async () => {
    preflight = { nodes: [node('pve1', 'absent'), node('pve2', 'installed'), node('pve3', 'absent')], releases: ['tentacle', 'squid'] }
    const d = open()
    await d.findByText('pve3')
    fireEvent.click(d.getByRole('button', { name: 'Next' }))
    fireEvent.click(await d.findByRole('button', { name: 'Install' }))
    await waitFor(() => expect(d.getByRole('button', { name: 'Next' })).toBeEnabled())
    expect(posts()).toEqual([
      ['/api/v1/connections/c2/nodes/pve1/ceph/install', { version: 'tentacle', repository: 'no-subscription' }],
      ['/api/v1/connections/c2/nodes/pve3/ceph/install', { version: 'tentacle', repository: 'no-subscription' }],
    ])
  })

  it('stops on a failed install and says to fix the repositories', async () => {
    preflight = { nodes: [node('pve1', 'absent'), node('pve2', 'installed'), node('pve3', 'installed')], releases: ['tentacle'] }
    installLog = { status: 'FAILED', logs: 'E: Failed to fetch https://enterprise.proxmox.com/debian/ceph-tentacle 401 Unauthorized' }
    const d = open()
    await d.findByText('pve3')
    fireEvent.click(d.getByRole('button', { name: 'Next' }))
    fireEvent.click(await d.findByRole('button', { name: 'Install' }))
    expect(await d.findByText(/an enterprise repository without a subscription answers 401/)).toBeInTheDocument()
    expect(d.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('refuses a cluster already initialized, and a node SSH cannot install on', async () => {
    preflight = { nodes: [node('pve1', 'initialized'), node('pve2', 'installed')], releases: ['tentacle'] }
    let d = open()
    expect(await d.findByText(/already initialized on this cluster/)).toBeInTheDocument()
    expect(d.getByRole('button', { name: 'Next' })).toBeDisabled()
    cleanup()
    preflight = { nodes: [node('pve1', 'absent', { ssh: 'missing-rule' }), node('pve2', 'installed'), node('pve3', 'installed')], releases: ['tentacle'] }
    d = open()
    expect(await d.findByRole('link', { name: 'Settings > SSH commands' })).toBeInTheDocument()
    expect(d.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('warns under three nodes', async () => {
    preflight = { nodes: [node('pve1', 'installed'), node('pve2', 'installed')], releases: ['tentacle'] }
    const d = open()
    expect(await d.findByText(/will not become healthy with fewer than 3 nodes/)).toBeInTheDocument()
    expect(d.getByRole('button', { name: 'Next' })).toBeEnabled()
  })

  it('reads an answer without nodes as an error, not as a crash', async () => {
    preflight = []
    const d = open()
    expect(await d.findByText('The nodes of this cluster could not be read.')).toBeInTheDocument()
    expect(d.getByRole('button', { name: 'Next' })).toBeDisabled()
  })
})
