import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import NodeSshEndpointsEditor from './NodeSshEndpointsEditor'

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }))
const rbac = { loading: false, hasPermission: vi.fn((p: string) => p === 'admin.settings') }
vi.mock('@/contexts/RBACContext', () => ({ useRBAC: () => rbac }))
vi.mock('@/app/(dashboard)/infrastructure/inventory/components/TreeIcons', () => ({
  NodeIcon: () => <span />,
}))

const NODES = [
  { node: 'pve1', status: 'online', hostId: 'h1', sshAddress: '203.0.113.10', sshPort: 2201 },
  { node: 'pve2', status: 'offline', hostId: 'h2', sshAddress: null, sshPort: null },
]

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  rbac.hasPermission.mockImplementation((p: string) => p === 'admin.settings')
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body))
      return { ok: true, json: async () => ({ data: { ...body } }) }
    }
    if (url.endsWith('/network')) {
      return { ok: true, json: async () => ({ data: [{ iface: 'tailscale0', address: '100.64.0.1/32' }] }) }
    }
    return { ok: true, json: async () => ({ data: NODES }) }
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const patchCalls = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')

describe('NodeSshEndpointsEditor', () => {
  it('shows the stored overrides and reports them to the parent', async () => {
    const onChange = vi.fn()
    render(<NodeSshEndpointsEditor connectionId='c1' defaultPort={22} onChange={onChange} />)

    const addresses = await screen.findAllByLabelText('settings.sshNodeEndpoints.address')
    expect((addresses[0] as HTMLInputElement).value).toBe('203.0.113.10')
    expect((addresses[1] as HTMLInputElement).value).toBe('')
    const ports = screen.getAllByLabelText('settings.sshNodeEndpoints.port')
    expect((ports[0] as HTMLInputElement).value).toBe('2201')
    expect(onChange).toHaveBeenCalledWith({
      pve1: { address: '203.0.113.10', port: 2201 },
      pve2: { address: null, port: null },
    })
  })

  it('saves a free-text address and port on blur, trimmed', async () => {
    render(<NodeSshEndpointsEditor connectionId='c1' />)

    const address = (await screen.findAllByLabelText('settings.sshNodeEndpoints.address'))[1]
    fireEvent.change(address, { target: { value: '  100.64.0.2 ' } })
    const port = screen.getAllByLabelText('settings.sshNodeEndpoints.port')[1]
    fireEvent.change(port, { target: { value: '2202' } })
    fireEvent.blur(port)

    await waitFor(() => expect(patchCalls()).toHaveLength(1))
    const [url, init] = patchCalls()[0]
    expect(url).toBe('/api/v1/hosts/h2')
    expect(JSON.parse(String(init.body))).toEqual({ sshAddress: '100.64.0.2', sshPort: 2202 })
  })

  it('refuses an out-of-range port without saving', async () => {
    render(<NodeSshEndpointsEditor connectionId='c1' />)

    const port = (await screen.findAllByLabelText('settings.sshNodeEndpoints.port'))[0]
    fireEvent.change(port, { target: { value: '70000' } })
    fireEvent.blur(port)

    expect(await screen.findByText('settings.sshNodeEndpoints.invalidPort')).toBeInTheDocument()
    expect(patchCalls()).toHaveLength(0)
  })

  it('does not save when nothing changed', async () => {
    render(<NodeSshEndpointsEditor connectionId='c1' />)

    const port = (await screen.findAllByLabelText('settings.sshNodeEndpoints.port'))[0]
    fireEvent.blur(port)

    await new Promise(r => setTimeout(r, 0))
    expect(patchCalls()).toHaveLength(0)
  })

  it('limits and orders the rows to the given nodes', async () => {
    render(<NodeSshEndpointsEditor connectionId='c1' nodeNames={['pve2']} />)

    expect(await screen.findAllByLabelText('settings.sshNodeEndpoints.address')).toHaveLength(1)
    expect(screen.getByText('pve2')).toBeInTheDocument()
    expect(screen.queryByText('pve1')).not.toBeInTheDocument()
  })

  it('is read-only with a hint, and never saves, without the admin settings permission', async () => {
    rbac.hasPermission.mockReturnValue(false)
    render(<NodeSshEndpointsEditor connectionId='c1' />)

    const addresses = await screen.findAllByLabelText('settings.sshNodeEndpoints.address')
    expect((addresses[0] as HTMLInputElement).value).toBe('203.0.113.10')
    expect(addresses.every(a => (a as HTMLInputElement).disabled)).toBe(true)
    const ports = screen.getAllByLabelText('settings.sshNodeEndpoints.port')
    expect((ports[0] as HTMLInputElement).value).toBe('2201')
    expect(ports.every(p => (p as HTMLInputElement).disabled)).toBe(true)
    expect(screen.getByText('settings.sshNodeEndpoints.readOnlyHint')).toBeInTheDocument()
    expect(rbac.hasPermission).toHaveBeenCalledWith('admin.settings')

    fireEvent.blur(ports[0])
    await new Promise(r => setTimeout(r, 0))
    expect(patchCalls()).toHaveLength(0)
  })

  it('shows no read-only hint to a user who can edit', async () => {
    render(<NodeSshEndpointsEditor connectionId='c1' />)

    await screen.findAllByLabelText('settings.sshNodeEndpoints.address')
    expect(screen.queryByText('settings.sshNodeEndpoints.readOnlyHint')).not.toBeInTheDocument()
  })
})
