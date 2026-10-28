/**
 * "Migrate selection" (#1218): the selection shared by the guest tables stays
 * on one cluster, skips templates and migrating guests, and only exists for a
 * tenant that owns the cluster, with vm.migrate, on a cluster of 2+ online nodes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent } from '@/__tests__/setup/renderWithProviders'
import { GuestSelectionBar, useGuestSelection, type GuestSelection, type SelectionNode } from '@/components/GuestSelection'

const tenant = { isFullClusterView: true }
const rbac = { hasPermission: (_p: string) => true }

vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => tenant }))
vi.mock('@/contexts/RBACContext', () => ({ useRBAC: () => rbac }))
const drainDialog = vi.hoisted(() => ({ props: null as any }))
const jobDialog = vi.hoisted(() => ({ props: null as any }))
const runJobAction = vi.hoisted(() => vi.fn())

vi.mock('@/components/HostDrainDialog', () => ({ default: (p: any) => { drainDialog.props = p; return null } }))
vi.mock('@/components/tasks/JobDetailDialog', () => ({ default: (p: any) => { jobDialog.props = p; return null } }))
vi.mock('@/lib/tasks/jobActions', () => ({ runJobAction }))
vi.mock('@/contexts/LicenseContext', () => ({ useLicense: () => ({ isEnterprise: false }) }))

const vm = (connId: string, node: string, vmid: number, template = false) => ({ id: `${connId}:${node}:qemu:${vmid}`, connId, vmid, template })

const VMS = [vm('a', 'pve1', 101), vm('a', 'pve2', 102), vm('a', 'pve1', 900, true), vm('b', 'x1', 201), vm('c', 'solo', 301)]
const NODES: SelectionNode[] = [
  { connId: 'a', node: 'pve1', status: 'online', connName: 'PROD' },
  { connId: 'a', node: 'pve2', status: 'online', connName: 'PROD' },
  { connId: 'a', node: 'pve3', status: 'offline', connName: 'PROD' },
  { connId: 'b', node: 'x1', status: 'online', connName: 'DR' },
  { connId: 'b', node: 'x2', status: 'online', connName: 'DR' },
  { connId: 'c', node: 'solo', status: 'online', connName: 'LAB' },
]

const setup = (props: Partial<Parameters<typeof useGuestSelection>[0]> = {}) =>
  renderHook(p => useGuestSelection(p), { initialProps: { vms: VMS, nodes: NODES, ...props } })

describe('useGuestSelection', () => {
  beforeEach(() => {
    tenant.isFullClusterView = true
    rbac.hasPermission = () => true
  })

  it('offers checkboxes on a cluster of two online nodes, never on a template or a lone node', () => {
    const { result } = setup()
    const ok = result.current.tableProps.isRowSelectable!
    expect(ok(VMS[0])).toBe(true)
    expect(ok(VMS[2])).toBe(false)
    expect(ok(VMS[4])).toBe(false)
  })

  it('keeps one cluster: the others turn unselectable and a mixed "select all" keeps the first', () => {
    const { result } = setup()
    act(() => result.current.tableProps.onSelectionChange!(new Set([VMS[0].id, VMS[3].id, VMS[1].id])))
    expect(result.current.selectedVms.map(v => v.vmid)).toEqual([101, 102])
    expect(result.current.connId).toBe('a')
    expect(result.current.connName).toBe('PROD')
    expect(result.current.onlineNodes).toEqual(['pve1', 'pve2'])
    expect(result.current.tableProps.isRowSelectable!(VMS[3])).toBe(false)

    act(() => result.current.clear())
    expect(result.current.selectedVms).toEqual([])
    expect(result.current.tableProps.isRowSelectable!(VMS[3])).toBe(true)
  })

  it('drops a guest that starts migrating or leaves the list, and resets on a new scope', () => {
    const { result, rerender } = setup()
    act(() => result.current.tableProps.onSelectionChange!(new Set([VMS[0].id, VMS[1].id])))
    rerender({ vms: VMS, nodes: NODES, migratingVmIds: new Set(['a:102']) })
    expect(result.current.selectedVms.map(v => v.vmid)).toEqual([101])
    rerender({ vms: VMS.slice(1), nodes: NODES })
    expect(result.current.selectedVms.map(v => v.vmid)).toEqual([102])
    rerender({ vms: VMS, nodes: NODES, resetKey: 'other' })
    expect(result.current.selectedVms).toEqual([])
  })

  it('is off for a tenant that does not own the cluster or without vm.migrate', () => {
    tenant.isFullClusterView = false
    expect(setup().result.current.tableProps).toEqual({})
    tenant.isFullClusterView = true
    rbac.hasPermission = p => p !== 'vm.migrate'
    expect(setup().result.current.tableProps).toEqual({})
  })
})

describe('GuestSelectionBar', () => {
  const selection = (over: Partial<GuestSelection> = {}): GuestSelection => ({
    tableProps: {},
    selectedVms: [VMS[0], VMS[1]],
    connId: 'a',
    connName: 'PROD',
    onlineNodes: ['pve1', 'pve2'],
    clear: vi.fn(),
    ...over,
  })

  beforeEach(() => {
    drainDialog.props = null
    jobDialog.props = null
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })))
  })

  it('shows nothing until a guest is ticked', () => {
    renderWithProviders(<GuestSelectionBar selection={selection({ selectedVms: [] })} inline />)
    expect(screen.queryByTestId('vm-selection-bar')).toBeNull()
    expect(drainDialog.props).toBeNull()
  })

  it('hands the selection to the drain planner, then follows the migration it started', async () => {
    const sel = selection()
    renderWithProviders(<GuestSelectionBar selection={sel} sticky />)
    expect(screen.getByTestId('vm-selection-bar').textContent).toContain('PROD')

    fireEvent.click(screen.getByText('Clear'))
    expect(sel.clear).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('vm-selection-migrate'))
    expect(drainDialog.props).toMatchObject({ mode: 'selection', connId: 'a', node: '', otherNodes: ['pve1', 'pve2'], vmids: [101, 102] })
    expect(jobDialog.props.open).toBe(false)

    act(() => drainDialog.props.onStarted({ id: 'd-1', status: 'running', vmids: [101, 102], guests: [], total_guests: 2 }))
    expect(sel.clear).toHaveBeenCalledTimes(2)
    expect(jobDialog.props.open).toBe(true)
    expect(jobDialog.props.job).toMatchObject({ id: 'd-1', type: 'host_drain' })

    runJobAction.mockResolvedValueOnce({ ok: false, error: 'refused' })
    await act(() => jobDialog.props.onAction(jobDialog.props.job, 'cancel'))
    expect(runJobAction).toHaveBeenCalledWith(jobDialog.props.job, 'cancel')
    expect(jobDialog.props.actionError).toBe('refused')

    act(() => jobDialog.props.onClose())
    expect(jobDialog.props.open).toBe(false)
  })
})
