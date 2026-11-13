import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen, waitFor, within } from '@/__tests__/setup/renderWithProviders'
import type { GpuReport } from '@/lib/gpu/report'

vi.mock('@/contexts/LicenseContext', async orig => ({
  ...(await orig<typeof import('@/contexts/LicenseContext')>()),
  useLicense: () => ({ hasFeature: () => true }),
}))

import { AttachDialog, GpuActionsContext, MoveDialog, ReleaseDialog } from './components/GpuActionDialogs'
import GpuMetricsSettingsDialog from './components/GpuMetricsSettingsDialog'
import LoadDashboard from './components/LoadDashboard'
import { holderText } from './components/GpuTileMap'
import OverviewTab from './components/OverviewTab'
import ProfilesTab from './components/ProfilesTab'
import VgpuTab, { VgpuAttachButton } from './components/VgpuTab'
import WorkloadsTab, { WorkloadFilters } from './components/WorkloadsTab'
import { NO_FILTER } from './components/GpuFilters'

const cap = { total: 1, allocated: 1, free: 0, inUse: 1, consoles: 0 }

const REPORT: GpuReport = {
  scope: 'infrastructure',
  generatedAt: '2026-11-01T00:00:00Z',
  connections: [{ id: 'c1', name: 'GPU-LAB', error: null, capacity: cap }],
  nodes: [{ node: 'n1', online: true, error: null, connId: 'c1', connectionName: 'GPU-LAB', capacity: cap }],
  devices: [
    {
      key: 'c1:n1:0000:03:00', connId: 'c1', node: 'n1', id: '0000:03:00.0', slot: '0000:03:00', functions: ['0000:03:00.0'], displayFunctions: ['0000:03:00.0'],
      vendorId: '0x10de', deviceId: '0x2231', vendorName: 'NVIDIA Corporation', deviceName: 'GA102GL [RTX A5000]', subsystemName: null, classCode: '0x030000',
      iommuGroup: 35, iommuIsolated: true, mdev: false, vgpu: null, kind: 'gpu', consoleReason: null, mappings: [], connectionName: 'GPU-LAB',
      vms: [
        { vmid: '9010', vmName: 'ai-ollama', vmStatus: 'running', hidden: false, template: false, hostpci: 'hostpci0', via: 'address', mdev: null, pooled: false },
        { vmid: '9001', vmName: 'spare', vmStatus: 'stopped', hidden: false, template: false, hostpci: 'hostpci0', via: 'address', mdev: null, pooled: false },
      ],
    },
  ],
  allocations: ['9010', '9001'].map(vmid => ({
    connId: 'c1', connectionName: 'GPU-LAB', node: 'n1', vmid, vmName: vmid === '9010' ? 'ai-ollama' : 'spare', vmStatus: vmid === '9010' ? 'running' : 'stopped',
    template: false, hidden: false, hostpci: 'hostpci0', via: 'address' as const, mapping: null, mdev: null, pooled: false, pool: null, uptime: vmid === '9010' ? 7200 : null, smbiosUuid: null, pendingRemoval: false,
    kind: 'gpu' as const, vendorName: 'NVIDIA Corporation', deviceName: 'GA102GL [RTX A5000]', vendorId: '0x10de', deviceId: '0x2231', deviceKey: 'c1:n1:0000:03:00', pciId: '0000:03:00.0',
  })),
  capacity: cap,
}

const reading = {
  connection_id: 'c1', target: 'vm:9010:GPU-a', source: 'guest', node: 'n1', index: 0, uuid: 'GPU-a', name: 'NVIDIA RTX A5000', bus_id: '0000:01:00', at: '2026-11-01T09:00:00Z',
  util: 95, mem_util: 90, mem_used: 23000, mem_total: 24564, temp: 66, power: 229, power_limit: 230, thermal_slow: false, power_slow: true,
  deviceKey: 'c1:n1:0000:03:00', connectionName: 'GPU-LAB', vmid: '9010', vmName: 'ai-ollama', deviceName: 'GA102GL [RTX A5000]',
}

const LATEST = {
  at: '2026-11-01T09:00:00Z',
  gpus: [reading],
  probes: [
    { connection_id: 'c1', kind: 'guest', vmid: 9010, status: 'ok', at: '', gpus: 1 },
    { connection_id: 'c1', kind: 'guest', vmid: 9002, status: 'agent_unavailable', at: '', gpus: 0 },
  ],
  enabled: true,
  intervalSeconds: 60,
  thresholds: { util_pct: 90, memory_pct: 90, temp_c: 85 },
  configured: true,
}

