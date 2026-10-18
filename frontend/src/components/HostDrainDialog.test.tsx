import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent, userEvent, waitFor, within } from '@/__tests__/setup/renderWithProviders'

import HostDrainDialog, { buildHostDrainConfig, KEEP_ON_NODE } from './HostDrainDialog'

/*
   #248: the drain dialog previews the orchestrator's plan (one line per guest,
   with its target or the reason it stays) and posts the drain with every
   setting the operator can change.
*/

const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => toast }))

const PLAN = {
  node: 'pve3',
  candidates: ['pve1', 'pve2'],
  movable: 3,
  skipped: 1,
  guests: [
    { vmid: 100, name: 'Debian13', type: 'qemu', status: 'skipped', mode: '', running: true, ha: false, reason: 'guest is locked (backup)' },
    { vmid: 92481, name: 'i248-nonha', type: 'qemu', status: 'pending', mode: 'live', running: true, ha: false, target_node: 'pve1', reason: 'best_fit' },
    { vmid: 92482, name: 'i248-ha', type: 'qemu', status: 'pending', mode: 'ha', running: true, ha: true },
    { vmid: 92483, name: 'i248-ct', type: 'lxc', status: 'pending', mode: 'restart', running: true, ha: false, target_node: 'pve2', reason: 'best_fit' },
  ],
  projection: [
    { node: 'pve3', source: true, mem_total: 100, mem_before: 40, mem_after: 30, cpu_before: 0.2, cpu_after: 0.05, guests_out: 3 },
    { node: 'pve1', mem_total: 100, mem_before: 50, mem_after: 95, cpu_before: 0.1, cpu_after: 0.15, guests_in: 1 },
    { node: 'pve2', mem_total: 100, mem_before: 40, mem_after: 45, cpu_before: 0.02, cpu_after: 0.1, guests_in: 1 },
  ],
  ha_unplaced: 1,
}

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).endsWith('/plan')) return { ok: true, status: 200, json: async () => ({ data: PLAN }) }
    return { ok: true, status: 200, json: async () => ({ data: { id: 'd-1' } }) }
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function planCalls() {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/plan'))
}

function startCalls() {
  return fetchMock.mock.calls.filter(([url]) => String(url) === '/api/v1/orchestrator/host-drains')
}

describe('buildHostDrainConfig', () => {
  it('turns the dialog state into the orchestrator config', () => {
    expect(buildHostDrainConfig({ mode: 'maintenance', maxParallel: 3, memCeiling: 85, includeStopped: false }))
      .toEqual({ max_concurrent_migrations: 3, mem_ceiling_percent: 85, include_stopped: false, enter_maintenance: true })
    // The edited plan: a target per guest, the kept guests apart.
    expect(buildHostDrainConfig({ mode: 'migrate-all', maxParallel: 2, memCeiling: 90, includeStopped: true, overrides: { 105: 'pve1', 92481: KEEP_ON_NODE, 92483: '' } }))
      .toEqual({ max_concurrent_migrations: 2, mem_ceiling_percent: 90, include_stopped: true, enter_maintenance: false, guest_targets: { 105: 'pve1' }, keep_vmids: [92481] })
    // A node entering maintenance is emptied: no guest is kept.
    expect(buildHostDrainConfig({ mode: 'maintenance', maxParallel: 2, memCeiling: 90, includeStopped: true, overrides: { 105: 'pve2', 92481: KEEP_ON_NODE } }))
      .toEqual({ max_concurrent_migrations: 2, mem_ceiling_percent: 90, include_stopped: true, enter_maintenance: true, guest_targets: { 105: 'pve2' } })
  })
})

