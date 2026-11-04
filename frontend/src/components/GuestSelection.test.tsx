/**
 * The selection shared by the guest tables. "Migrate selection" (#1218): for
 * a user with vm.migrate only it stays on one cluster, skips templates and
 * migrating guests, and only exists for a tenant that owns the cluster, on a
 * cluster of 2+ online nodes. Power actions (roadmap#197): with a power right
 * it spans clusters, tenant views included, and counts live power states.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent } from '@/__tests__/setup/renderWithProviders'
import { GuestPowerMenu, GuestSelectionBar, useGuestSelection, usePickedGuestSelection, type GuestSelection, type SelectionNode } from '@/components/GuestSelection'

const tenant = { isFullClusterView: true }
const MIGRATE_ONLY = (p: string) => p === 'vm.migrate'
const rbac = { hasPermission: (_p: string) => true }

vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => tenant }))
vi.mock('@/contexts/RBACContext', () => ({ useRBAC: () => rbac }))
const drainDialog = vi.hoisted(() => ({ props: null as any }))
const jobDialog = vi.hoisted(() => ({ props: null as any }))
const runJobAction = vi.hoisted(() => vi.fn())

vi.mock('@/components/HostDrainDialog', () => ({ default: (p: any) => { drainDialog.props = p; return null } }))
const powerDialog = vi.hoisted(() => ({ props: null as any }))
vi.mock('@/components/BulkPowerDialog', async importOriginal => {
  const { useEffect } = await import('react')
  const actual = await importOriginal<typeof import('@/components/BulkPowerDialog')>()
  function BulkPowerDialogMock(p: any) {
    powerDialog.props = p
    useEffect(() => () => { powerDialog.props = null }, [])
    return null
  }
  return { POWER_ACTION_LOOK: actual.POWER_ACTION_LOOK, default: BulkPowerDialogMock }
})
vi.mock('@/components/tasks/JobDetailDialog', () => ({ default: (p: any) => { jobDialog.props = p; return null } }))
vi.mock('@/lib/tasks/jobActions', () => ({ runJobAction }))
vi.mock('@/contexts/LicenseContext', () => ({ useLicense: () => ({ isEnterprise: false }) }))

const vm = (connId: string, node: string, vmid: number, template = false, status = 'running') => ({ id: `${connId}:${node}:qemu:${vmid}`, connId, vmid, template, node, type: 'qemu' as const, status, name: `vm${vmid}` })

const VMS = [vm('a', 'pve1', 101), vm('a', 'pve2', 102), vm('a', 'pve1', 900, true), vm('b', 'x1', 201), vm('c', 'solo', 301)]
const NODES: SelectionNode[] = [
  { connId: 'a', node: 'pve1', status: 'online', connName: 'PROD' },
  { connId: 'a', node: 'pve2', status: 'online', connName: 'PROD' },
  { connId: 'a', node: 'pve3', status: 'offline', connName: 'PROD' },
  { connId: 'b', node: 'x1', status: 'online', connName: 'DR' },
  { connId: 'b', node: 'x2', status: 'online', connName: 'DR' },
  { connId: 'c', node: 'solo', status: 'online', connName: 'LAB' },
]

afterEach(() => cleanup())

const setup = (props: Partial<Parameters<typeof useGuestSelection>[0]> = {}) =>
  renderHook(p => useGuestSelection(p), { initialProps: { vms: VMS, nodes: NODES, ...props } })

describe('useGuestSelection, migrate right only', () => {
  beforeEach(() => {
    tenant.isFullClusterView = true
    rbac.hasPermission = MIGRATE_ONLY
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
    rbac.hasPermission = () => false
    expect(setup().result.current.tableProps).toEqual({})
  })
})

describe('useGuestSelection, with power rights (roadmap#197)', () => {
  beforeEach(() => {
    tenant.isFullClusterView = true
    rbac.hasPermission = () => true
  })

  it('spans clusters, lone nodes included, never a template or a migrating guest', () => {
    const { result } = setup({ migratingVmIds: new Set(['a:102']) })
    const ok = result.current.tableProps.isRowSelectable!
    expect(ok(VMS[4])).toBe(true)
    expect(ok(VMS[2])).toBe(false)
    expect(ok(VMS[1])).toBe(false)

    act(() => result.current.tableProps.onSelectionChange!(new Set([VMS[0].id, VMS[3].id, VMS[4].id])))
    expect(result.current.selectedVms.map(v => v.vmid)).toEqual([101, 201, 301])
    expect(result.current.clusterCount).toBe(3)
    expect(result.current.connId).toBeUndefined()
    expect(result.current.connName).toBeUndefined()
    expect(result.current.canMigrate).toBe(false)
    expect(result.current.power).toEqual({ start: true, stop: true, restart: true })
  })

  it('migrates a one-cluster selection only when that cluster has two online nodes', () => {
    const { result } = setup()
    act(() => result.current.tableProps.onSelectionChange!(new Set([VMS[0].id, VMS[1].id])))
    expect(result.current).toMatchObject({ connId: 'a', connName: 'PROD', canMigrate: true, migrateAllowed: true })

    act(() => result.current.tableProps.onSelectionChange!(new Set([VMS[4].id])))
    expect(result.current).toMatchObject({ connId: 'c', canMigrate: false })
  })

  it('is on in a tenant view, without migration', () => {
    tenant.isFullClusterView = false
    const { result } = setup()
    act(() => result.current.tableProps.onSelectionChange!(new Set([VMS[0].id])))
    expect(result.current.selectedVms).toHaveLength(1)
    expect(result.current.migrateAllowed).toBe(false)
    expect(result.current.canMigrate).toBe(false)
  })

  it('reads the power state from the live inventory over the table it was ticked in', () => {
    const { result } = setup({ liveVms: [{ connId: 'a', vmid: '101', status: 'stopped' }] })
    act(() => result.current.tableProps.onSelectionChange!(new Set([VMS[0].id, VMS[1].id])))
    expect(result.current.selectedVms.map(v => v.status)).toEqual(['stopped', 'running'])
  })

  it('opens the power menu of the selection on a right click, and closes it', () => {
    const { result } = setup()
    const preventDefault = vi.fn()
    act(() => result.current.tableProps.onSelectionContextMenu!({ preventDefault, clientX: 5, clientY: 9 } as any))
    expect(preventDefault).toHaveBeenCalled()
    expect(result.current.powerMenuAt).toEqual({ top: 9, left: 5 })
    act(() => result.current.closePowerMenu!())
    expect(result.current.powerMenuAt).toBeNull()

    rbac.hasPermission = MIGRATE_ONLY
    expect(setup().result.current.tableProps.onSelectionContextMenu).toBeUndefined()
  })

  it('keeps one power right and drops the others', () => {
    rbac.hasPermission = p => p === 'vm.start'
    expect(setup().result.current.power).toEqual({ start: true, stop: false, restart: false })
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
    powerDialog.props = null
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

describe('usePickedGuestSelection (inventory tree, roadmap#197)', () => {
  beforeEach(() => {
    tenant.isFullClusterView = true
    rbac.hasPermission = (_p: string) => true
  })

  const picked = (vms: typeof VMS, over: Partial<Parameters<typeof usePickedGuestSelection>[0]> = {}) =>
    renderHook(() => usePickedGuestSelection({ vms, nodes: NODES, menuAt: null, closeMenu: vi.fn(), clear: vi.fn(), ...over })).result.current

  it('takes the drain planner for one cluster of two online nodes, and the power menu for any', () => {
    const one = picked([VMS[0], VMS[1]], { menuAt: { top: 1, left: 2 } })
    expect(one).toMatchObject({ connId: 'a', connName: 'PROD', clusterCount: 1, onlineNodes: ['pve1', 'pve2'], migrateAllowed: true, canMigrate: true, powerMenuAt: { top: 1, left: 2 } })
    expect(one.power).toEqual({ start: true, stop: true, restart: true })

    expect(picked([VMS[0], VMS[3]])).toMatchObject({ connId: undefined, clusterCount: 2, canMigrate: false })
    expect(picked([VMS[4]])).toMatchObject({ connId: 'c', canMigrate: false })
  })

  it('offers no migration without vm.migrate or in a tenant view', () => {
    rbac.hasPermission = (p: string) => p !== 'vm.migrate'
    expect(picked([VMS[0], VMS[1]])).toMatchObject({ migrateAllowed: false, canMigrate: false })
    rbac.hasPermission = (_p: string) => true
    tenant.isFullClusterView = false
    expect(picked([VMS[0], VMS[1]]).migrateAllowed).toBe(false)
  })

  it('fits the tree in compact form: icons alone, named for assistive tech, no cluster chip', () => {
    const clear = vi.fn()
    const sel = picked([VMS[0], VMS[1]], { clear })
    renderWithProviders(<GuestSelectionBar selection={sel} sticky compact />)
    expect(screen.getByTestId('vm-selection-bar').textContent).toBe('2 guest(s) selected')
    expect(screen.getByTestId('vm-selection-migrate').getAttribute('aria-label')).toBe('Migrate selection')

    fireEvent.click(screen.getByTestId('vm-selection-clear'))
    expect(clear).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId('vm-selection-power'))
    expect(screen.getByTestId('vm-selection-power-shutdown')).toBeTruthy()
    fireEvent.click(screen.getByTestId('vm-selection-migrate'))
    expect(drainDialog.props).toMatchObject({ mode: 'selection', connId: 'a', vmids: [101, 102] })
  })

  it('greys the migrate icon of a selection over two clusters', () => {
    renderWithProviders(<GuestSelectionBar selection={picked([VMS[0], VMS[3]])} compact />)
    expect((screen.getByTestId('vm-selection-migrate') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('GuestSelectionBar, power actions (roadmap#197)', () => {
  const stopped = vm('a', 'pve1', 103, false, 'stopped')
  const selection = (over: Partial<GuestSelection> = {}): GuestSelection => ({
    tableProps: {},
    selectedVms: [VMS[0], stopped, VMS[3]],
    connId: undefined,
    connName: undefined,
    clusterCount: 2,
    onlineNodes: [],
    migrateAllowed: true,
    canMigrate: false,
    power: { start: true, stop: true, restart: false },
    clear: vi.fn(),
    ...over,
  })

  beforeEach(() => {
    powerDialog.props = null
    drainDialog.props = null
  })

  it('counts the guests each action applies to and greys what the user may not run', () => {
    renderWithProviders(<GuestSelectionBar selection={selection()} inline />)
    expect(screen.getByTestId('vm-selection-bar').textContent).toContain('2 clusters')

    fireEvent.click(screen.getByTestId('vm-selection-power'))
    expect(screen.getByTestId('vm-selection-power-start').textContent).toContain('(1)')
    expect(screen.getByTestId('vm-selection-power-shutdown').textContent).toContain('(2)')
    expect(screen.getByTestId('vm-selection-power-reboot').getAttribute('aria-disabled')).toBe('true')

    fireEvent.click(screen.getByTestId('vm-selection-power-shutdown'))
    expect(powerDialog.props).toMatchObject({ action: 'shutdown', skipped: 1 })
    expect(powerDialog.props.guests.map((g: any) => [g.connId, g.node, g.vmid])).toEqual([['a', 'pve1', 101], ['b', 'x1', 201]])

    act(() => powerDialog.props.onClose())
    expect(powerDialog.props).toBeNull()
  })

  it('keeps the migrate button greyed for a selection over several clusters', () => {
    renderWithProviders(<GuestSelectionBar selection={selection()} inline />)
    expect((screen.getByTestId('vm-selection-migrate') as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows no power button without a power right, and no migrate button where migration is not offered', () => {
    renderWithProviders(<GuestSelectionBar selection={selection({ power: { start: false, stop: false, restart: false }, migrateAllowed: false })} inline />)
    expect(screen.queryByTestId('vm-selection-power')).toBeNull()
    expect(screen.queryByTestId('vm-selection-migrate')).toBeNull()
  })
})

describe('GuestPowerMenu', () => {
  it('opens at the pointer and hands the frozen guests to the dialog', () => {
    const onClose = vi.fn()
    renderWithProviders(<GuestPowerMenu vms={[VMS[0]]} power={{ start: true, stop: true, restart: true }} anchorPosition={{ top: 10, left: 10 }} onClose={onClose} />)

    fireEvent.click(screen.getByTestId('vm-selection-power-reboot'))
    expect(onClose).toHaveBeenCalled()
    expect(powerDialog.props).toMatchObject({ action: 'reboot', skipped: 0 })
  })
})