const point = (time: number) => ({ time, util: 90, util_max: 97, mem_util: 80, mem_used: 15000, mem_used_max: 15000, mem_total: 24564, temp_max: 66, power: 220, power_max: 230, power_limit: 230, thermal_slow: 0, power_slow: 1 })
const SERIES = {
  range: '24h', stepSeconds: 900, from: 0, to: 3600,
  series: [{ deviceKey: 'c1:n1:0000:03:00', connectionName: 'GPU-LAB', node: 'n1', vmid: '9010', vmName: 'ai-ollama', deviceName: 'GA102GL [RTX A5000]', connectionId: 'c1', target: 'vm:9010:GPU-a', points: [point(0), point(900)] }],
}

const SETTINGS = {
  settings: { enabled: true, interval_seconds: 60, retention_days: 30, guest_vms: [{ connection_id: 'c1', vmid: 9010 }], host_nodes: [], thresholds: { util_pct: 90, memory_pct: 90, temp_c: 85 }, alerts: true, idle_days: 7 },
  candidates: {
    guests: [
      { connectionId: 'c1', connectionName: 'GPU-LAB', node: 'n1', vmid: 9010, vmName: 'ai-ollama', vmStatus: 'running', gpus: ['GA102GL [RTX A5000]'] },
      { connectionId: 'c1', connectionName: 'GPU-LAB', node: 'n1', vmid: 9001, vmName: 'spare', vmStatus: 'stopped', gpus: ['GA102GL [RTX A5000]'] },
    ],
    nodes: [{ connectionId: 'c1', connectionName: 'GPU-LAB', node: 'n1' }],
  },
}

const fetchMock = vi.fn()
let routes: Record<string, { status?: number; body: unknown }>

function route(url: string, init?: RequestInit) {
  const path = url.split('?')[0]
  const hit = routes[`${init?.method ?? 'GET'} ${path}`] ?? routes[path]
  const status = hit?.status ?? (hit ? 200 : 404)
  return Promise.resolve({ ok: status < 400, status, json: async () => hit?.body ?? { error: 'not_found' } })
}

beforeEach(() => {
  routes = {
    '/api/v1/gpu/metrics/latest': { body: { data: LATEST } },
    '/api/v1/gpu/metrics/series': { body: { data: SERIES } },
    'GET /api/v1/gpu/metrics/settings': { body: { data: SETTINGS } },
  }
  fetchMock.mockImplementation(route)
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

describe('LoadDashboard', () => {
  it('shows the fleet load with its last hours, the pressure out of the GPUs measured and one card per GPU', async () => {
    renderWithProviders(<LoadDashboard report={REPORT} onConfigure={vi.fn()} />)
    expect(await screen.findByTestId('gpu-load')).toBeTruthy()
    expect(screen.getByTestId('gpu-load-util').textContent).toContain('95 %')
    expect(screen.getByTestId('gpu-load-saturated').textContent).toContain('1')
    expect(screen.getByTestId('gpu-load-memory-pressure').textContent).toContain('1')
    // Held at its power limit (229 of 230 W), not hot: an AI load, not counted.
    expect(screen.getByTestId('gpu-load-throttled').textContent).toContain('0of 1 GPU measured')
    expect(screen.getByText('1 target not read')).toBeTruthy()
    expect(screen.queryByTestId('gpu-line-chart')).toBeNull()
    const card = screen.getByTestId('gpu-card')
    expect(card.getAttribute('data-measured')).toBe('true')
    expect(within(card).getByLabelText('NVIDIA')).toBeTruthy()
    expect(within(card).getByTestId('gpu-card-util').textContent).toContain('95 %')
    expect(within(card).getByTestId('gpu-card-temp').textContent).toContain('66 °C')
    expect(within(card).getByText('Saturated')).toBeTruthy()
    // The figures carry the last six hours only: never the long range of a detail.
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/metrics/series?range=6h'))).toBe(true))
    expect(fetchMock.mock.calls.some(([u]) => /range=(24h|7d|30d)/.test(String(u)))).toBe(false)
    expect(screen.getByTestId('gpu-load-saturated').textContent).toContain('of 1 GPU measured')
  })

  it('opens the detail of a GPU on click: holders, live readings and its own history over a range', async () => {
    renderWithProviders(<LoadDashboard report={REPORT} onConfigure={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open the detail of RTX A5000' }))
    const dialog = await screen.findByTestId('gpu-detail')
    // One row per holder: glyph with its state dot, name, #vmid, and what it holds.
    const holders = within(dialog).getAllByTestId('gpu-detail-holder')
    expect(holders).toHaveLength(2)
    expect(holders[0].textContent).toContain('ai-ollama')
    expect(holders[0].textContent).toContain('#9010')
    expect(holders[0].textContent).toContain('Whole card')
    expect(holders[1].textContent).toContain('spare')
    expect(within(dialog).getByTestId('gpu-detail-util').textContent).toContain('95 %')
    await waitFor(() => expect(within(dialog).getAllByTestId('gpu-line-chart')).toHaveLength(4))
    fireEvent.click(within(dialog).getByRole('button', { name: '7 d' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes('range=7d'))).toBe(true))
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' })[0])
    await waitFor(() => expect(screen.queryByTestId('gpu-detail')).toBeNull())
  })

  it('opens the detail from the keyboard, and says when a GPU has no history', async () => {
    routes['/api/v1/gpu/metrics/series'] = { body: { data: { ...SERIES, series: [] } } }
    renderWithProviders(<LoadDashboard report={REPORT} />)
    fireEvent.keyDown(await screen.findByRole('button', { name: 'Open the detail of RTX A5000' }), { key: 'Enter' })
    expect(await screen.findByText(/No history yet over this period/)).toBeTruthy()
  })

  it('shows a card per GPU however many there are, without a dense mode', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...REPORT.devices[0], key: `c1:n1:0000:${String(i).padStart(2, '0')}:00` }))
    renderWithProviders(<LoadDashboard report={{ ...REPORT, devices: many }} onConfigure={vi.fn()} />)
    await screen.findByTestId('gpu-load')
    expect(screen.getAllByTestId('gpu-card')).toHaveLength(30)
    expect(screen.queryByTestId('gpu-map-dense')).toBeNull()
  })

  it('narrows to the page filters', async () => {
    renderWithProviders(<LoadDashboard report={REPORT} scope={{ connId: 'other' }} />)
    await screen.findByTestId('gpu-load')
    expect(screen.getByTestId('gpu-load-util').textContent).toContain('0 %')
  })

  it('invites to configure when nothing is measured', async () => {
    routes['/api/v1/gpu/metrics/latest'] = { body: { data: { ...LATEST, configured: false, gpus: [], probes: [] } } }
    const onConfigure = vi.fn()
    renderWithProviders(<LoadDashboard report={REPORT} onConfigure={onConfigure} />)
    expect(await screen.findByTestId('gpu-load-unconfigured')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }))
    expect(onConfigure).toHaveBeenCalled()
  })

  it('says when the measurement is turned off', async () => {
    routes['/api/v1/gpu/metrics/latest'] = { body: { data: { ...LATEST, enabled: false } } }
    renderWithProviders(<LoadDashboard report={REPORT} />)
    expect(await screen.findByText('The GPU load measurement is turned off.')).toBeTruthy()
  })

  it('shows a banner when the orchestrator does not answer', async () => {
    routes['/api/v1/gpu/metrics/latest'] = { status: 503, body: { error: 'orchestrator_unavailable' } }
    renderWithProviders(<LoadDashboard report={REPORT} />)
    expect(await screen.findByText(/The orchestrator does not answer/)).toBeTruthy()
  })
})