describe('HostDrainDialog', () => {
  it('previews the plan with one line per guest and the skip reason', async () => {
    renderWithProviders(
      <HostDrainDialog open mode="migrate-all" connId="c1" node="pve3" otherNodes={['pve1', 'pve2']} onClose={vi.fn()} />,
    )

    await waitFor(() => expect(planCalls().length).toBeGreaterThan(0))
    const body = JSON.parse(planCalls()[0][1].body)
    expect(body).toEqual({
      connection_id: 'c1',
      node: 'pve3',
      config: { max_concurrent_migrations: 2, mem_ceiling_percent: 90, include_stopped: true, enter_maintenance: false },
    })

    await screen.findByTestId('drain-plan-guest-92481')
    // A refused guest keeps its reason on the warning icon, not on a second line.
    expect(screen.getByTestId('drain-plan-guest-100')).not.toHaveTextContent('guest is locked (backup)')
    expect(screen.getByTestId('drain-plan-reason-100')).toHaveAttribute('aria-label', 'guest is locked (backup)')
    // One route per moved guest, on the name line, the target named once.
    expect(screen.getByTestId('drain-plan-route-92481')).toHaveTextContent('pve3→pve1')
    expect(screen.getByTestId('drain-plan-guest-92481').textContent?.match(/pve1/g)).toHaveLength(1)
    expect(screen.getByTestId('drain-plan-route-92483')).toHaveTextContent('pve3→pve2')
    expect(screen.getByTestId('drain-plan-guest-92482')).toHaveTextContent('HA')
    // The eligible targets live in the info tooltip, the summary on the title line.
    expect(screen.getByTestId('drain-plan-candidates')).toHaveAttribute('aria-label', 'Eligible targets: pve1, pve2')
    expect(screen.queryByText('Eligible targets: pve1, pve2')).toBeNull()
  })

  it('paginates a long plan, refused guests first', async () => {
    const moved = Array.from({ length: 24 }, (_, i) => ({
      vmid: 200 + i, name: `vm-${i}`, type: 'qemu', status: 'pending', mode: 'live', running: true, ha: false, target_node: 'pve1',
    }))
    const refused = { vmid: 999, name: 'pinned', type: 'qemu', status: 'skipped', mode: 'live', running: true, ha: false, reason: 'local storage (ZFS-Pool)' }
    fetchMock.mockImplementation(async (url: string) => (String(url).endsWith('/plan')
      ? { ok: true, status: 200, json: async () => ({ data: { node: 'pve3', guests: [...moved, refused], candidates: ['pve1'], movable: 24, skipped: 1 } }) }
      : { ok: true, status: 200, json: async () => ({ data: {} }) }))

    renderWithProviders(<HostDrainDialog open mode="migrate-all" connId="c1" node="pve3" otherNodes={['pve1']} onClose={vi.fn()} />)

    const firstRow = await screen.findByTestId('drain-plan-guest-999')
    const rows = () => screen.getAllByTestId(/^drain-plan-guest-/)
    expect(rows()[0]).toBe(firstRow)
    expect(rows()).toHaveLength(20)
    expect(screen.getByText('1–20 of 25')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /next page/i }))
    expect(rows()).toHaveLength(5)
    expect(screen.queryByTestId('drain-plan-guest-999')).toBeNull()
    expect(screen.getByTestId('drain-plan-guest-223')).toBeInTheDocument()
  })

  it('sets the parallel migrations and the memory ceiling with sliders, the help in a tooltip', async () => {
    renderWithProviders(<HostDrainDialog open mode="migrate-all" connId="c1" node="pve3" otherNodes={['pve1', 'pve2']} onClose={vi.fn()} />)
    await screen.findByTestId('drain-plan-guest-92481')

    const parallel = screen.getByRole('slider', { name: 'Parallel migrations' })
    const ceiling = screen.getByRole('slider', { name: 'Memory ceiling on targets' })
    expect(parallel).toHaveAttribute('min', '1')
    expect(parallel).toHaveAttribute('max', '5')
    expect(ceiling).toHaveAttribute('min', '50')
    expect(ceiling).toHaveAttribute('step', '5')

    fireEvent.change(parallel, { target: { value: '4' } })
    fireEvent.change(ceiling, { target: { value: '75' } })

    await waitFor(() => expect(JSON.parse(planCalls().at(-1)![1].body).config).toMatchObject({ max_concurrent_migrations: 4, mem_ceiling_percent: 75 }))
    expect(screen.getAllByText('75 %').length).toBeGreaterThan(0)
    expect(screen.queryByText(/takes no more guests/)).toBeNull()
    expect(screen.getByLabelText(/takes no more guests/)).toBeInTheDocument()
  })

  it('edits the plan guest by guest; HA guests of a node entering maintenance stay with ha-manager', async () => {
    renderWithProviders(<HostDrainDialog open mode="maintenance" connId="c1" node="pve3" otherNodes={['pve1', 'pve2']} sshEnabled onClose={vi.fn()} />)
    await screen.findByTestId('drain-plan-guest-92481')

    // Pre-filled with the engine's choice; no selector for the HA guest nor the refused one.
    expect(screen.getByTestId('drain-plan-target-92481')).toHaveTextContent('pve1')
    expect(screen.queryByTestId('drain-plan-target-92482')).toBeNull()
    expect(screen.queryByTestId('drain-plan-target-100')).toBeNull()

    await userEvent.click(within(screen.getByTestId('drain-plan-target-92483')).getByRole('combobox'))
    expect(screen.queryByRole('option', { name: 'Leave on the node' })).toBeNull()
    await userEvent.click(screen.getByRole('option', { name: 'pve1' }))

    await waitFor(() => expect(JSON.parse(planCalls().at(-1)![1].body).config.guest_targets).toEqual({ 92483: 'pve1' }))
  })

  it('spreads every guest with Apply to all, and keeps a guest on the node in Migrate all VMs', async () => {
    renderWithProviders(<HostDrainDialog open mode="migrate-all" connId="c1" node="pve3" otherNodes={['pve1', 'pve2']} onClose={vi.fn()} />)
    await screen.findByTestId('drain-plan-guest-92481')

    expect(screen.getByTestId('drain-plan-apply-all')).toHaveTextContent('Automatic placement')
    await userEvent.click(within(screen.getByTestId('drain-plan-apply-all')).getByRole('combobox'))
    await userEvent.click(screen.getByRole('option', { name: 'pve2' }))
    expect(screen.getByTestId('drain-plan-apply-all')).toHaveTextContent('pve2')
    await waitFor(() => expect(JSON.parse(planCalls().at(-1)![1].body).config.guest_targets).toEqual({ 92481: 'pve2', 92482: 'pve2', 92483: 'pve2' }))

    await userEvent.click(within(screen.getByTestId('drain-plan-target-92481')).getByRole('combobox'))
    await userEvent.click(screen.getByRole('option', { name: 'Leave on the node' }))
    await waitFor(() => expect(JSON.parse(planCalls().at(-1)![1].body).config).toMatchObject({ guest_targets: { 92482: 'pve2', 92483: 'pve2' }, keep_vmids: [92481] }))
    expect(screen.getByTestId('drain-plan-apply-all')).toHaveTextContent('per guest')

    // Automatic placement drops every choice.
    await userEvent.click(within(screen.getByTestId('drain-plan-apply-all')).getByRole('combobox'))
    await userEvent.click(screen.getByRole('option', { name: 'Automatic placement' }))
    expect(screen.getByTestId('drain-plan-apply-all')).toHaveTextContent('Automatic placement')
    await waitFor(() => {
      const config = JSON.parse(planCalls().at(-1)![1].body).config
      expect(config.guest_targets).toBeUndefined()
      expect(config.keep_vmids).toBeUndefined()
    })
  })

  it('projects the load of every node once the plan has run', async () => {
    renderWithProviders(<HostDrainDialog open mode="maintenance" connId="c1" node="pve3" otherNodes={['pve1', 'pve2']} sshEnabled onClose={vi.fn()} />)
    const block = await screen.findByTestId('drain-projection')

    expect(within(block).getByTestId('drain-projection-node-pve3')).toHaveTextContent('pve3−3')
    expect(within(block).getByTestId('drain-projection-node-pve1')).toHaveTextContent('pve1+1')
    expect(within(block).getByTestId('drain-projection-mem-pve3')).toHaveTextContent('40 → 30 %')
    expect(within(block).getByTestId('drain-projection-cpu-pve2')).toHaveTextContent('2 → 10 %')
    // Past the 90 % ceiling the projected value is flagged.
    expect(within(block).getByTestId('drain-projection-mem-pve1')).toHaveTextContent('50 → 95 %')
    expect(within(block).getByTestId('drain-projection-help').getAttribute('aria-label')).toContain('1 HA guest(s) are placed by Proxmox HA')
  })

  it('shows the orchestrator refusal of the plan and an unreachable orchestrator on start', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/plan')) return { ok: false, status: 400, json: async () => ({ error: 'node "pve3" is not part of this cluster' }) }
      throw new Error('network down')
    })
    renderWithProviders(<HostDrainDialog open mode="migrate-all" connId="c1" node="pve3" otherNodes={['pve1']} onClose={vi.fn()} />)
    expect(await screen.findByText('node "pve3" is not part of this cluster')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start the drain' })).toBeDisabled()

    cleanup()
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/plan')) return { ok: true, status: 200, json: async () => ({ data: { ...PLAN, guests: [...PLAN.guests, { vmid: 92484, name: 'i248-stopped', type: 'qemu', status: 'pending', mode: 'offline', running: false, ha: false, target_node: 'pve1' }] } }) }
      throw new Error('network down')
    })
    renderWithProviders(<HostDrainDialog open mode="migrate-all" connId="c1" node="pve3" otherNodes={['pve1']} onClose={vi.fn()} />)
    await screen.findByTestId('drain-plan-guest-92484')
    expect(screen.getByTestId('drain-plan-guest-92484')).toHaveTextContent('offline')
    const start = screen.getByRole('button', { name: 'Start the drain' })
    await waitFor(() => expect(start).toBeEnabled())
    fireEvent.click(start)
    expect(await screen.findByText('network down')).toBeInTheDocument()
  })

  it('starts the drain with the chosen settings and reports it', async () => {
    const onStarted = vi.fn()
    const onClose = vi.fn()
    renderWithProviders(
      <HostDrainDialog open mode="maintenance" connId="c1" node="pve3" otherNodes={['pve1', 'pve2']} sshEnabled onClose={onClose} onStarted={onStarted} />,
    )
    await screen.findByTestId('drain-plan-guest-92481')

    const parallel = screen.getByLabelText('Parallel migrations') as HTMLInputElement
    fireEvent.change(parallel, { target: { value: '4' } })
    fireEvent.blur(parallel)
    const ceiling = screen.getByLabelText('Memory ceiling on targets') as HTMLInputElement
    fireEvent.change(ceiling, { target: { value: '80' } })
    fireEvent.blur(ceiling)

    // The preview follows the settings.
    await waitFor(() => {
      const last = JSON.parse(planCalls().at(-1)![1].body)
      expect(last.config).toMatchObject({ max_concurrent_migrations: 4, mem_ceiling_percent: 80, enter_maintenance: true })
    })

    const start = await screen.findByRole('button', { name: 'Start the drain' })
    await waitFor(() => expect(start).toBeEnabled())
    fireEvent.click(start)

    await waitFor(() => expect(startCalls()).toHaveLength(1))
    const sent = JSON.parse(startCalls()[0][1].body)
    expect(sent).toEqual({
      connection_id: 'c1',
      node: 'pve3',
      config: { max_concurrent_migrations: 4, mem_ceiling_percent: 80, include_stopped: true, enter_maintenance: true },
    })
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith({ id: 'd-1' }))
    expect(toast.success).toHaveBeenCalledWith('Drain of pve3 started, follow each guest in the Task Center')
    expect(onClose).toHaveBeenCalled()
  })

  it('refuses to enter maintenance without SSH and shows why', async () => {
    renderWithProviders(
      <HostDrainDialog open mode="maintenance" connId="c1" node="pve3" otherNodes={['pve1']} sshEnabled={false} onClose={vi.fn()} />,
    )
    expect(screen.getByText('Entering maintenance runs ha-manager over SSH: SSH must be configured on this connection.')).toBeInTheDocument()
    await screen.findByTestId('drain-plan-guest-92481')
    expect(screen.getByRole('button', { name: 'Start the drain' })).toBeDisabled()
  })

  it('keeps the maintenance-only path when evacuation is switched off', async () => {
    const onMaintenanceOnly = vi.fn().mockResolvedValue(undefined)
    renderWithProviders(
      <HostDrainDialog open mode="maintenance" connId="c1" node="pve3" otherNodes={['pve1']} sshEnabled onClose={vi.fn()} onMaintenanceOnly={onMaintenanceOnly} />,
    )
    fireEvent.click(screen.getByLabelText('Evacuate the guests'))
    expect(screen.getByText('Maintenance only: Proxmox HA relocates the HA-managed guests, the others stay on the node.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(onMaintenanceOnly).toHaveBeenCalled())
    expect(startCalls()).toHaveLength(0)
  })

  it('surfaces the orchestrator refusal instead of closing', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/plan')) return { ok: true, status: 200, json: async () => ({ data: PLAN }) }
      return { ok: false, status: 409, json: async () => ({ error: 'a host drain is already running on this cluster' }) }
    })
    const onClose = vi.fn()
    renderWithProviders(
      <HostDrainDialog open mode="migrate-all" connId="c1" node="pve3" otherNodes={['pve1']} onClose={onClose} />,
    )
    await screen.findByTestId('drain-plan-guest-92481')
    const start = screen.getByRole('button', { name: 'Start the drain' })
    await waitFor(() => expect(start).toBeEnabled())
    fireEvent.click(start)
    expect(await screen.findByText('a host drain is already running on this cluster')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})