describe('GpuMetricsSettingsDialog', () => {
  it('lists the VMs holding a GPU, tests one and saves the choice', async () => {
    routes['POST /api/v1/gpu/metrics/probe'] = { body: { data: { probes: [{ status: 'ok', gpus: 1 }] } } }
    routes['PUT /api/v1/gpu/metrics/settings'] = { body: { data: SETTINGS.settings } }
    const onSaved = vi.fn()
    const onClose = vi.fn()
    renderWithProviders(<GpuMetricsSettingsDialog open onClose={onClose} onSaved={onSaved} />)
    const rows = await screen.findAllByTestId('gpu-settings-guest')
    expect(rows).toHaveLength(2)
    expect(within(rows[1]).getByText('VM stopped')).toBeTruthy()
    fireEvent.click(within(rows[0]).getByRole('button', { name: /Test/ }))
    expect(await within(rows[0]).findByText('1 GPU read')).toBeTruthy()
    fireEvent.click(within(rows[1]).getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(JSON.parse(put![1].body).guest_vms).toEqual([{ connection_id: 'c1', vmid: 9010 }, { connection_id: 'c1', vmid: 9001 }])
    expect(onClose).toHaveBeenCalled()
  })

  it('opts a node in for host reads and tests it over SSH', async () => {
    routes['POST /api/v1/gpu/metrics/probe'] = { body: { data: { probes: [{ status: 'nvidia_smi_missing', gpus: 0, detail: 'nvidia-smi: command not found' }] } } }
    routes['PUT /api/v1/gpu/metrics/settings'] = { body: { data: SETTINGS.settings } }
    renderWithProviders(<GpuMetricsSettingsDialog open onClose={vi.fn()} onSaved={vi.fn()} />)
    const row = await screen.findByTestId('gpu-settings-node')
    fireEvent.click(within(row).getByRole('button', { name: /Test/ }))
    expect(await within(row).findByText('nvidia-smi missing (NVIDIA driver?)')).toBeTruthy()
    const probe = fetchMock.mock.calls.find(([u, init]) => String(u).includes('/probe') && init?.method === 'POST')
    expect(JSON.parse(probe![1].body)).toEqual({ connectionId: 'c1', node: 'n1' })
    fireEvent.click(within(row).getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true))
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(JSON.parse(put![1].body).host_nodes).toEqual([{ connection_id: 'c1', node: 'n1' }])
  })

  it('shows a refused save and a failed probe', async () => {
    routes['POST /api/v1/gpu/metrics/probe'] = { body: { data: { probes: [{ status: 'nvidia_smi_missing', gpus: 0 }] } } }
    routes['PUT /api/v1/gpu/metrics/settings'] = { status: 400, body: { error: 'invalid_interval' } }
    renderWithProviders(<GpuMetricsSettingsDialog open onClose={vi.fn()} onSaved={vi.fn()} />)
    const rows = await screen.findAllByTestId('gpu-settings-guest')
    fireEvent.click(within(rows[0]).getByRole('button', { name: /Test/ }))
    expect(await screen.findByText('nvidia-smi missing (NVIDIA driver?)')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Saving failed: invalid_interval')).toBeTruthy()
  })
})

describe('GPU page tabs', () => {
  it('overview: a chip per kind of trouble, its list on click, then the load and the GPU map', async () => {
    const broken = { ...REPORT, connections: [...REPORT.connections, { id: 'c2', name: 'DR', error: 'timeout', capacity: null }] }
    renderWithProviders(<OverviewTab report={broken} />)
    expect(await screen.findByTestId('gpu-load')).toBeTruthy()
    const chips = screen.getAllByTestId('gpu-attention-chip')
    expect(chips.map(c => c.getAttribute('data-kind'))).toEqual(['connectionError'])
    fireEvent.click(chips[0])
    expect((await screen.findAllByTestId('gpu-attention-row'))[0].textContent).toContain('DR')
    expect(screen.getByTestId('gpu-card-map')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '7 d' })).toBeNull()
  })

  it('overview without any GPU: says none was found and why, not to configure a load, and still flags an unreadable cluster', async () => {
    const consoles = REPORT.devices.map(d => ({ ...d, kind: 'console' as const, vms: [] }))
    const none = { ...REPORT, devices: consoles, allocations: [], connections: [...REPORT.connections, { id: 'c2', name: 'DR', error: 'timeout', capacity: null }] }
    renderWithProviders(<OverviewTab report={none} />)
    const empty = await screen.findByTestId('gpu-none')
    expect(empty.textContent).toContain('No GPU found')
    expect(empty.textContent).toContain(`${consoles.length} console controller`)
    expect(screen.queryByTestId('gpu-load-unconfigured')).toBeNull()
    expect(screen.getAllByTestId('gpu-attention-chip').map(c => c.getAttribute('data-kind'))).toEqual(['connectionError'])
  })

  it('overview: no chip at all when nothing goes wrong, even with a GPU shared or reserved by a stopped VM', async () => {
    renderWithProviders(<OverviewTab report={REPORT} />)
    expect(await screen.findByTestId('gpu-load')).toBeTruthy()
    expect(screen.queryByTestId('gpu-attention-chip')).toBeNull()
    expect(screen.queryByTestId('gpu-attention-ok')).toBeNull()
  })

  it('workloads: figures, the GPU and how it is given, bars of load and memory, "stopped" for the others', async () => {
    renderWithProviders(<WorkloadsTab report={REPORT} />)
    const rows = await screen.findAllByTestId('gpu-workload-row')
    expect(screen.getByTestId('gpu-workloads-vms').textContent).toContain('2')
    expect(screen.getByTestId('gpu-workloads-whole').textContent).toContain('2')
    await waitFor(() => expect(within(rows[0]).getByTestId('gpu-workload-load').textContent).toBe('95 %'))
    expect(within(rows[0]).getByTestId('gpu-workload-memory').textContent).toContain('22.5 / 24 GiB')
    expect(within(rows[0]).getByText('RTX A5000')).toBeTruthy()
    expect(within(rows[0]).getByText('Whole card')).toBeTruthy()
    expect(within(rows[1]).getByText('stopped')).toBeTruthy()
    // Both VMs want the same whole card: each says which other VM takes it.
    expect(within(rows[0]).getByTestId('gpu-workload-conflict').textContent).toBe('Card already taken')
  })

  it('workloads: a whole card asked on a card in vGPU mode says so', async () => {
    const report = { ...REPORT, devices: [{ ...REPORT.devices[0], mdev: true, vgpu: { mode: 'sriov' as const, virtualFunctions: ['0000:03:00.4'] } }] }
    renderWithProviders(<WorkloadsTab report={report} />)
    const rows = await screen.findAllByTestId('gpu-workload-row')
    expect(within(rows[0]).getByTestId('gpu-workload-conflict').textContent).toBe('Card in vGPU mode')
  })

  it('workloads: a vGPU row reads the host (share of the card), carries its profile and opens its detail', async () => {
    const vgpuAlloc = { ...REPORT.allocations[0], via: 'mapping' as const, mapping: 'm', mdev: 'nvidia-665', smbiosUuid: 'aaf0' }
    const report = {
      ...REPORT,
      devices: [{ ...REPORT.devices[0], mdev: true, vgpu: { mode: 'sriov' as const, virtualFunctions: ['0000:03:00.4'] }, vms: [{ ...REPORT.devices[0].vms[0], mdev: 'nvidia-665', via: 'mapping' as const }] }],
      allocations: [vgpuAlloc],
    }
    routes['/api/v1/gpu/metrics/latest'] = {
      body: { data: { ...LATEST, vgpus: [{ deviceKey: 'c1:n1:0000:03:00', connectionId: 'c1', node: 'n1', vmid: '9010', vmName: 'ai-ollama', profile: 'RTXA5000-12Q', typeId: 665, fbTotal: 12288, fbUsed: 10240, util: 59, memUtil: 50, licensed: true, guestDriver: '595.112.07', at: '' }] } },
    }
    renderWithProviders(<WorkloadsTab report={report} />)
    const [row] = await screen.findAllByTestId('gpu-workload-row')
    await waitFor(() => expect(within(row).getByTestId('gpu-workload-load').textContent).toBe('59 %'))
    expect(within(row).getByText('vGPU 12Q')).toBeTruthy()
    expect(within(row).queryByTestId('gpu-workload-conflict')).toBeNull()
    fireEvent.click(row)
    expect(await screen.findByTestId('gpu-vgpu-detail')).toBeTruthy()
  })

  it('workloads: filters by status and search, from the bar the page holds', async () => {
    function Harness() {
      const [filter, setFilter] = useState(NO_FILTER)
      return (
        <>
          <WorkloadFilters report={REPORT} value={filter} onChange={setFilter} />
          <WorkloadsTab report={REPORT} filter={filter} />
        </>
      )
    }
    renderWithProviders(<Harness />)
    await screen.findAllByTestId('gpu-workload-row')
    fireEvent.change(screen.getByLabelText('Search a GPU, a VM, a node'), { target: { value: 'spare' } })
    expect(screen.getAllByTestId('gpu-workload-row')).toHaveLength(1)
    fireEvent.change(screen.getByLabelText('Search a GPU, a VM, a node'), { target: { value: 'nothing-matches' } })
    expect(screen.getByText('Nothing matches these filters.')).toBeTruthy()
  })
})

describe('GPU actions dialogs', () => {
  const device = { ...REPORT.devices[0], vms: [REPORT.devices[0].vms[0]] }

  it('attach: lists the other VMs of the node and attaches the picked one', async () => {
    routes['/api/v1/gpu/actions/candidates'] = { body: { data: [
      { connId: 'c1', node: 'n1', vmid: '9010', name: 'ai-ollama', status: 'running', pool: null },
      { connId: 'c1', node: 'n1', vmid: '9002', name: 'mapped', status: 'stopped', pool: null },
    ] } }
    routes['POST /api/v1/gpu/actions'] = { body: { data: { hostpci: 'hostpci0', mapping: 'gpu-n1-03-00', mappingCreated: true, pending: false } } }
    const onDone = vi.fn()
    renderWithProviders(<AttachDialog device={device} onClose={vi.fn()} onDone={onDone} />)
    const rows = await screen.findAllByTestId('gpu-attach-candidate')
    expect(rows).toHaveLength(1)
    expect(screen.getByText(/ProxCenter creates one/)).toBeTruthy()
    fireEvent.click(rows[0])
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }))
    expect((await screen.findByTestId('gpu-attach-done')).textContent).toContain('Mapping gpu-n1-03-00 created')
    expect(onDone).toHaveBeenCalled()
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(post![1].body)).toEqual({ action: 'attach', deviceKey: 'c1:n1:0000:03:00', vmid: '9002' })
  })

  it('attach: shows the refusal of Proxmox', async () => {
    routes['/api/v1/gpu/actions/candidates'] = { body: { data: [{ connId: 'c1', node: 'n1', vmid: '9002', name: 'mapped', status: 'stopped', pool: null }] } }
    routes['POST /api/v1/gpu/actions'] = { status: 409, body: { error: 'no_free_slot' } }
    renderWithProviders(<AttachDialog device={device} onClose={vi.fn()} onDone={vi.fn()} />)
    fireEvent.click((await screen.findAllByTestId('gpu-attach-candidate'))[0])
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }))
    expect(await screen.findByText('The VM has no free PCI slot (16 taken).')).toBeTruthy()
  })

  const target = { connId: 'c1', node: 'n1', vmid: '9001', vmName: 'spare', hostpci: 'hostpci0', deviceName: 'A5000', vmStatus: 'stopped' }

  it('release: confirms then releases', async () => {
    routes['POST /api/v1/gpu/actions'] = { body: { data: { hostpci: 'hostpci0', pending: false } } }
    const onDone = vi.fn()
    renderWithProviders(<ReleaseDialog target={target} onClose={vi.fn()} onDone={onDone} />)
    fireEvent.click(screen.getByRole('button', { name: 'Release' }))
    expect(await screen.findByTestId('gpu-release-done')).toBeTruthy()
    expect(onDone).toHaveBeenCalled()
  })

  it('release: a raw allocation shows the root command to run', async () => {
    routes['POST /api/v1/gpu/actions'] = { status: 409, body: { error: 'raw_passthrough', command: 'qm set 9001 --delete hostpci0' } }
    renderWithProviders(<ReleaseDialog target={{ ...target, vmStatus: 'running' }} onClose={vi.fn()} onDone={vi.fn()} />)
    expect(screen.getByText(/stays in use until its next stop/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Release' }))
    expect((await screen.findByTestId('gpu-release-command')).textContent).toBe('qm set 9001 --delete hostpci0')
    expect(screen.queryByRole('button', { name: 'Release' })).toBeNull()
  })

  it('release: a raw allocation known as such shows the command without calling Proxmox', async () => {
    renderWithProviders(<ReleaseDialog target={{ ...target, raw: true }} onClose={vi.fn()} onDone={vi.fn()} />)
    expect(screen.getByTestId('gpu-release-command').textContent).toBe('qm set 9001 --delete hostpci0')
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/v1/gpu/actions'))).toBe(false)
  })
})

describe('MoveDialog', () => {
  const mapped = (status: string) => ({
    ...REPORT,
    nodes: [...REPORT.nodes, { node: 'n2', online: true, error: null, connId: 'c1', connectionName: 'GPU-LAB', capacity: cap }],
    devices: [
      { ...REPORT.devices[0], mappings: ['a5000'] },
      { ...REPORT.devices[0], key: 'c1:n2:0000:03:00', node: 'n2', mappings: ['a5000'], vms: [] },
    ],
    allocations: [{ ...REPORT.allocations[1], via: 'mapping' as const, mapping: 'a5000', vmStatus: status }],
  })
  const vm = { connId: 'c1', node: 'n1', vmid: '9001', vmName: 'spare' }

  it('moves a stopped VM to a node with a free GPU in its mapping, offline', async () => {
    routes['POST /api/v1/connections/c1/guests/qemu/n1/9001/migrate'] = { body: { success: true, data: 'UPID:x' } }
    const onDone = vi.fn()
    renderWithProviders(<MoveDialog vm={vm} report={mapped('stopped')} onClose={vi.fn()} onDone={onDone} />)
    fireEvent.click(screen.getByTestId('gpu-move-target'))
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    expect(await screen.findByTestId('gpu-move-done')).toBeTruthy()
    const post = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/migrate'))
    expect(JSON.parse(post![1].body)).toEqual({ target: 'n2', online: false })
    expect(onDone).toHaveBeenCalled()
  })

  it('explains why a running VM cannot move, and calls nothing', () => {
    renderWithProviders(<MoveDialog vm={vm} report={mapped('running')} onClose={vi.fn()} onDone={vi.fn()} />)
    expect(screen.getByTestId('gpu-move-impossible').textContent).toContain('Stop the VM first')
    expect(screen.queryByRole('button', { name: 'Move' })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('vGPU', () => {
  const vfs = ['0000:03:00.4', '0000:03:00.5']
  const vgpuAlloc = (vmid: string, name: string, status: string, uuid: string) => ({
    ...REPORT.allocations[0], vmid, vmName: name, vmStatus: status, via: 'mapping' as const, mapping: 'a5000-vgpu', mdev: 'nvidia-665', smbiosUuid: uuid,
  })
  const VGPU_REPORT: GpuReport = {
    ...REPORT,
    devices: [{
      ...REPORT.devices[0], mdev: true, vgpu: { mode: 'sriov', virtualFunctions: vfs, iommuGroups: [116, 117] }, mappings: ['a5000-vgpu'], vgpuMappings: ['a5000-vgpu'],
      vms: [
        { vmid: '9010', vmName: 'ai-ollama', vmStatus: 'running', hidden: false, template: false, hostpci: 'hostpci0', via: 'mapping', mdev: 'nvidia-665', pooled: false },
        { vmid: '9011', vmName: 'worker2', vmStatus: 'stopped', hidden: false, template: false, hostpci: 'hostpci0', via: 'mapping', mdev: 'nvidia-665', pooled: false },
        { vmid: '9001', vmName: 'spare', vmStatus: 'stopped', hidden: false, template: false, hostpci: 'hostpci0', via: 'address', mdev: null, pooled: false },
      ],
    }],
    allocations: [vgpuAlloc('9010', 'ai-ollama', 'running', 'aaf0'), vgpuAlloc('9011', 'worker2', 'stopped', 'e728'), { ...REPORT.allocations[1] }],
  }
  const VGPU_LATEST = {
    ...LATEST,
    gpus: [{ ...reading, target: 'node:n1:0000:03:00', source: 'host', vmid: null, util: 95, temp: 46, power: 196, power_limit: 230, mem_total: 23028 }],
    vgpus: [{ deviceKey: 'c1:n1:0000:03:00', connectionId: 'c1', node: 'n1', vmid: '9010', vmName: 'ai-ollama', profile: 'RTXA5000-12Q', typeId: 665, fbTotal: 12288, fbUsed: 9460, util: 48, memUtil: 30, licensed: true, guestDriver: '595.112.07', at: '' }],
    vgpuTypes: [{ deviceKey: 'c1:n1:0000:03:00', typeId: 665, name: 'RTXA5000-12Q', fbMemory: 12288, maxInstances: 2 }],
  }
  const actions = { canAct: true, canMove: false, refresh: vi.fn(), attach: vi.fn(), release: vi.fn(), move: vi.fn() }

  it('shows each card in vGPU mode: memory reserved, physical load, one row per VM with its profile and license', async () => {
    routes['/api/v1/gpu/metrics/latest'] = { body: { data: VGPU_LATEST } }
    renderWithProviders(
      <GpuActionsContext.Provider value={actions}>
        <VgpuTab report={VGPU_REPORT} />
      </GpuActionsContext.Provider>,
    )
    expect(await screen.findByTestId('gpu-vgpu-physical')).toBeTruthy()
    expect(screen.getByTestId('gpu-vgpu-physical').textContent).toContain('95 %')
    expect(screen.getByTestId('gpu-vgpu-reserved').textContent).toContain('12 / 22 GiB')
    expect(screen.getByTestId('gpu-vgpu-count').textContent).toContain('1 vGPU running')
    const rows = screen.getAllByTestId('gpu-vgpu-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('ai-ollama')
    expect(rows[0].textContent).toContain('12Q')
    expect(rows[0].textContent).toContain('Licensed')
    expect(rows[1].textContent).toContain('stopped')
    expect(screen.getByTestId('gpu-vgpu-passthrough').textContent).toContain('spare #9001')
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Release' }))
    expect(actions.release).toHaveBeenCalledWith(expect.objectContaining({ vmid: '9010', hostpci: 'hostpci0' }))
    // The release button does not open the row's detail.
    expect(screen.queryByTestId('gpu-vgpu-detail')).toBeNull()
  })

  it('opens the detail of a vGPU on a row click and of the card on its header', async () => {
    routes['/api/v1/gpu/metrics/latest'] = { body: { data: VGPU_LATEST } }
    renderWithProviders(
      <GpuActionsContext.Provider value={actions}>
        <VgpuTab report={VGPU_REPORT} />
      </GpuActionsContext.Provider>,
    )
    fireEvent.click((await screen.findAllByTestId('gpu-vgpu-row'))[0])
    const detail = await screen.findByTestId('gpu-vgpu-detail')
    expect(within(detail).getByTestId('gpu-vgpu-detail-profile').textContent).toContain('12Q')
    expect(within(detail).getByTestId('gpu-vgpu-detail-memory').textContent).toContain('77 %')
    expect(within(detail).getByTestId('gpu-vgpu-detail-driver').textContent).toContain('595.112.07')
    fireEvent.click(within(detail).getByRole('button', { name: 'Release' }))
    expect(actions.release).toHaveBeenCalledWith(expect.objectContaining({ vmid: '9010' }))
    await waitFor(() => expect(screen.queryByTestId('gpu-vgpu-detail')).toBeNull())

    fireEvent.keyDown(screen.getByTestId('gpu-vgpu-card-head'), { key: 'Enter' })
    expect(await screen.findByTestId('gpu-detail')).toBeTruthy()
    // A card in vGPU mode is handed out by profile, from the page bar, not whole.
    expect(screen.queryByTestId('gpu-detail-attach')).toBeNull()
  })

  it('gives a vGPU from the page bar: straight to the card, or a pick between cards', () => {
    const onPick = vi.fn()
    const card = VGPU_REPORT.devices[0]
    const { unmount } = renderWithProviders(<VgpuAttachButton cards={[card]} onPick={onPick} />)
    fireEvent.click(screen.getByTestId('gpu-vgpu-attach'))
    expect(onPick).toHaveBeenCalledWith(card)
    unmount()
    const other = { ...card, key: 'c1:n2:0000:03:00', node: 'n2' }
    renderWithProviders(<VgpuAttachButton cards={[card, other]} onPick={onPick} />)
    fireEvent.click(screen.getByTestId('gpu-vgpu-attach'))
    fireEvent.click(screen.getByRole('menuitem', { name: /n2/ }))
    expect(onPick).toHaveBeenLastCalledWith(other)
  })

  it('names a card in vGPU mode by its running vGPUs, a whole card by its VM', () => {
    const count = (n: number) => `${n} vGPU`
    expect(holderText(VGPU_REPORT.devices[0], count)).toBe('1 vGPU')
    expect(holderText(REPORT.devices[0], count)).toBe('ai-ollama #9010')
    expect(holderText({ ...REPORT.devices[0], vms: [] }, count)).toBeNull()
  })

  it('profiles: what each profile gives, who holds it and how many more fit, compute profiles unless all are asked', async () => {
    routes['/api/v1/gpu/metrics/latest'] = {
      body: { data: { ...VGPU_LATEST, vgpuTypes: [
        { deviceKey: 'c1:n1:0000:03:00', typeId: 657, name: 'RTXA5000-1B', fbMemory: 1024, maxInstances: 24 },
        { deviceKey: 'c1:n1:0000:03:00', typeId: 664, name: 'RTXA5000-8Q', fbMemory: 8192, maxInstances: 3 },
        { deviceKey: 'c1:n1:0000:03:00', typeId: 665, name: 'RTXA5000-12Q', fbMemory: 12288, maxInstances: 2 },
        { deviceKey: 'c1:n1:0000:03:00', typeId: 666, name: 'RTXA5000-24Q', fbMemory: 24576, maxInstances: 1 },
      ] } },
    }
    const { unmount } = renderWithProviders(<ProfilesTab report={VGPU_REPORT} showAll={false} />)
    const rows = await screen.findAllByTestId('gpu-profile-row')
    expect(rows.map(r => r.textContent?.slice(0, 3))).toEqual(['8Qn', '12Q', '24Q'])
    // Two 12Q promised (one VM stopped): the 24 GiB card has no room left.
    expect(screen.getByTestId('gpu-profile-card').textContent).toContain('24 / 24 GiB promised')
    expect(rows[1].textContent).toContain('ai-ollama #9010, worker2 #9011 (stopped)')
    expect(within(rows[1]).getByTestId('gpu-profile-free').textContent).toBe('no room')
    unmount()
    renderWithProviders(<ProfilesTab report={VGPU_REPORT} showAll />)
    expect(await screen.findAllByTestId('gpu-profile-row')).toHaveLength(4)
  })

  it('says when no card is in vGPU mode', () => {
    renderWithProviders(<VgpuTab report={REPORT} />)
    expect(screen.getByText(/No card of these clusters is in vGPU mode/)).toBeTruthy()
  })

  it('gives a vGPU: compute profiles only, a profile then a VM, sent with the attach', async () => {
    routes['/api/v1/gpu/actions/profiles'] = {
      body: { data: [
        { type: 'nvidia-657', name: 'RTXA5000-1B', available: 24 },
        { type: 'nvidia-666', name: 'RTXA5000-24Q', available: 0 },
        { type: 'nvidia-665', name: 'RTXA5000-12Q', available: 1 },
      ] },
    }
    routes['/api/v1/gpu/actions/candidates'] = { body: { data: [{ connId: 'c1', node: 'n1', vmid: '9020', name: 'new-ai', status: 'stopped', pool: null }] } }
    routes['POST /api/v1/gpu/actions'] = { body: { data: { hostpci: 'hostpci0', mapping: 'a5000-vgpu', mappingCreated: false, profile: 'nvidia-665', pending: false } } }
    renderWithProviders(<AttachDialog device={VGPU_REPORT.devices[0]} onClose={vi.fn()} onDone={vi.fn()} />)
    const profiles = await screen.findAllByTestId('gpu-attach-profile')
    expect(profiles.map(p => p.textContent)).toEqual(['12Q · 12 GiBavailable', '24Q · 24 GiBno longer fits'])
    fireEvent.click(profiles[0])
    fireEvent.click(await screen.findByTestId('gpu-attach-candidate'))
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }))
    await screen.findByTestId('gpu-attach-done')
    const post = fetchMock.mock.calls.find(([u, i]) => String(u) === '/api/v1/gpu/actions' && i?.method === 'POST')
    expect(JSON.parse(post![1].body)).toEqual({ action: 'attach', deviceKey: 'c1:n1:0000:03:00', vmid: '9020', profile: 'nvidia-665' })
  })
})

